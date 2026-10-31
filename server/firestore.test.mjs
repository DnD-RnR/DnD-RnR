import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { openFirestoreDatabase, exportRows, tables, rowId, hydrate } from './firestore.mjs';
import { createApp } from './index.mjs';
import { handleMonsters } from './monsters.mjs';
import { handleBattles } from './battles.mjs';
import { emptyStatistics } from './statistics.mjs';
import samples from '../shared/sample-monsters.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { resourceState } from './spell-resources.mjs';

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
  const collection = path => ({ path, doc: id => ({ path: `${path}/${id}`, collection: name => collection(`${path}/${id}/${name}`) }) });
  let reject = false;
  return {
    collection,
    failNextCommit() { reject = true; },
    data,
    async runTransaction(work) {
      const writes = [];
      const output = await work({
        get: async ref => {
          if (ref.path.split('/').length % 2 === 0) {
            const value = structuredClone(data.get(ref.path));
            return { exists: value !== undefined, get: field => value?.[field] };
          }
          return { docs: [...data].filter(([key]) => key.startsWith(ref.path + '/') && key.split('/').length === ref.path.split('/').length + 1)
            .map(([, value]) => ({ data: () => structuredClone(value) })) };
        },
        set: (ref, value) => writes.push(() => data.set(ref.path, structuredClone(value))),
        delete: ref => writes.push(() => data.delete(ref.path)),
        update: (ref, value) => writes.push(() => data.set(ref.path, { ...data.get(ref.path), ...value })),
      });
      if (reject) { reject = false; throw new Error('Cloud unavailable'); }
      for (const write of writes) write();
      return output;
    },
  };
}

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
