import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { openFirestoreDatabase, exportRows, tables, rowId, hydrate } from './firestore.mjs';
import { createApp } from './index.mjs';
import { handleMonsters } from './monsters.mjs';
import { handleAdvancement } from './advancement.mjs';
import { characterTraits } from '../shared/character-traits.mjs';
import { handleBattles } from './battles.mjs';
import { emptyStatistics, handleStatistics } from './statistics.mjs';
import samples from '../shared/sample-monsters.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { resourceState } from './spell-resources.mjs';
import { createGameEvents } from './game-events.mjs';
import { EventEmitter } from 'node:events';

test('HTTP battle end retries an aborted transaction without consuming its body twice or duplicating the summary', async () => {
  const firestore = cloud();
  const runOnce = firestore.runTransaction.bind(firestore);
  let retryNext = false, callbacks = 0;
  firestore.runTransaction = async (work, options) => {
    const wrapped = transaction => { callbacks++; return work(transaction); };
    if (retryNext) {
      retryNext = false;
      assert.ok(options.maxAttempts > 1);
      firestore.failNextCommit();
      await assert.rejects(runOnce(wrapped), /Cloud unavailable/);
    }
    return runOnce(wrapped);
  };
  const db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    db.exec(`UPDATE users SET role = 'gm' WHERE id = 1;
      INSERT INTO games (id, gm_id, name) VALUES (1, 1, 'Completed battle');
      INSERT INTO game_sessions (id, game_id, started_at) VALUES (1, 1, 1);`);
    db.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run(createHash('sha256').update('retry-test').digest('hex'), Date.now() + 60000);
    db.prepare('INSERT INTO session_battles VALUES (1, ?)').run(JSON.stringify({ sessionId: 1, active: true, version: 4, round: 3, turn: 0, fighters: [], pending: null, log: [], defeatedMonsters: [{ id: 'enemy', name: 'Enemy', damageTaken: 20 }] }));
  });
  const app = createApp(db, 'http://127.0.0.1:5173');
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const before = callbacks; retryNext = true;
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/games/1/battle/end`, {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json', Cookie: 'session=retry-test' },
      body: JSON.stringify({ sessionId: 1, version: 4 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(callbacks - before, 2);
    assert.equal(result.battle.version, 5);
    assert.equal(result.battle.active, false);
    assert.equal(result.battle.summary.defeatedMonsterCount, 1);
    assert.equal(result.battle.log.length, 1);
    const stored = JSON.parse(firestore.data.get('dnd_rnr/main/session_battles/1').data);
    assert.deepEqual(stored.summary, result.battle.summary);
  } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); db.close(); }
});

test('battle and character damage commit atomically to Firestore and survive reopening', async () => {
  const firestore = cloud();
  const db = await openFirestoreDatabase(firestore);
  const stats = emptyStatistics();
  stats.spells.selections.prepared = ['healing-word'];
  Object.assign(stats.values, { hp: 20, maxHp: 20, tempHp: 3, ac: 12, str: 12, dex: 12, con: 12, cha: 16 });
  await db.run(() => {
    db.exec(`UPDATE users SET role = 'gm' WHERE id = 1;
      INSERT INTO users VALUES (2,'hero','Hero','unused','player');
      INSERT INTO games (id,gm_id,name) VALUES (1,1,'Battle game');
      INSERT INTO game_sessions (id,game_id,started_at) VALUES (1,1,1);
      INSERT INTO characters (id,user_id,name,class) VALUES (1,2,'Hero','Bard');
      INSERT INTO game_members (id,game_id,character_id,status) VALUES (1,1,1,'accepted');
      INSERT INTO session_participants VALUES (1,1,1);
      INSERT INTO game_monster_entries VALUES (1,'enemy','Enemy',20,10,30,'','{}');`);
    db.prepare('INSERT INTO character_statistics VALUES (?, ?)').run(1, JSON.stringify(stats));
  });
  const request = (connection, action = '', body = {}, user = { id: 1, role: 'gm' }) => connection.run(() => {
    let result;
    handleBattles(connection, user, `/api/games/1/battle${action ? '/' + action : ''}`, action ? 'POST' : 'GET', { sessionId: 1, ...body }, (status, data) => { result = { status, ...data }; });
    return result;
  });
  try {
    const started = await request(db, 'start', { version: 0, fighters: [{ memberId: 1, initiative: 20 }, { enemyId: 'enemy', initiative: 10 }] });
    assert.equal(started.status, 200);
    assert.ok(firestore.data.has('dnd_rnr/main/session_battles/1'));
    const effect = { version: 1, kind: 'resolve', note: 'Damage test', targetId: started.battle.fighters[0].id, effect: 'damage', amount: 10 };
    firestore.failNextCommit();
    await assert.rejects(request(db, 'act', effect), /Cloud unavailable/);
    assert.equal((await request(db)).battle.fighters[0].hp, 20);
    assert.equal(JSON.parse(firestore.data.get('dnd_rnr/main/character_statistics/1').data).values.hp, 20);
    assert.equal((await request(db, 'act', effect)).battle.fighters[0].hp, 13);
    const casting = { version: 2, kind: 'cast', slot: 'bonus', actorId: started.battle.fighters[0].id,
      spellId: 'healing-word', source: 'slot', level: 1, targetIds: [started.battle.fighters[0].id] };
    firestore.failNextCommit();
    await assert.rejects(request(db, 'act', casting, { id: 2, role: 'player' }), /Cloud unavailable/);
    await db.run(() => assert.equal(resourceState(db, 1).spent[0], 0));
    assert.equal((await request(db)).battle.pending, null);
    const cast = await request(db, 'act', casting, { id: 2, role: 'player' });
    assert.equal(cast.status, 200, cast.error);
    assert.equal(JSON.parse(firestore.data.get('dnd_rnr/main/character_spell_resources/1').data).spent[0], 1);
    const reopened = await openFirestoreDatabase(firestore);
    try {
      assert.equal((await request(reopened)).battle.fighters[0].hp, 13);
      await reopened.run(() => assert.equal(JSON.parse(reopened.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data).values.hp, 13));
    } finally { reopened.close(); }
  } finally { db.close(); }
});

test('monster catalogs commit to Firestore, survive reopening and roll back failed writes', async () => {
  const firestore = cloud();
  const db = await openFirestoreDatabase(firestore);
  await db.run(() => db.exec(`UPDATE users SET role = 'gm' WHERE id = 1;
    INSERT INTO games (id, gm_id, name) VALUES (1, 1, 'Monster game');`));
  const request = (connection, action = '', body = {}) => connection.run(() => {
    let result;
    handleMonsters(connection, { id: 1, role: 'gm' }, `/api/games/1/monsters${action ? '/' + action : ''}`, action ? 'POST' : 'GET', body, (status, data) => { result = { status, ...data }; });
    return result;
  });
  try {
    const first = await request(db);
    assert.equal(first.monsters.length, 0);
    for (const sample of samples) await request(db, 'create', { monster: sample });
    assert.ok(firestore.data.has('dnd_rnr/main/game_monsters/1'));
    assert.equal([...firestore.data.keys()].filter(key => key.startsWith('dnd_rnr/main/game_monster_entries/')).length, 5);
    const monster = { ...(await request(db)).monsters[0], hp: 77 };
    firestore.failNextCommit();
    await assert.rejects(request(db, 'update', { monster }), /Cloud unavailable/);
    assert.notEqual((await request(db)).monsters[0].hp, 77);
    const before = new Map([...firestore.data].map(([key, value]) => [key, JSON.stringify(value)]));
    await request(db, 'update', { monster });
    const changed = [...firestore.data].filter(([key, value]) => before.get(key) !== JSON.stringify(value)).map(([key]) => key).sort();
    assert.deepEqual(changed, ['dnd_rnr/main', `dnd_rnr/main/game_monster_entries/1~${monster.id}`]);
    const reopened = await openFirestoreDatabase(firestore);
    try {
      assert.equal((await request(reopened)).monsters[0].hp, 77);
      await request(reopened, 'delete', { id: monster.id });
      assert.equal((await request(db)).monsters.length, 4);
    } finally { reopened.close(); }
  } finally { db.close(); }
});

// Transactional test double: writes are applied only after successful commit.
function cloud() {
  const data = new Map();
  const root = 'dnd_rnr/main';
  const source = openDatabase(':memory:');
  source.prepare("INSERT INTO users VALUES (1, 'owner', 'Owner', 'hash', 'player')").run();
  for (const [table, rows] of Object.entries(exportRows(source))) {
    for (const row of rows) data.set(`${root}/${table}/${rowId(table, row)}`, row);
  }
  source.close();
  data.set(root, { revision: 1, schemaVersion: 1 });
  const watchers = new Set();
  const notify = () => {
    for (const watcher of watchers) queueMicrotask(() => {
      if (watchers.has(watcher)) watcher.next({ exists: true, get: field => data.get(root)?.[field] });
    });
  };
  const collection = path => ({ path, doc: id => ({ path: `${path}/${id}`, collection: name => collection(`${path}/${id}/${name}`),
    onSnapshot(next, error) {
      assert.equal(`${path}/${id}`, root, 'Only metadata may be watched');
      const watcher = { next, error }; watchers.add(watcher);
      queueMicrotask(() => { if (watchers.has(watcher)) next({ exists: true, get: field => data.get(root)?.[field] }); });
      return () => watchers.delete(watcher);
    },
  }) });
  let reject = false;
  return {
    collection,
    failNextCommit() { reject = true; },
    data,
    watcherCount: () => watchers.size,
    failWatch() { for (const watcher of [...watchers]) watcher.error(new Error('Watch unavailable')); },
    async runTransaction(work, { maxAttempts = 1 } = {}) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const snapshot = new Map([...data].map(([key, value]) => [key, structuredClone(value)]));
      const writes = [];
      const output = await work({
        get: async ref => {
          if (ref.path.split('/').length % 2 === 0) {
            const value = structuredClone(snapshot.get(ref.path));
            return { exists: value !== undefined, get: field => value?.[field] };
          }
          return { docs: [...snapshot].filter(([key]) => key.startsWith(ref.path + '/') && key.split('/').length === ref.path.split('/').length + 1)
            .map(([, value]) => ({ data: () => structuredClone(value) })) };
        },
        set: (ref, value) => writes.push(() => data.set(ref.path, structuredClone(value))),
        delete: ref => writes.push(() => data.delete(ref.path)),
        update: (ref, value) => writes.push(() => data.set(ref.path, { ...data.get(ref.path), ...value })),
      });
      if (reject) { reject = false; throw new Error('Cloud unavailable'); }
      if (data.get(root).revision !== snapshot.get(root).revision) {
        if (attempt + 1 === maxAttempts) throw new Error('Transaction contention');
        continue;
      }
      for (const write of writes) write();
      if (writes.length) notify();
      return output;
      }
    },
  };
}

test('SSE coalesces refreshes and never publishes a change from a failed transaction', async () => {
  const firestore = cloud();
  const db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    db.exec("UPDATE users SET role = 'gm' WHERE id = 1; INSERT INTO games (id, gm_id, name) VALUES (1, 1, 'Events');");
    db.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run('events', Date.now() + 60000);
  });
  const events = createGameEvents(db);
  const clients = [];
  try {
    for (let i = 0; i < 2; i++) {
      const client = { gameId: 1, userId: 1, token: 'events' };
      await db.run(() => { client.fingerprint = events.fingerprint(client); });
      const res = new EventEmitter(); res.messages = []; res.writeHead = () => {};
      res.write = message => { res.messages.push(message); return true; };
      res.end = () => { res.emit('close'); }; res.destroy = res.end;
      events.subscribe(new EventEmitter(), res, client); clients.push(res);
    }
    await db.run(() => db.prepare("UPDATE games SET name = 'Changed' WHERE id = 1").run());
    const before = db.metrics();
    await Promise.all([events.publish(), events.publish()]);
    assert.equal(db.metrics().transactions - before.transactions, 1);
    for (const res of clients) assert.equal(res.messages.filter(message => message.includes('event: change')).length, 1);
    await db.run(() => db.prepare("UPDATE games SET name = 'Another' WHERE id = 1").run());
    firestore.failNextCommit();
    await events.publish();
    for (const res of clients) assert.equal(res.messages.filter(message => message.includes('event: change')).length, 1);
  } finally { clients.forEach(res => res.end()); db.close(); }
});

test('shared root watch notifies another instance only after commit, stays idle without reads and revokes sessions', async () => {
  const firestore = cloud();
  const writer = await openFirestoreDatabase(firestore);
  await writer.run(() => writer.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run('sync', Date.now() + 60000));
  const reader = await openFirestoreDatabase(firestore);
  const events = createGameEvents(reader, { heartbeatMs: 5 });
  const responses = [];
  const waitFor = async condition => {
    for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(condition(), 'Timed out waiting for a committed notification');
  };
  const subscribe = () => {
    const res = new EventEmitter(); res.messages = [];
    res.writeHead = () => {};
    res.write = message => { res.messages.push(message); return true; };
    res.end = () => { res.writableEnded = true; res.emit('close'); }; res.destroy = res.end;
    events.subscribe(new EventEmitter(), res, { userId: 1, token: 'sync' });
    responses.push(res); return res;
  };
  try {
    const first = subscribe(), second = subscribe();
    await waitFor(() => responses.every(res => res.messages.some(value => value.includes('event: ready'))));
    assert.equal(firestore.watcherCount(), 1);
    const before = reader.metrics();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(reader.metrics().documentReads, before.documentReads, 'Heartbeats must not query Firestore');
    assert.ok(first.messages.some(value => value.includes('keep-alive')));
    const changes = res => res.messages.filter(value => value.includes('event: change')).length;
    firestore.failNextCommit();
    await assert.rejects(writer.run(() => writer.prepare("UPDATE users SET name = 'Rolled back' WHERE id = 1").run()), /Cloud unavailable/);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(changes(first), 0); assert.equal(changes(second), 0);
    await writer.run(() => writer.prepare("UPDATE users SET name = 'From another instance' WHERE id = 1").run());
    await waitFor(() => changes(first) === 1 && changes(second) === 1);
    await reader.run(() => assert.equal(reader.prepare('SELECT name FROM users WHERE id = 1').get().name, 'From another instance'));
    assert.doesNotMatch(first.messages.join(''), /another instance|users|revision|token/);
    await writer.run(() => writer.prepare("DELETE FROM sessions WHERE token = 'sync'").run());
    await waitFor(() => responses.every(res => res.writableEnded));
    assert.ok(first.messages.some(value => value.includes('event: expired')));
    assert.equal(firestore.watcherCount(), 0);
    assert.equal(reader.metrics().watchStarts, 1); assert.equal(reader.metrics().watchStops, 1);
    await writer.run(() => writer.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run('sync', Date.now() + 60000));
    const reconnected = subscribe();
    await waitFor(() => reconnected.messages.some(value => value.includes('event: ready')));
    firestore.failWatch();
    assert.equal(reconnected.writableEnded, true); assert.equal(firestore.watcherCount(), 0);
  } finally { responses.forEach(res => res.end()); writer.close(); reader.close(); }
});

test('a commit arriving while notification delivery is pending gets another refresh pass', async () => {
  const firestore = cloud();
  const writer = await openFirestoreDatabase(firestore);
  await writer.run(() => writer.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run('pending', Date.now() + 60000));
  const reader = await openFirestoreDatabase(firestore);
  const events = createGameEvents(reader);
  const res = new EventEmitter(); res.messages = []; res.writeHead = () => {};
  res.write = text => { res.messages.push(text); return true; };
  res.end = () => res.emit('close'); res.destroy = res.end;
  const flush = () => new Promise(resolve => setTimeout(resolve, 10));
  let release;
  try {
    events.subscribe(new EventEmitter(), res, { userId: 1, token: 'pending' });
    await events.publish(); await flush();
    const originalRun = reader.run.bind(reader);
    let block = true;
    let entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    reader.run = async work => {
      const output = await originalRun(work);
      if (block) { block = false; entered(); await barrier; }
      return output;
    };
    await writer.run(() => writer.prepare("UPDATE users SET name = 'First commit' WHERE id = 1").run());
    await waiting;
    await writer.run(() => writer.prepare("UPDATE users SET name = 'Second commit' WHERE id = 1").run());
    release(); await events.publish();
    assert.equal(res.messages.filter(message => message.includes('event: change')).length, 2);
    await reader.run(() => assert.equal(reader.prepare('SELECT name FROM users WHERE id = 1').get().name, 'Second commit'));
  } finally { release?.(); res.end(); writer.close(); reader.close(); }
});

test('SSE ends before the Vercel deadline and releases its Firestore watch', async () => {
  const firestore = cloud();
  const db = await openFirestoreDatabase(firestore);
  await db.run(() => db.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run('deadline', Date.now() + 60000));
  const events = createGameEvents(db, { maxAgeMs: 25 });
  const res = new EventEmitter(); let ended = false;
  res.writeHead = () => {}; res.write = () => true;
  res.end = () => { ended = true; res.emit('close'); }; res.destroy = res.end;
  try {
    events.subscribe(new EventEmitter(), res, { userId: 1, token: 'deadline' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(ended, true); assert.equal(firestore.watcherCount(), 0);
  } finally { res.end(); db.close(); }
});

test('new sync endpoint accepts authenticated players, rejects strangers and streams no private payload', async () => {
  const firestore = cloud();
  const db = await openFirestoreDatabase(firestore);
  await db.run(() => db.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run(createHash('sha256').update('sync-http').digest('hex'), Date.now() + 60000));
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const abort = new AbortController();
  const url = `http://127.0.0.1:${app.address().port}/api/sync/events`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Cookie: 'session=invalid' } })).status, 401);
    const response = await fetch(url, { headers: { Cookie: 'session=sync-http' }, signal: abort.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const stream = response.body.getReader();
    let text = '';
    while (!text.includes('event: ready')) text += new TextDecoder().decode((await stream.read()).value);
    assert.match(text, /data: \{\}/); assert.doesNotMatch(text, /Owner|hash|sync-http|revision/);
  } finally {
    abort.abort(); app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
    await new Promise(resolve => setImmediate(resolve)); db.close();
  }
});

