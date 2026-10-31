import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { handleMonsters } from './monsters.mjs';
import { exportRows, hydrate, rowId } from './firestore.mjs';
import samples from '../shared/sample-monsters.json' with { type: 'json' };

test('game monster catalogs isolate games, validate changes, and survive persistence', () => {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO users VALUES (1, 'gm', 'GM', 'unused', 'gm'), (2, 'other', 'Other', 'unused', 'gm');
    INSERT INTO games (id, gm_id, name) VALUES (1, 1, 'First'), (2, 2, 'Second'), (3, 1, 'Third');`);
  const call = (gameId, action = '', body = {}, user = { id: 1, role: 'gm' }) => {
    let result;
    assert.equal(handleMonsters(db, user, `/api/games/${gameId}/monsters${action ? '/' + action : ''}`, action ? 'POST' : 'GET', body, (status, data) => { result = { status, ...data }; }), true);
    return result;
  };
  try {
    assert.equal(call(2).status, 404);
    assert.equal(call(1, '', {}, { id: 1, role: 'player' }).status, 404);
    assert.equal(call(1).monsters.length, 0);
    for (const sample of samples) assert.equal(call(1, 'create', { monster: sample }).status, 200);
    const monster = { ...call(1).monsters[0], id: 'custom', name: 'Custom' };
    const sample = { ...call(1).monsters[0], hp: 33 };
    assert.equal(call(1, 'import', { monster: sample }).monsters[0].hp, 33);
    assert.equal(call(1, 'import', { monster: { ...sample, hp: 34 } }).monsters[0].hp, 33);
    assert.equal(call(1, 'create', { monster: { ...monster, hp: -1 } }).status, 400);
    assert.equal(call(1, 'create', { monster: { ...monster, saves: {} } }).status, 400);
    assert.equal(call(1, 'create', { monster }).monsters.length, 6);
    assert.equal(call(3).monsters.length, 0);
    assert.equal(call(1, 'create', { monster }).status, 409);
    const edited = { ...monster, hp: 44 };
    assert.equal(call(1, 'update', { monster: edited }).monsters.find(m => m.id === 'custom').hp, 44);
    assert.equal(call(1, 'import', { monster }).monsters.find(m => m.id === 'custom').hp, 44);
    const rows = exportRows(db);
    assert.equal(rowId('game_monster_entries', rows.game_monster_entries.find(m => m.id === 'custom')), '1~custom');
    const restored = hydrate(rows);
    try { assert.equal(restored.prepare("SELECT hp FROM game_monster_entries WHERE game_id = 1 AND id = 'custom'").get().hp, 44); }
    finally { restored.close(); }
    for (const m of call(1).monsters) assert.equal(call(1, 'delete', { id: m.id }).status, 200);
    assert.equal(call(1).monsters.length, 0);
    assert.equal(call(1, 'update', { monster }).status, 404);
    assert.equal(call(1, 'delete', { id: 'custom' }).status, 404);
  } finally { db.close(); }
});

test('legacy catalogs migrate once, preserve empty games and keep the same monster IDs', () => {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO users VALUES (1, 'gm', 'GM', 'unused', 'gm');
    INSERT INTO games (id, gm_id, name) VALUES (1, 1, 'Legacy'), (2, 1, 'Empty');`);
  const monster = { id: 'legacy', name: 'Legacy monster', hp: 33, ac: 12, speed: 30, notes: 'Notes', saves: { str: 1, dex: 2, con: 0, int: -1, wis: 0, cha: 0 } };
  db.prepare('INSERT INTO game_monsters VALUES (?, ?)').run(1, JSON.stringify([monster]));
  db.prepare('INSERT INTO game_monsters VALUES (?, ?)').run(2, '[]');
  const load = id => {
    let result;
    handleMonsters(db, { id: 1, role: 'gm' }, `/api/games/${id}/monsters`, 'GET', {}, (status, data) => { assert.equal(status, 200); result = data.monsters; });
    return result;
  };
  try {
    assert.deepEqual(load(1), [monster]);
    assert.deepEqual(load(1), [monster]);
    assert.deepEqual(load(2), []);
    assert.equal(db.prepare('SELECT data FROM game_monsters WHERE game_id = 1').get().data, '[]');
    assert.equal(db.prepare('SELECT count(*) AS n FROM game_monster_entries').get().n, 1);
  } finally { db.close(); }
});
