import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { createApp } from './index.mjs';
import { emptyStatistics } from './statistics.mjs';

async function fixture(work) {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO users VALUES (1,'owner','Owner','unused','player'),(2,'stranger','Stranger','unused','player');
    INSERT INTO characters (id,user_id,name,class,level) VALUES (1,1,'Hero','Wojownik (Fighter)',1);`);
  const base = emptyStatistics();
  base.traits.languages = ['elvish', 'dwarvish'];
  base.traits.classSkills = ['acrobatics', 'athletics'];
  Object.assign(base.values, { str: 16, dex: 15, con: 12, int: 11, wis: 13, cha: 8, hp: 11, maxHp: 11 });
  db.prepare('INSERT INTO character_statistics VALUES (1, ?)').run(JSON.stringify(base));
  for (const [token, id] of [['tab-a', 1], ['tab-b', 1], ['stranger', 2]]) {
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), id, Date.now() + 60000);
  }
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const request = async (body, token = 'tab-a') => {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/characters/1/statistics`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: `session=${token}`, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, ...await response.json() };
  };
  const stored = () => JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
  const edit = snapshot => ({ ...structuredClone(snapshot.statistics), expectedRevision: snapshot.revision });
  try { await work({ db, request, stored, edit }); }
  finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); db.close(); }
}

test('an older statistics form cannot restore HP or replace newer notes outside battle', async () => fixture(async ({ request, stored, edit }) => {
  const first = await request(), other = await request(undefined, 'tab-b');
  assert.equal(first.revision, other.revision);
  const fresh = edit(first); fresh.values.hp = 10; fresh.notes.features = 'Newer note';
  const saved = await request(fresh);
  assert.equal(saved.status, 200); assert.notEqual(saved.revision, first.revision);
  const stale = edit(other); stale.notes.conditions = 'Edited in the older tab';
  const conflict = await request(stale, 'tab-b');
  assert.equal(conflict.status, 409);
  assert.equal(stored().values.hp, 10); assert.equal(stored().notes.features, 'Newer note');
  assert.equal(stored().notes.conditions, '');
  // The client still owns the rejected draft and can explicitly reload/re-edit.
  assert.equal(stale.notes.conditions, 'Edited in the older tab');
  const reloaded = await request(undefined, 'tab-b');
  const retry = edit(reloaded); retry.notes.conditions = stale.notes.conditions;
  assert.equal((await request(retry, 'tab-b')).status, 200);
  assert.equal(stored().values.hp, 10); assert.equal(stored().notes.conditions, stale.notes.conditions);
}));

test('two concurrent HTTP edits accept one version and reject the other without a partial save', async () => fixture(async ({ request, stored, edit }) => {
  const snapshot = await request();
  const left = edit(snapshot), right = edit(snapshot);
  left.values.hp = 9; left.notes.features = 'left'; right.values.hp = 8; right.notes.features = 'right';
  const results = await Promise.all([request(left), request(right, 'tab-b')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? left : right;
  assert.equal(stored().values.hp, winner.values.hp); assert.equal(stored().notes.features, winner.notes.features);
}));

test('old clients and malformed revisions cannot silently bypass concurrency checks', async () => fixture(async ({ request, stored, edit }) => {
  const snapshot = await request(), before = stored();
  for (const token of [undefined, null, 3, '', 'invalid']) {
    const body = edit(snapshot); body.values.hp = 1;
    if (token === undefined) delete body.expectedRevision; else body.expectedRevision = token;
    assert.equal((await request(body)).status, 428);
    assert.deepEqual(stored(), before);
  }
  const forged = edit(snapshot); forged.expectedRevision = '0'.repeat(64);
  assert.equal((await request(forged)).status, 409);
  const privateRead = await request(undefined, 'stranger');
  assert.equal(privateRead.status, 404); assert.equal(privateRead.revision, undefined);
  assert.equal((await request(edit(snapshot), 'stranger')).status, 404);
}));

test('changes from other writers, advancement and armor invalidate an open statistics form', async () => fixture(async ({ db, request, stored, edit }) => {
  for (const change of [
    () => { const stats = stored(); stats.choices.weaponMastery = ['longsword']; db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats)); },
    () => db.exec('UPDATE characters SET level = 2 WHERE id = 1'),
    () => db.exec("INSERT INTO character_items (character_id,name,quantity,slot,equipped,armor_id) VALUES (1,'Shield',1,'off-hand',1,'shield')"),
  ]) {
    const snapshot = await request(); change(); const before = stored();
    const result = await request(edit(snapshot));
    assert.equal(result.status, 409); assert.deepEqual(stored(), before);
    assert.notEqual((await request()).revision, snapshot.revision);
  }
}));

test('the first statistics save uses a revision for the empty card and returns a reusable version', async () => fixture(async ({ db, request, edit }) => {
  db.exec('DELETE FROM character_statistics WHERE character_id = 1');
  const empty = await request(); assert.equal(empty.status, 200);
  const body = edit(empty); body.traits.languages = ['elvish', 'dwarvish']; body.traits.classSkills = ['acrobatics', 'athletics'];
  const saved = await request(body); assert.equal(saved.status, 200, saved.error);
  assert.equal(saved.revision, (await request()).revision);
  assert.equal((await request(edit(saved))).status, 200);
}));
