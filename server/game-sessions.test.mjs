import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { createApp } from './index.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statisticsSummary } from './statistics-summary.mjs';
import { emptyStatistics } from './statistics.mjs';

test('GM numeric summaries match character modifiers, proficiencies and manual overrides', () => {
  const character = { class: 'Bard', species: 'Elf', background: 'Mędrzec (Sage)', level: 1, subclass: '' };
  const statistics = emptyStatistics();
  Object.assign(statistics.values, { str: 10, dex: 16, con: 12, int: 8, wis: 14, cha: 18, hp: 0, ac: 14, tempHp: 3, initiativeBonus: 2, spellBonus: 1, spellDcBonus: 2 });
  statistics.skills.perception = 2;
  const summary = statisticsSummary(character, statistics);
  assert.equal(summary.hp, 0);
  assert.equal(summary.maxHp, 9);
  assert.equal(summary.ac, 13);
  assert.equal(summary.speed, 30);
  assert.equal(summary.initiative, 3);
  assert.equal(summary.proficiency, 2);
  assert.equal(summary.passivePerception, 16);
  assert.equal(summary.savingThrows.dex, 5);
  assert.equal(summary.savingThrows.cha, 6);
  assert.equal(summary.skills.perception, 6);
  assert.equal(summary.spellAttack, 7);
  assert.equal(summary.spellDc, 16);
  assert.deepEqual(summary.abilities.int, { score: 8, modifier: -1 });
  assert.equal(summary.notes, undefined);
  statistics.values.maxHp = 24; statistics.values.speed = 0;
  const overridden = statisticsSummary(character, statistics);
  assert.equal(overridden.maxHp, 24);
  assert.equal(overridden.speed, 0);
  const missing = statisticsSummary(character, null);
  assert.equal(missing.hp, null);
  assert.equal(missing.initiative, null);
  assert.equal(missing.passivePerception, null);
  assert.equal(missing.spellAttack, null);
});

test('initiative follows Dexterity and automatic Alert bonus, ignoring legacy manual values', () => {
  const character = { class: 'Bard', species: 'Elf', background: 'Przestępca (Criminal)', level: 1, subclass: '' };
  const statistics = emptyStatistics();
  assert.equal(Object.hasOwn(statistics.values, 'initiativeBonus'), false);
  Object.assign(statistics.values, { dex: 16, initiativeBonus: 12 });
  assert.equal(statisticsSummary(character, statistics).initiative, 5);
  statistics.values.dex = 8;
  assert.equal(statisticsSummary(character, statistics).initiative, 1);
  statistics.values.dex = null;
  assert.equal(statisticsSummary(character, statistics).initiative, null);
});

function seed(db) {
  for (const [id, role] of [[1, 'gm'], [2, 'gm'], [3, 'player'], [4, 'player'], [5, 'player'], [6, 'admin']]) {
    db.prepare('INSERT INTO users (id, username, name, password, role) VALUES (?, ?, ?, ?, ?)').run(id, `user${id}`, `User ${id}`, 'unused', role);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(`test-${id}`).digest('hex'), id, Date.now() + 60000);
  }
  db.exec(`INSERT INTO games (id, gm_id, name) VALUES (1, 1, 'First game'), (2, 2, 'Second game');
    INSERT INTO characters (id, user_id, name, class) VALUES (1, 3, 'Hero', 'Bard'), (2, 4, 'Invited', 'Bard'), (3, 3, 'Second hero', 'Bard'), (4, 3, 'Unassigned', 'Bard'), (5, 4, 'Other hero', 'Bard');
    INSERT INTO game_members (id, game_id, character_id, status) VALUES (1, 1, 1, 'accepted'), (2, 1, 2, 'pending'), (3, 2, 3, 'accepted'), (4, 1, 5, 'accepted');`);
}

