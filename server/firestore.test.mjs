import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { openFirestoreDatabase, exportRows, tables, rowId, hydrate } from './firestore.mjs';
import { createApp } from './index.mjs';

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