test('startup uses one transaction and unchanged reads query only the root', async () => {
  const db = await openFirestoreDatabase(cloud());
  try {
    assert.equal(db.metrics().transactions, 1);
    assert.equal(db.metrics().fullReloads, 1);
    const before = db.metrics();
    await db.run(() => {});
    assert.equal(db.metrics().documentReads - before.documentReads, 1);
    assert.equal(db.metrics().collectionQueries, before.collectionQueries);
    assert.equal(db.metrics().documentWrites, before.documentWrites);
  } finally { db.close(); }
});

test('partial refresh spans skipped revisions, deletes and legacy writers safely', async () => {
  const firestore = cloud();
  const first = await openFirestoreDatabase(firestore);
  // Establish tracking, as an existing migrated database has no table metadata.
  await first.run(() => first.prepare("UPDATE users SET name = 'Tracked' WHERE id = 1").run());
  const second = await openFirestoreDatabase(firestore);
  try {
    await first.run(() => first.prepare("UPDATE users SET name = 'New' WHERE id = 1").run());
    await first.run(() => first.prepare("INSERT INTO sessions VALUES ('token', 1, 123)").run());
    const before = second.metrics();
    await second.run(() => {
      assert.equal(second.prepare('SELECT name FROM users WHERE id = 1').get().name, 'New');
      assert.equal(second.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    });
    assert.equal(second.metrics().collectionQueries - before.collectionQueries, 2);
    await first.run(() => first.prepare('DELETE FROM sessions').run());
    await second.run(() => assert.equal(second.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0));
    assert.equal(second.metrics().fullReloads, before.fullReloads);
    // Old scripts preserve unknown metadata and increment only global revision.
    firestore.data.get('dnd_rnr/main').revision++;
    firestore.data.get('dnd_rnr/main/users/1').name = 'Legacy';
    await second.run(() => assert.equal(second.prepare('SELECT name FROM users WHERE id = 1').get().name, 'Legacy'));
    assert.equal(second.metrics().fullReloads, before.fullReloads + 1);
  } finally { first.close(); second.close(); }
});

test('simultaneous instances retry against fresh state without losing another writer changes', async () => {
  const firestore = cloud();
  const first = await openFirestoreDatabase(firestore);
  const second = await openFirestoreDatabase(firestore);
  try {
    await Promise.all([
      first.run(async () => { await Promise.resolve(); first.prepare("UPDATE users SET name = 'Concurrent' WHERE id = 1").run(); }),
      second.run(async () => { await Promise.resolve(); second.prepare("UPDATE users SET username = 'concurrent' WHERE id = 1").run(); }),
    ]);
    assert.ok(first.metrics().attempts + second.metrics().attempts > first.metrics().transactions + second.metrics().transactions);
    for (const db of [first, second]) await db.run(() => {
      const user = db.prepare('SELECT * FROM users WHERE id = 1').get();
      assert.equal(user.name, 'Concurrent'); assert.equal(user.username, 'concurrent');
    });
  } finally { first.close(); second.close(); }
});

test('statistics revisions reject a competing instance after Firestore retries against a newer commit', async () => {
  const firestore = cloud();
  const first = await openFirestoreDatabase(firestore);
  await first.run(() => {
    first.exec("INSERT INTO characters (id,user_id,name,class,level) VALUES (1,1,'Hero','Wojownik (Fighter)',1)");
    const stats = emptyStatistics();
    stats.traits.languages = ['elvish', 'dwarvish']; stats.traits.classSkills = ['acrobatics', 'athletics'];
    stats.values.hp = 11;
    first.prepare('INSERT INTO character_statistics VALUES (1, ?)').run(JSON.stringify(stats));
  });
  const second = await openFirestoreDatabase(firestore);
  const request = (connection, method, body = {}) => connection.run(() => {
    let result;
    handleStatistics(connection, { id: 1, role: 'player' }, '/api/characters/1/statistics', method, body,
      (status, data) => { result = { status, ...data }; });
    return result;
  });
  try {
    const snapshot = await request(first, 'GET');
    const makeBody = hp => ({ ...structuredClone(snapshot.statistics), expectedRevision: snapshot.revision,
      values: { ...snapshot.statistics.values, hp } });
    const results = await Promise.all([request(first, 'POST', makeBody(9)), request(second, 'POST', makeBody(8))]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const accepted = results.find(result => result.status === 200);
    const fresh = await request(second, 'GET');
    assert.equal(fresh.statistics.values.hp, accepted.statistics.values.hp);
    assert.equal(fresh.revision, accepted.revision);
    assert.ok(first.metrics().attempts + second.metrics().attempts > first.metrics().transactions + second.metrics().transactions);
    const before = first.metrics().documentWrites;
    assert.equal((await request(first, 'POST', makeBody(1))).status, 409);
    assert.equal(first.metrics().documentWrites, before);
  } finally { first.close(); second.close(); }
});

test('cost benchmark: seven instances, 30 writes and 210 synchronized reads', async t => {
  async function scenario(legacy) {
    const firestore = cloud();
    const clients = [];
    for (let i = 0; i < 7; i++) clients.push(await openFirestoreDatabase(firestore));
    const started = performance.now();
    try {
      for (let turn = 0; turn < 30; turn++) {
        const writer = clients[turn % clients.length];
        await writer.run(() => writer.prepare('UPDATE users SET name = ? WHERE id = 1').run(`Turn ${turn}`));
        // Reproduce the old global invalidation policy, with the same workload.
        if (legacy) delete firestore.data.get('dnd_rnr/main').trackedRevision;
        await Promise.all(clients.map(db => db.run(() => {
          assert.equal(db.prepare('SELECT name FROM users WHERE id = 1').get().name, `Turn ${turn}`);
        })));
      }
      const totals = {};
      for (const db of clients) for (const [key, value] of Object.entries(db.metrics())) totals[key] = (totals[key] || 0) + value;
      return { ...totals, wallMs: Math.round(performance.now() - started) };
    } finally { clients.forEach(db => db.close()); }
  }
  const before = await scenario(true), after = await scenario(false);
  assert.ok(after.documentReads < before.documentReads / 2);
  assert.equal(before.documentWrites, after.documentWrites);
  t.diagnostic(JSON.stringify({ before, after }));
});

test('Firestore preserves IDs and password hashes, refreshes between processes, and persists deletion', async () => {
  const firestore = cloud();
  const first = await openFirestoreDatabase(firestore);
  const second = await openFirestoreDatabase(firestore);
  try {
    await first.run(() => first.prepare("UPDATE users SET name = 'Updated' WHERE id = 1").run());
    await second.run(() => assert.deepEqual({ ...second.prepare('SELECT * FROM users WHERE id = 1').get() }, {
      id: 1, username: 'owner', name: 'Updated', password: 'hash', role: 'player',
    }));
    await second.run(() => second.prepare('DELETE FROM users WHERE id = 1').run());
    await first.run(() => assert.equal(first.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0));
  } finally { first.close(); second.close(); }
});

test('cloud commit failure discards changes and does not poison later requests', async () => {
  const firestore = cloud();
  const db = await openFirestoreDatabase(firestore);
  try {
    firestore.failNextCommit();
    await assert.rejects(db.run(() => db.prepare("UPDATE users SET name = 'Lost' WHERE id = 1").run()), /Cloud unavailable/);
    await db.run(() => assert.equal(db.prepare('SELECT name FROM users WHERE id = 1').get().name, 'Owner'));
    await Promise.all(['One', 'Two'].map(name => db.run(async () => {
      await Promise.resolve();
      db.prepare('UPDATE users SET name = ? WHERE id = 1').run(name);
    })));
    await db.run(() => assert.equal(db.prepare('SELECT name FROM users WHERE id = 1').get().name, 'Two'));
  } finally { db.close(); }
});

test('HTTP does not return a successful response when Firestore cannot commit', async () => {
  const firestore = cloud();
  const db = await openFirestoreDatabase(firestore);
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    firestore.failNextCommit();
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/me`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await fetch(`http://127.0.0.1:${app.address().port}/api/me`)).status, 401);
  } finally { await new Promise(resolve => app.close(resolve)); db.close(); }
});

test('invalid relationships are rejected before persisting a snapshot', () => {
  const db = openDatabase(':memory:');
  const rows = exportRows(db);
  db.close();
  rows.characters.push({ id: 1, user_id: 999, name: 'Invalid', class: 'Bard', level: 1, species: '', background: '', subclass: '' });
  assert.throws(() => hydrate(rows), /Invalid foreign keys/);
  assert.equal(tables.includes('users'), true);
});

test('milestone completion and history commit together, roll back on cloud failure and survive reopening', async () => {
  const firestore = cloud();
  const db = await openFirestoreDatabase(firestore);
  const gm = { id: 1, role: 'gm', name: 'GM' }, owner = { id: 2, role: 'player', name: 'Owner' };
  const request = (user, path, method = 'GET', body = {}) => {
    let response;
    handleAdvancement(db, user, `/api${path}`, method, body, (status, data) => { response = { status, ...data }; });
    return response;
  };
  try {
    await db.run(() => {
      db.exec(`UPDATE users SET role='gm' WHERE id=1;
        INSERT INTO users VALUES (2,'hero','Hero','unused','player');
        INSERT INTO games (id,gm_id,name) VALUES (1,1,'Milestone game');
        INSERT INTO characters (id,user_id,name,class,level,species,background,subclass) VALUES (1,2,'Hero','Wojownik (Fighter)',1,'Ork (Orc)','Żołnierz (Soldier)','');
        INSERT INTO game_members VALUES (1,1,1,'accepted');`);
      const character = db.prepare('SELECT * FROM characters WHERE id=1').get();
      const stats = emptyStatistics();
      Object.assign(stats.values, { con: 14, maxHp: 12, hp: 4 });
      stats.choices = { weaponMastery: ['longsword','shortsword','longbow'], fightingStyle: 'defense', fastCrafting: '' };
      for (const group of characterTraits(character, stats).groups) stats.traits[group.id] = group.options.slice(0, group.limit).map(o => o.id);
      db.prepare('INSERT INTO character_statistics VALUES (1,?)').run(JSON.stringify(stats));
    });
    await db.run(() => assert.equal(request(gm, '/games/1/advancements', 'POST', { characterIds: [1], reason: 'Victory' }).status, 201));
    let data;
    await db.run(() => { data = request(owner, '/characters/1/advancement'); });
    const body = { id: data.pending.id, version: data.pending.version, base: data.base, draft: {} };
    firestore.failNextCommit();
    await assert.rejects(db.run(() => assert.equal(request(owner, '/characters/1/advancement/complete', 'POST', body).status, 200)), /Cloud unavailable/);
    await db.run(() => {
      const unchanged = request(owner, '/characters/1/advancement');
      assert.equal(unchanged.character.level, 1);
      assert.equal(unchanged.pending.status, 'pending');
      assert.equal(unchanged.statistics.values.maxHp, 12);
    });
    await db.run(() => assert.equal(request(owner, '/characters/1/advancement/complete', 'POST', body).status, 200));
    const reopened = await openFirestoreDatabase(firestore);
    try {
      await reopened.run(() => {
        assert.equal(reopened.prepare('SELECT level FROM characters WHERE id=1').get().level, 2);
        const stats = JSON.parse(reopened.prepare('SELECT data FROM character_statistics WHERE character_id=1').get().data);
        assert.equal(stats.values.maxHp, 20); assert.equal(stats.values.hp, 4);
        const advancement = JSON.parse(reopened.prepare('SELECT data FROM character_advancements WHERE id=?').get(body.id).data);
        assert.equal(advancement.status, 'completed'); assert.equal(advancement.before.level, 1);
      });
    } finally { reopened.close(); }
  } finally { db.close(); }
});