test('GM removes selected inventory quantities only from accepted members of their game', async () => {
  const db = openDatabase(':memory:'); seed(db);
  db.exec(`INSERT INTO character_items (id, character_id, name, quantity, slot, equipped) VALUES
    (1, 1, 'Arrows', 10, 'backpack', 0), (2, 1, 'Rings', 2, 'ring-left', 1),
    (3, 2, 'Pending item', 3, 'backpack', 0), (4, 3, 'Other game', 3, 'backpack', 0);`);
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  async function remove(body, userId = 1, gameId = 1) {
    return fetch(`http://127.0.0.1:${app.address().port}/api/games/${gameId}/equipment/remove`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json', Cookie: userId ? `session=test-${userId}` : '' }, body: JSON.stringify(body) });
  }
  const body = { characterId: 1, itemId: 1, quantity: 3 };
  try {
    assert.equal((await remove(body, null)).status, 401);
    for (const userId of [2, 3, 4, 6]) assert.equal((await remove(body, userId)).status, 404);
    for (const quantity of [0, -1, 1.5, '1', null, 10000]) assert.equal((await remove({ ...body, quantity })).status, 400);
    assert.equal((await remove({ ...body, quantity: 11 })).status, 409);
    assert.equal((await remove({ ...body, characterId: 5 })).status, 404);
    assert.equal((await remove({ ...body, characterId: 2, itemId: 3 })).status, 404);
    assert.equal((await remove({ ...body, characterId: 3, itemId: 4 })).status, 404);
    assert.equal((await remove(body)).status, 200);
    assert.equal(db.prepare('SELECT quantity FROM character_items WHERE id = 1').get().quantity, 7);
    assert.equal((await remove({ ...body, quantity: 8 })).status, 409);
    assert.equal((await remove({ ...body, quantity: 7 })).status, 200);
    assert.equal(db.prepare('SELECT id FROM character_items WHERE id = 1').get(), undefined);
    assert.equal((await remove(body)).status, 404);
    assert.equal((await remove({ ...body, itemId: 2, quantity: 1 })).status, 200);
    assert.equal(db.prepare('SELECT equipped FROM character_items WHERE id = 2').get().equipped, 1);
    assert.equal((await remove({ ...body, itemId: 2, quantity: 1 })).status, 200);
    assert.equal(db.prepare('SELECT id FROM character_items WHERE id = 2').get(), undefined);
    db.prepare('DELETE FROM game_members WHERE id = 3').run();
    assert.equal((await remove({ characterId: 3, itemId: 4, quantity: 1 }, 2, 2)).status, 404);
    assert.equal(db.prepare('SELECT quantity FROM character_items WHERE id = 4').get().quantity, 3);
  } finally { await new Promise(resolve => app.close(resolve)); db.close(); }
});

test('GM event stream reports relevant mutations and stops after logout', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  async function request(path, body, userId) {
    return fetch(`http://127.0.0.1:${app.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
      headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json', Cookie: userId ? `session=test-${userId}` : '' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const timeout = (ms, value) => new Promise(resolve => { const timer = setTimeout(() => resolve(value), ms); timer.unref(); });
  async function expectChange(read) {
    const chunk = await Promise.race([read, timeout(3000, null)]);
    assert.ok(chunk, 'Expected a server event after mutation');
    assert.match(new TextDecoder().decode(chunk.value), /event: change/);
    assert.doesNotMatch(new TextDecoder().decode(chunk.value), /Hero|hp|Private/);
  }
  try {
    assert.equal((await request('/games/1/events')).status, 401);
    for (const id of [2, 3, 6]) assert.equal((await request('/games/1/events', undefined, id)).status, 404);
    const response = await request('/games/1/events', undefined, 1);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /retry:/);
    const firstChange = reader.read();
    assert.equal((await request('/games/2/sessions/start', {}, 2)).status, 201);
    assert.equal(await Promise.race([firstChange, timeout(50, 'unchanged')]), 'unchanged');
    const stats = emptyStatistics(); stats.values.hp = 7;
    assert.equal((await request('/characters/1/statistics', stats, 3)).status, 200);
    await expectChange(firstChange);
    const secondChange = reader.read();
    stats.notes.conditions = 'Private note';
    assert.equal((await request('/characters/1/statistics', stats, 3)).status, 200);
    assert.equal(await Promise.race([secondChange, timeout(50, 'unchanged')]), 'unchanged');
    stats.values.hp = 6;
    assert.equal((await request('/characters/1/statistics', stats, 3)).status, 200);
    await expectChange(secondChange);
    const sessionChange = reader.read();
    assert.equal((await request('/games/1/sessions/start', {}, 1)).status, 201);
    await expectChange(sessionChange);
    const ended = reader.read();
    assert.equal((await request('/logout', {}, 1)).status, 200);
    assert.equal((await Promise.race([ended, timeout(3000, {})])).done, true);
  } finally {
    controller.abort();
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
    db.close();
  }
});

test('game membership and session participation have separate, authorized lifecycles', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  async function request(path, body, userId) {
    return fetch(`http://127.0.0.1:${app.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json', Cookie: userId ? `session=test-${userId}` : '' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const json = async (path, userId) => (await request(path, undefined, userId)).json();
  const joinHero = (sessionId, userId = 3, characterId = 1) => request(`/characters/${characterId}/session/join`, { sessionId }, userId);
  try {
    assert.equal((await request('/games/1/sessions/start', {})).status, 401);
    for (const id of [2, 3, 4, 6]) assert.equal((await request('/games/1/sessions/start', {}, id)).status, 404);
    assert.equal((await request('/games/1/sessions/start', undefined, 1)).status, 405);
    assert.deepEqual(await json('/characters/1/session', 3), { game: { id: 1, name: 'First game' }, activeSession: null });
    assert.equal((await joinHero(1)).status, 409);
    const start = await request('/games/1/sessions/start', {}, 1);
    assert.equal(start.status, 201);
    const sessionId = (await start.json()).sessionId;
    assert.equal((await request('/games/1/sessions/start', {}, 1)).status, 409);
    assert.equal((await json('/games/1', 1)).activeSession.id, sessionId);
    assert.equal((await json('/games/1', 1)).members.find(m => m.characterId === 1).participating, false);
    const storedStats = emptyStatistics();
    storedStats.values.hp = 17; storedStats.values.ac = 15;
    storedStats.notes.conditions = 'Private note';
    db.prepare('INSERT INTO character_statistics (character_id, data) VALUES (?, ?)').run(1, JSON.stringify(storedStats));
    const gmMembers = (await json('/games/1', 1)).members;
    assert.equal(gmMembers.find(m => m.characterId === 1).statistics.hp, 17);
    assert.equal(gmMembers.find(m => m.characterId === 1).statistics.ac, null);
    assert.equal(gmMembers.find(m => m.characterId === 1).statistics.notes, undefined);
    assert.equal(gmMembers.find(m => m.characterId === 2).statistics, undefined);
    assert.equal((await request('/games/1', undefined, 2)).status, 404);
    assert.equal((await request('/characters/1/statistics', undefined, 1)).status, 404);
    assert.equal((await request('/characters/1/inventory', undefined, 3)).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_participants').get().n, 0);
    for (const invalid of [null, '1', 0, -1, 1.5]) assert.equal((await joinHero(invalid)).status, 400);
    assert.equal((await joinHero(sessionId, 4)).status, 404);
    assert.equal((await request('/characters/1/session', undefined, 4)).status, 404);
    assert.equal((await joinHero(sessionId, 4, 2)).status, 409); // Pending membership.
    assert.equal((await joinHero(sessionId, 3, 4)).status, 409); // No membership.
    const secondSessionId = (await (await request('/games/2/sessions/start', {}, 2)).json()).sessionId;
    assert.equal((await joinHero(secondSessionId)).status, 409);
    assert.equal((await joinHero(sessionId)).status, 200);
    assert.equal((await joinHero(sessionId)).status, 200); // Idempotent re-entry.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_participants WHERE member_id = 1').get().n, 1);
    assert.equal((await json('/characters/1/session', 3)).activeSession.participating, true);
    assert.equal((await json('/characters', 3)).characters.find(c => c.id === 1).participating, 1);
    assert.equal((await json('/games/1', 1)).members.find(m => m.characterId === 1).participating, true);
    const kickPath = `/games/1/sessions/${sessionId}/participants/1/kick`;
    assert.equal((await request(kickPath, {})).status, 401);
    for (const id of [2, 3, 4, 6]) assert.equal((await request(kickPath, {}, id)).status, 404);
    assert.equal((await request(kickPath, undefined, 1)).status, 405);
    assert.equal((await request(`/games/1/sessions/${secondSessionId}/participants/1/kick`, {}, 1)).status, 409);
    assert.equal((await request(`/games/1/sessions/${sessionId}/participants/3/kick`, {}, 1)).status, 404);
    assert.equal((await request(`/games/1/sessions/${sessionId}/participants/2/kick`, {}, 1)).status, 404);
    assert.equal((await joinHero(sessionId, 4, 5)).status, 200);
    db.prepare("INSERT INTO character_items (character_id, name, quantity, slot) VALUES (1, 'Rope', 1, 'backpack')").run();
    assert.equal((await request(kickPath, {}, 1)).status, 200);
    assert.equal((await request(kickPath, {}, 1)).status, 404);
    assert.equal((await json('/characters/1/session', 3)).activeSession.participating, false);
    assert.equal((await json('/characters/5/session', 4)).activeSession.participating, true);
    assert.equal((await json('/characters', 3)).characters.find(c => c.id === 1).gameName, 'First game');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_items WHERE character_id = 1').get().n, 1);
    assert.equal((await json('/games/1', 1)).activeSession.id, sessionId);
    assert.equal((await request('/characters/5/session/leave', { sessionId }, 4)).status, 200);
    assert.equal((await joinHero(sessionId)).status, 200);
    assert.equal((await request('/characters/1/session/leave', { sessionId }, 4)).status, 404);
    assert.equal((await request('/characters/1/session/leave', { sessionId }, 3)).status, 200);
    assert.equal((await json('/characters/1/session', 3)).activeSession.participating, false);
    assert.equal((await json('/characters', 3)).characters.find(c => c.id === 1).gameName, 'First game');
    assert.equal((await joinHero(sessionId)).status, 200);
    for (const id of [2, 3, 6]) assert.equal((await request('/games/1/sessions/end', { sessionId }, id)).status, 404);
    assert.equal((await request('/games/1/sessions/end', {}, 1)).status, 400);
    assert.equal((await request('/games/1/sessions/end', { sessionId: secondSessionId }, 1)).status, 409);
    assert.equal((await request('/games/1/sessions/end', { sessionId }, 1)).status, 200);
    assert.equal((await request('/games/1/sessions/end', { sessionId }, 1)).status, 409);
    assert.equal((await joinHero(sessionId)).status, 409);
    const afterEnd = (await json('/characters', 3)).characters.find(c => c.id === 1);
    assert.equal(afterEnd.gameName, 'First game');
    assert.equal(afterEnd.activeSessionId, null);
    assert.equal(afterEnd.participating, 0);
    assert.equal((await json('/games/1', 1)).members.find(m => m.characterId === 1).participating, false);
    const nextId = (await (await request('/games/1/sessions/start', {}, 1)).json()).sessionId;
    assert.notEqual(nextId, sessionId);
    assert.equal((await json('/characters/1/session', 3)).activeSession.participating, false);
    assert.equal((await joinHero(sessionId)).status, 409);
    assert.equal((await request('/games/1/sessions/end', { sessionId }, 1)).status, 409);
    assert.equal((await joinHero(nextId)).status, 200);
    assert.equal((await request(kickPath, {}, 1)).status, 409);
    assert.equal((await json('/characters/1/session', 3)).activeSession.participating, true);
    assert.equal((await request('/characters/1/session/leave', { sessionId }, 3)).status, 409);
    assert.equal((await json('/characters/1/session', 3)).activeSession.participating, true);
    assert.equal((await request('/games/1/members/1/remove', {}, 1)).status, 200);
    assert.deepEqual(await json('/characters/1/session', 3), { game: null, activeSession: null });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_participants WHERE member_id = 1').get().n, 0);
    assert.equal((await joinHero(nextId)).status, 409);
    assert.equal((await request('/games/1/invitations', { characterId: 1 }, 1)).status, 201);
    const invitation = (await json('/invitations', 3)).invitations[0];
    assert.equal((await request(`/invitations/${invitation.id}/accept`, {}, 3)).status, 200);
    assert.equal((await json('/characters/1/session', 3)).activeSession.participating, false);
    assert.equal((await joinHero(nextId)).status, 200);
    db.prepare('DELETE FROM characters WHERE id = 1').run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_participants').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { await new Promise(resolve => app.close(resolve)); db.close(); }
});

test('migration preserves membership and active sessions survive database reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-game-session-'));
  const path = join(directory, 'game.sqlite');
  let db = openDatabase(path);
  try {
    seed(db);
    db.exec('DROP TABLE session_participants; DROP TABLE game_sessions;');
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_members WHERE status = 'accepted'").get().n, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_sessions').get().n, 0);
    db.exec(`INSERT INTO game_sessions (id, game_id, started_at) VALUES (1, 1, 123);
      INSERT INTO session_participants VALUES (1, 1, 124);`);
    assert.throws(() => db.exec('INSERT INTO game_sessions (game_id, started_at) VALUES (1, 125)'), /UNIQUE constraint failed/);
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare('SELECT started_at FROM game_sessions WHERE ended_at IS NULL').get().started_at, 123);
    assert.equal(db.prepare('SELECT member_id FROM session_participants').get().member_id, 1);
    db.prepare('DELETE FROM games WHERE id = 1').run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_sessions').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_participants').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
