import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, hashPassword } from './db.mjs';
import { createApp } from './index.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('statistics persist, validate values and remain private to the character owner', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dnd-statistics-'));
  const databasePath = join(folder, 'statistics.sqlite');
  let db = openDatabase(databasePath);
  const hash = await hashPassword('stats-test-password');
  for (const username of ['owner', 'stranger']) db.prepare("INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, 'player')").run(username, username, hash);
  const ownerId = db.prepare("SELECT id FROM users WHERE username = 'owner'").get().id;
  const characterId = Number(db.prepare("INSERT INTO characters (user_id, name, class) VALUES (?, 'Hero', 'Bard')").run(ownerId).lastInsertRowid);
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const endpoint = `/characters/${characterId}/statistics`;
  async function request(path, body, cookie = '') {
    if (path === endpoint && body && typeof body === 'object') {
      const current = await (await request(path, undefined, cookie)).json();
      body = { ...body, expectedRevision: current.revision };
    }
    return fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(username) {
    const response = await request('/login', { username, password: 'stats-test-password' });
    return response.headers.get('set-cookie').split(';')[0];
  }
  let appClosed = false;
  try {
    assert.equal((await request(endpoint)).status, 401);
    const owner = await login('owner'), stranger = await login('stranger');
    assert.equal((await request(endpoint, undefined, stranger)).status, 404);
    const initial = (await (await request(endpoint, undefined, owner)).json()).statistics;
    assert.equal(initial.values.str, null);
    assert.equal(initial.skills.perception, 0);
    const stats = structuredClone(initial);
    Object.assign(stats.values, { str: 8, dex: 16, con: 14, int: 12, wis: 15, cha: 18, hp: 18, maxHp: 24, tempHp: 0, ac: 14 });
    stats.savingThrows = ['dex', 'cha'];
    stats.skills.perception = 1;
    stats.skills.persuasion = 2;
    stats.spellAbility = 'cha';
    stats.notes.features = 'Inspiracja barda';
    stats.spells.selections = { cantrips: ['light', 'vicious-mockery'], prepared: ['cure-wounds', 'healing-word', 'sleep', 'detect-magic'] };
    stats.traits = { languages: ['elvish', 'dwarvish'], classSkills: ['performance', 'persuasion', 'perception'], classTools: ['Lute', 'Lyre', 'Flute'] };
    assert.equal((await request(endpoint, stats, stranger)).status, 404);
    assert.equal((await request(endpoint, stats, owner)).status, 200);
    assert.deepEqual((await (await request(endpoint, undefined, owner)).json()).statistics, { ...stats, values: { ...stats.values, ac: 13 } });
    for (const selections of [{ cantrips: ['light', 'vicious-mockery', 'mage-hand'] }, { prepared: ['fireball'] }, { prepared: ['shield'] }, { prepared: ['sleep', 'sleep'] }, { prepared: ['cure-wounds', 'healing-word', 'sleep', 'detect-magic', 'charm-person'] }]) {
      const invalid = { ...stats, spells: { choices: {}, selections } };
      assert.equal((await request(endpoint, invalid, owner)).status, 400);
    }
    assert.deepEqual((await (await request(endpoint, undefined, owner)).json()).statistics.spells, stats.spells);
    for (const traits of [{ languages: ['common'] }, { languages: ['elvish', 'dwarvish', 'orc'] }, { classSkills: ['performance', 'persuasion', 'perception', 'athletics'] }, { expertise: ['performance'] }, { classTools: ['Sword'] }]) {
      assert.equal((await request(endpoint, { ...stats, traits }, owner)).status, 400);
    }
    const legacyClient = structuredClone(stats);
    delete legacyClient.spells;
    delete legacyClient.traits;
    assert.equal((await request(endpoint, legacyClient, owner)).status, 200);
    assert.deepEqual((await (await request(endpoint, undefined, owner)).json()).statistics.spells, stats.spells);
    assert.deepEqual((await (await request(endpoint, undefined, owner)).json()).statistics.traits, stats.traits);
    for (const [key, value] of [['str', 31], ['dex', 0], ['hp', -1], ['deathFailures', 4], ['exhaustion', 7], ['con', 12.5]]) {
      const invalid = structuredClone(stats); invalid.values[key] = value;
      assert.equal((await request(endpoint, invalid, owner)).status, 400);
    }
    for (const invalid of [null, { ...stats, skills: { ...stats.skills, perception: 3 } }, { ...stats, savingThrows: ['unknown'] }, { ...stats, spellAbility: 'invalid' }, { ...stats, notes: { ...stats.notes, features: 'x'.repeat(1501) } }]) {
      assert.equal((await request(endpoint, invalid, owner)).status, 400);
    }
    // Larger Unicode notes fit in a valid request and survive reopening the database.
    stats.notes.spells = 'ż'.repeat(1500);
    stats.notes.resources = 'ą'.repeat(1500);
    stats.notes.features = 'ł'.repeat(1500);
    assert.equal((await request(endpoint, stats, owner)).status, 200);
    await new Promise(resolve => app.close(resolve)); appClosed = true;
    db.close(); db = openDatabase(databasePath);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId).data), { ...stats, values: { ...stats.values, ac: null } });
    db.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM character_statistics').get().count, 0);
  } finally {
    if (!appClosed) await new Promise(resolve => app.close(resolve));
    db.close(); rmSync(folder, { recursive: true, force: true });
  }
});

test('players create level-one characters and GMs choose levels on their own accounts', async () => {
  const db = openDatabase(':memory:');
  const password = 'abc123';
  const hash = await hashPassword(password);
  for (const [username, role] of [['admin', 'admin'], ['player', 'player'], ['master', 'gm'], ['other', 'player']]) {
    db.prepare('INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, ?)').run(username, username, hash, role);
  }
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  async function request(path, body, cookie = '') {
    return fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(username) {
    const response = await request('/login', { username, password });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    const player = await login('player'), gm = await login('master'), admin = await login('admin'), other = await login('other');
    const playerId = db.prepare("SELECT id FROM users WHERE username = 'player'").get().id;
    const gmId = db.prepare("SELECT id FROM users WHERE username = 'master'").get().id;
    const hero = { name: '  New hero  ', characterClass: 'Bard', level: 1, species: 'Elf', background: 'Mędrzec (Sage)', subclass: '' };
    assert.equal((await request('/characters', hero)).status, 401);
    for (const level of [0, 2, 3, 20, 21, 1.5, '1', null]) assert.equal((await request('/characters', { ...hero, level }, player)).status, 400);
    assert.equal((await request('/characters', { ...hero, userId: gmId }, player)).status, 403);
    assert.equal((await request('/characters', { ...hero, userId: playerId }, gm)).status, 403);
    assert.equal((await request('/characters', { ...hero, species: 'Unknown' }, player)).status, 400);
    assert.equal((await request('/characters', { ...hero, subclass: 'College of Lore' }, player)).status, 400);
    const created = await request('/characters', hero, player);
    assert.equal(created.status, 201);
    const playerCharacterId = (await created.json()).id;
    const saved = db.prepare('SELECT user_id, name, level FROM characters WHERE id = ?').get(playerCharacterId);
    assert.deepEqual({ ...saved }, { user_id: playerId, name: 'New hero', level: 1 });
    assert.equal((await request('/characters', { ...hero, level: 2 }, gm)).status, 201);
    assert.equal((await request('/characters', { ...hero, level: 20, subclass: 'College of Lore' }, gm)).status, 201);
    for (const invalid of [{ level: 21 }, { level: 0 }, { level: 3, subclass: '' }, { level: 3, subclass: 'Champion' }]) assert.equal((await request('/characters', { ...hero, ...invalid }, gm)).status, 400);
    assert.equal((await (await request('/characters', undefined, player)).json()).characters.length, 1);
    assert.equal((await (await request('/characters', undefined, gm)).json()).characters.length, 2);
    assert.equal((await (await request('/characters', undefined, other)).json()).characters.length, 0);
    assert.equal((await request('/admin/characters', { ...hero, userId: playerId, level: 2 }, player)).status, 403);
    assert.equal((await request(`/admin/characters/${playerCharacterId}/update`, { ...hero, userId: playerId, level: 2 }, player)).status, 403);
    assert.equal((await request('/admin/characters', { ...hero, userId: gmId, level: 3, subclass: 'College of Lore' }, admin)).status, 201);
    const gameId = (await (await request('/games', { name: 'GM heroes' }, gm)).json()).id;
    const candidates = (await (await request(`/games/${gameId}/candidates`, undefined, gm)).json()).characters;
    const gmCharacter = (await (await request('/characters', undefined, gm)).json()).characters[0];
    assert.ok(candidates.some(c => c.id === gmCharacter.id));
    assert.equal((await request(`/games/${gameId}/invitations`, { characterId: gmCharacter.id }, gm)).status, 201);
    const invitation = (await (await request('/invitations', undefined, gm)).json()).invitations[0];
    assert.equal((await request(`/invitations/${invitation.id}/accept`, {}, gm)).status, 200);
    assert.equal((await (await request('/characters', undefined, gm)).json()).characters.find(c => c.id === gmCharacter.id).gameName, 'GM heroes');
  } finally { await new Promise(resolve => app.close(resolve)); db.close(); }
});

test('legacy role migration preserves users, sessions, characters and inventory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-gm-'));
  const path = join(directory, 'legacy.sqlite');
  let db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin', 'player')));
      CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE characters (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, class TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users VALUES (1, 'legacy', 'Legacy', 'hash', 'player');
      INSERT INTO sessions VALUES ('token', 1, 123);
      INSERT INTO characters VALUES (1, 1, 'Hero', 'Bard', 1);`);
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare('SELECT name FROM users WHERE id = 1').get().name, 'Legacy');
    assert.equal(db.prepare('SELECT user_id FROM sessions').get().user_id, 1);
    assert.equal(db.prepare('SELECT user_id FROM characters').get().user_id, 1);
    db.prepare("INSERT INTO users VALUES (2, 'master', 'Master', 'hash', 'gm')").run();
    db.prepare("INSERT INTO character_items (character_id, name, quantity, slot) VALUES (1, 'Rope', 1, 'backpack')").run();
    db.prepare("INSERT INTO item_catalog (name, description, slot) VALUES ('Helmet', 'Catalog entry', 'head')").run();
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_items').get().n, 1);
    assert.equal(db.prepare("SELECT name FROM item_catalog WHERE name = 'Helmet'").get().name, 'Helmet');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('GM games require owner consent and isolate character access', async () => {
  const db = openDatabase(':memory:');
  const password = 'abc123';
  const hash = await hashPassword(password);
  for (const [name, role] of [['admin', 'admin'], ['alice', 'player'], ['bob', 'player'], ['othergm', 'gm']]) db.prepare('INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, ?)').run(name, name, hash, role);
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  async function request(path, body, cookie = '') {
    return fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(username) {
    const response = await request('/login', { username, password });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    const admin = await login('admin');
    const created = await request('/admin/players', { username: 'master', name: 'Master', password, role: 'gm' }, admin);
    assert.equal(created.status, 201);
    const gmId = (await created.json()).user.id;
    assert.equal((await request('/admin/players', { username: 'badrole', name: 'Bad', password, role: 'admin' }, admin)).status, 400);
    const gm = await login('master'), othergm = await login('othergm'), alice = await login('alice'), bob = await login('bob');
    assert.equal((await request('/admin/gms', undefined, gm)).status, 403);
    assert.equal((await (await request('/admin/gms', undefined, admin)).json()).players.length, 2);
    assert.equal((await request('/games', { name: 'Forbidden' }, alice)).status, 403);
    assert.equal((await request('/games', { name: ' ' }, gm)).status, 400);
    assert.equal((await request('/games', { name: 'Campaign' })).status, 401);
    const gameId = (await (await request('/games', { name: 'Campaign', description: 'Adventure' }, gm)).json()).id;
    const base = `/games/${gameId}`;
    const aliceId = db.prepare("SELECT id FROM users WHERE username = 'alice'").get().id;
    const bobId = db.prepare("SELECT id FROM users WHERE username = 'bob'").get().id;
    const hero = { userId: aliceId, name: 'Secret hero', characterClass: 'Bard', level: 1, species: 'Elf', background: 'Mędrzec (Sage)', subclass: '' };
    assert.equal((await request('/admin/characters', hero, admin)).status, 201);
    const characterId = db.prepare('SELECT id FROM characters').get().id;
    assert.equal((await request('/items')).status, 401);
    assert.equal((await request('/items', undefined, alice)).status, 403);
    assert.ok((await (await request('/items', undefined, gm)).json()).items.some(item => item.name === 'Kwas'));
    const catalogBody = { name: '  Helmet  ', description: 'Sturdy helmet', slot: 'head' };
    assert.equal((await request('/items', catalogBody, gm)).status, 403);
    assert.equal((await request('/items', catalogBody, alice)).status, 403);
    for (const invalid of [{ name: ' ' }, { name: 'x'.repeat(81) }, { description: 'x'.repeat(2001) }, { slot: 'invalid' }, { slot: null }]) {
      assert.equal((await request('/items', { ...catalogBody, ...invalid }, admin)).status, 400);
    }
    const catalogResponse = await request('/items', catalogBody, admin);
    assert.equal(catalogResponse.status, 201);
    const catalogId = (await catalogResponse.json()).id;
    const catalog = (await (await request('/items', undefined, gm)).json()).items;
    assert.equal(catalog.find(item => item.id === catalogId).name, 'Helmet');
    const award = { characterId, itemId: catalogId, quantity: 2 };
    assert.equal((await request(`${base}/equipment`, award, gm)).status, 404);
    db.prepare("INSERT INTO character_items (character_id, name, description, quantity, slot) VALUES (?, 'Secret item', 'Hidden', 1, 'backpack')").run(characterId);
    const itemId = db.prepare('SELECT id FROM character_items').get().id;
    assert.equal((await request(`${base}/candidates`, undefined, othergm)).status, 404);
    assert.equal((await request(`${base}/invitations`, { characterId }, othergm)).status, 404);
    const candidates = (await (await request(`${base}/candidates`, undefined, gm)).json()).characters;
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].class, undefined);
    assert.equal((await request(`${base}/invitations`, { characterId: 9999 }, gm)).status, 400);
    assert.equal((await request(`${base}/invitations`, { characterId }, gm)).status, 201);
    assert.equal((await request(`${base}/equipment`, award, gm)).status, 404);
    assert.equal((await request(`${base}/invitations`, { characterId }, gm)).status, 409);
    const secondGameId = (await (await request('/games', { name: 'Second campaign' }, gm)).json()).id;
    const secondBase = `/games/${secondGameId}`;
    assert.equal((await request(`${secondBase}/invitations`, { characterId }, gm)).status, 201);
    let members = (await (await request(base, undefined, gm)).json()).members;
    assert.equal(members[0].character, undefined);
    assert.equal(members[0].items, undefined);
    assert.deepEqual((await (await request('/games', undefined, alice)).json()).games, []);
    assert.equal((await (await request('/characters', undefined, alice)).json()).characters[0].gameName, null);
    assert.deepEqual((await (await request('/invitations', undefined, bob)).json()).invitations, []);
    const pendingInvitations = (await (await request('/invitations', undefined, alice)).json()).invitations;
    const invitationId = pendingInvitations.find(i => i.gameName === 'Campaign').id;
    const secondInvitationId = pendingInvitations.find(i => i.gameName === 'Second campaign').id;
    assert.equal((await request(`/invitations/${invitationId}/accept`, {}, bob)).status, 404);
    assert.equal((await request(`/invitations/${invitationId}/accept`, {}, gm)).status, 404);
    assert.equal((await request(`/invitations/${invitationId}/accept`, {}, alice)).status, 200);
    assert.equal((await request(`${base}/equipment`, award)).status, 401);
    for (const cookie of [othergm, alice, admin]) assert.equal((await request(`${base}/equipment`, award, cookie)).status, 404);
    for (const invalid of [{ quantity: 0 }, { quantity: 10000 }, { quantity: 1.5 }, { quantity: '2' }, { itemId: '1' }, { characterId: null }]) {
      assert.equal((await request(`${base}/equipment`, { ...award, ...invalid }, gm)).status, 400);
    }
    assert.equal((await request(`${base}/equipment`, { ...award, itemId: 999999 }, gm)).status, 404);
    assert.equal((await request(`${base}/equipment`, { ...award, characterId: 999999 }, gm)).status, 404);
    assert.equal((await request(`${secondBase}/equipment`, award, gm)).status, 404);
    assert.equal((await request(`${base}/equipment`, { ...award, name: 'Forged name', slot: 'feet', equipped: 1 }, gm)).status, 201);
    const awarded = (await (await request(`/characters/${characterId}/inventory`, undefined, alice)).json()).items.find(i => i.name === 'Helmet');
    assert.deepEqual({ ...awarded, id: 0 }, { id: 0, name: 'Helmet', description: 'Sturdy helmet', quantity: 2, slot: 'head', equipped: 0 });
    // Catalog edits never rewrite copies that have already been awarded.
    db.prepare("UPDATE item_catalog SET name = 'Updated helmet' WHERE id = ?").run(catalogId);
    assert.equal(db.prepare('SELECT name FROM character_items WHERE id = ?').get(awarded.id).name, 'Helmet');
    assert.equal((await request(`/characters/${characterId}/inventory/${awarded.id}/equip`, {}, alice)).status, 200);
    assert.equal(db.prepare('SELECT equipped FROM character_items WHERE id = ?').get(awarded.id).equipped, 1);
    assert.equal((await (await request('/characters', undefined, alice)).json()).characters[0].gameName, 'Campaign');
    const blockedAcceptance = await request(`/invitations/${secondInvitationId}/accept`, {}, alice);
    assert.equal(blockedAcceptance.status, 409);
    assert.match((await blockedAcceptance.json()).error, /jednej grze/);
    assert.equal(db.prepare('SELECT status FROM game_members WHERE id = ?').get(secondInvitationId).status, 'pending');
    assert.throws(() => db.prepare("UPDATE game_members SET status = 'accepted' WHERE id = ?").run(secondInvitationId), /UNIQUE constraint failed/);
    assert.deepEqual((await (await request(`${secondBase}/candidates`, undefined, gm)).json()).characters, []);
    const thirdGameId = (await (await request('/games', { name: 'Third campaign' }, gm)).json()).id;
    assert.equal((await request(`/games/${thirdGameId}/invitations`, { characterId }, gm)).status, 409);
    assert.equal((await request(`/invitations/${secondInvitationId}/decline`, {}, alice)).status, 200);
    const secondMembers = (await (await request(secondBase, undefined, gm)).json()).members;
    assert.equal(secondMembers[0].character, undefined);
    assert.equal(secondMembers[0].items, undefined);
    assert.equal((await request(`/invitations/${invitationId}/decline`, {}, alice)).status, 404);
    assert.equal((await (await request('/games', undefined, alice)).json()).games.length, 1);
    members = (await (await request(base, undefined, gm)).json()).members;
    assert.equal(members[0].character.background, hero.background);
    assert.equal(members[0].items[0].name, 'Secret item');
    assert.equal((await request(base, undefined, othergm)).status, 404);
    assert.equal((await request(`/characters/${characterId}/inventory`, undefined, gm)).status, 404);
    assert.equal((await request(`/characters/${characterId}/inventory/${itemId}/delete`, {}, gm)).status, 404);
    const memberId = members[0].id;
    const removePath = `${base}/members/${memberId}/remove`;
    assert.equal((await request(removePath, {})).status, 401);
    for (const cookie of [othergm, alice, admin]) assert.equal((await request(removePath, {}, cookie)).status, 404);
    assert.equal((await request(`${secondBase}/members/${memberId}/remove`, {}, gm)).status, 404);
    assert.equal((await request(`${base}/members/999999/remove`, {}, gm)).status, 404);
    assert.equal((await request(removePath, undefined, gm)).status, 404);
    assert.equal((await request(removePath, {}, gm)).status, 200);
    assert.equal((await request(removePath, {}, gm)).status, 404);
    assert.deepEqual((await (await request(base, undefined, gm)).json()).members, []);
    assert.deepEqual((await (await request('/games', undefined, alice)).json()).games, []);
    assert.equal((await (await request('/characters', undefined, alice)).json()).characters[0].gameName, null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_items WHERE character_id = ?').get(characterId).n, 2);
    assert.equal((await request(`/characters/${characterId}/inventory`, undefined, alice)).status, 200);
    assert.equal((await request(`${base}/equipment`, award, gm)).status, 404);
    assert.ok((await (await request(`${base}/candidates`, undefined, gm)).json()).characters.some(c => c.id === characterId));
    // Rejoining requires a new invitation and the owner's consent.
    assert.equal((await request(`${base}/invitations`, { characterId }, gm)).status, 201);
    const rejoinId = (await (await request('/invitations', undefined, alice)).json()).invitations[0].id;
    assert.equal((await request(`${base}/members/${rejoinId}/remove`, {}, gm)).status, 404);
    assert.equal((await (await request(base, undefined, gm)).json()).members[0].character, undefined);
    assert.equal((await request(`/invitations/${rejoinId}/accept`, {}, alice)).status, 200);
    assert.equal((await request(`/admin/characters/${characterId}/update`, { ...hero, userId: bobId }, admin)).status, 200);
    assert.equal((await (await request('/characters', undefined, bob)).json()).characters[0].gameName, null);
    assert.deepEqual((await (await request(base, undefined, gm)).json()).members, []);
    assert.equal((await request(`${base}/invitations`, { characterId }, gm)).status, 201);
    const bobInvitation = (await (await request('/invitations', undefined, bob)).json()).invitations[0].id;
    assert.equal((await request(`/invitations/${bobInvitation}/decline`, {}, bob)).status, 200);
    assert.equal((await request(`${base}/equipment`, award, gm)).status, 404);
    members = (await (await request(base, undefined, gm)).json()).members;
    assert.equal(members[0].status, 'declined');
    assert.equal(members[0].character, undefined);
    // Declining allows a new invitation, but never grants access without fresh consent.
    assert.ok((await (await request(`${base}/candidates`, undefined, gm)).json()).characters.some(c => c.id === characterId));
    assert.equal((await request(`${base}/invitations`, { characterId }, othergm)).status, 404);
    assert.equal((await request(`${base}/invitations`, { characterId }, gm)).status, 201);
    const renewedInvitations = (await (await request('/invitations', undefined, bob)).json()).invitations;
    assert.equal(renewedInvitations.filter(i => i.characterName === hero.name).length, 1);
    const renewedInvitation = renewedInvitations.find(i => i.id === bobInvitation);
    assert.ok(renewedInvitation);
    assert.equal((await request(`${base}/equipment`, award, gm)).status, 404);
    assert.equal((await request(`${base}/invitations`, { characterId }, gm)).status, 409);
    assert.ok(!(await (await request(`${base}/candidates`, undefined, gm)).json()).characters.some(c => c.id === characterId));
    assert.equal((await request(`/invitations/${renewedInvitation.id}/accept`, {}, alice)).status, 404);
    assert.equal((await request(`/invitations/${renewedInvitation.id}/accept`, {}, bob)).status, 200);
    assert.equal((await request(`${base}/invitations`, { characterId }, gm)).status, 409);
    assert.equal((await request(`/admin/players/${gmId}/update`, { username: 'master', name: 'Updated', password: '' }, admin)).status, 200);
    assert.equal((await request(`/admin/players/${gmId}/delete`, {}, admin)).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM games').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_members').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { await new Promise(resolve => app.close(resolve)); db.close(); }
});

test('single-game migration retains earliest accepted membership and enforces the limit after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-single-game-'));
  const path = join(directory, 'legacy.sqlite');
  let db = openDatabase(path);
  try {
    db.exec(`DROP INDEX one_game_per_character;
      INSERT INTO users VALUES (1, 'gm', 'GM', 'hash', 'gm');
      INSERT INTO users VALUES (2, 'player', 'Player', 'hash', 'player');
      INSERT INTO characters (id, user_id, name, class) VALUES (1, 2, 'Hero', 'Bard');
      INSERT INTO games (id, gm_id, name) VALUES (1, 1, 'First'), (2, 1, 'Second'), (3, 1, 'Third');
      INSERT INTO game_members (id, game_id, character_id, status) VALUES
        (1, 1, 1, 'accepted'), (2, 2, 1, 'accepted'), (3, 3, 1, 'pending');`);
    db.close(); db = openDatabase(path);
    assert.deepEqual(db.prepare('SELECT status FROM game_members ORDER BY id').all().map(m => m.status), ['accepted', 'pending', 'pending']);
    assert.throws(() => db.prepare("UPDATE game_members SET status = 'accepted' WHERE id = 2").run(), /UNIQUE constraint failed/);
    db.exec('DELETE FROM games WHERE id = 1');
    db.prepare("UPDATE game_members SET status = 'accepted' WHERE id = 2").run();
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare('SELECT status FROM game_members WHERE id = 2').get().status, 'accepted');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('admin provisions players; sessions and character ownership are enforced', async () => {
  const db = openDatabase(':memory:');
  const password = 'abc123';
  db.prepare('INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, ?)').run('admin', 'Admin', await hashPassword(password), 'admin');
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function request(path, body, cookie = '', origin = 'http://127.0.0.1:5173') {
    return fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(username) {
    const result = await request('/login', { username, password });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    return result.headers.get('set-cookie').split(';')[0];
  }
  try {
    assert.equal((await request('/characters')).status, 401);
    assert.equal((await request('/login', { username: 'admin', password: 'wrong' })).status, 401);
    const admin = await login('admin');
    assert.equal((await request('/admin/players', { username: 'short', name: 'Short', password: 'abc12' }, admin)).status, 400);
    for (const username of ['Alice', 'bOB']) assert.equal((await request('/admin/players', { username, name: username, password }, admin)).status, 201);
    assert.equal((await request('/admin/players', { username: 'ALICE', name: 'Duplicate', password }, admin)).status, 409);
    const { players } = await (await request('/admin/players', undefined, admin)).json();
    assert.deepEqual(players.map(player => player.username).sort(), ['alice', 'bob']);
    await login('ALIce');
    const mixedCasePlayer = players.find(player => player.username === 'alice');
    assert.equal((await request('/admin/players/' + mixedCasePlayer.id + '/update', { username: 'ALIce', name: 'Alice', password: '' }, admin)).status, 200);
    await login('Alice');
    assert.equal((await request('/admin/players/' + mixedCasePlayer.id + '/update', { username: 'BOB', name: 'Alice', password: '' }, admin)).status, 409);
    for (const player of players) assert.equal((await request('/admin/characters', { userId: player.id, name: player.username + ' hero', characterClass: 'Czarodziej (Wizard)', level: 1, species: 'Elf', background: 'Mędrzec (Sage)', subclass: '' }, admin)).status, 201);
    const baseCharacter = { userId: players[0].id, name: 'Test', characterClass: 'Bard', level: 3, species: 'Elf', background: 'Mędrzec (Sage)', subclass: 'College of Lore' };
    for (const invalid of [{ species: 'Unknown' }, { background: '' }, { characterClass: 'Mag' }, { subclass: 'Champion' }, { subclass: '' }, { level: 2 }, { level: 21 }]) {
      assert.equal((await request('/admin/characters', { ...baseCharacter, ...invalid }, admin)).status, 400);
    }
    const alice = await login('alice');
    assert.equal((await request('/admin/players', undefined, alice)).status, 403);
    assert.equal((await request('/admin/players', { username: 'hacker', name: 'X', password }, alice)).status, 403);
    const characters = await (await request('/characters?userId=1', undefined, alice)).json();
    assert.equal(characters.characters.length, 1);
    assert.equal(characters.characters[0].name, 'alice hero');
    assert.equal(characters.characters[0].species, 'Elf');
    assert.equal(characters.characters[0].background, 'Mędrzec (Sage)');
    const savedCharacter = db.prepare('SELECT species, background FROM characters WHERE id = ?').get(characters.characters[0].id);
    assert.equal(savedCharacter.species, 'Elf');
    assert.equal(savedCharacter.background, 'Mędrzec (Sage)');
    assert.equal((await request('/logout', {}, alice, 'https://evil.example')).status, 403);
    assert.equal((await request('/me', undefined, alice)).status, 200);
    assert.equal((await request('/logout', {}, alice)).status, 200);
    assert.equal((await request('/me', undefined, alice)).status, 401);
    const bob = await login('bob');
    const aliceId = players.find(p => p.username === 'alice').id;
    assert.equal((await request(`/admin/players/${aliceId}/update`, { username: 'alice', name: 'Alice', password: 'abc12' }, admin)).status, 400);
    assert.equal((await request(`/admin/players/${aliceId}/update`, { username: 'alice', name: 'Alice', password }, admin)).status, 200);
    const bobId = players.find(p => p.username === 'bob').id;
    const all = (await (await request('/admin/characters', undefined, admin)).json()).characters;
    const heroId = all.find(c => c.userId === aliceId).id;
    const bobHeroId = all.find(c => c.userId === bobId).id;
    const inventoryPath = `/characters/${bobHeroId}/inventory`;
    assert.equal((await request(`/characters/${heroId}/inventory`, undefined, bob)).status, 404);
    assert.equal((await request(`/characters/${heroId}/inventory`, { name: 'Intruder', description: '', quantity: 1, slot: 'head' }, bob)).status, 404);
    assert.equal((await request(inventoryPath, { name: 'Helmet', description: '', quantity: 1, slot: 'head' }, bob)).status, 405);
    assert.equal((await (await request(inventoryPath, undefined, bob)).json()).items.length, 0);
    // Existing items are provisioned independently of the player API.
    const insertItem = db.prepare('INSERT INTO character_items (character_id, name, description, quantity, slot) VALUES (?, ?, ?, ?, ?)');
    for (const name of ['Helmet', 'Hat']) insertItem.run(bobHeroId, name, 'A personal item', 1, 'head');
    insertItem.run(bobHeroId, 'Rope', '', 2, 'backpack');
    const { items } = await (await request(inventoryPath, undefined, bob)).json();
    assert.equal(items.length, 3);
    assert.ok(items.every(item => item.equipped === 0));
    const helmet = items.find(item => item.name === 'Helmet');
    const hat = items.find(item => item.name === 'Hat');
    const rope = items.find(item => item.name === 'Rope');
    assert.equal((await request(`${inventoryPath}/${helmet.id}/equip`, {}, bob)).status, 200);
    assert.equal((await request(`${inventoryPath}/${hat.id}/equip`, {}, bob)).status, 200);
    const equippedItems = (await (await request(inventoryPath, undefined, bob)).json()).items;
    assert.deepEqual(equippedItems.filter(item => item.equipped).map(item => item.id), [hat.id]);
    assert.equal(equippedItems.find(item => item.id === helmet.id).equipped, 0);
    assert.equal(db.prepare('SELECT equipped FROM character_items WHERE id = ?').get(hat.id).equipped, 1);
    assert.equal((await request(`${inventoryPath}/${rope.id}/equip`, {}, bob)).status, 400);
    assert.equal((await request(`/characters/${heroId}/inventory/${hat.id}/delete`, {}, bob)).status, 404);
    assert.equal((await request(`${inventoryPath}/${hat.id}/unequip`, {}, bob)).status, 200);
    assert.equal(db.prepare('SELECT equipped FROM character_items WHERE id = ?').get(hat.id).equipped, 0);
    assert.equal((await request(`${inventoryPath}/${rope.id}/delete`, {}, bob)).status, 200);
    assert.equal((await (await request(inventoryPath, undefined, bob)).json()).items.length, 2);
    const recipients = await (await request(`/characters/${bobHeroId}/recipients`, undefined, bob)).json();
    assert.deepEqual(recipients.characters, [{ id: heroId, name: 'alice hero' }]);
    assert.equal((await request(`/characters/${heroId}/recipients`, undefined, bob)).status, 404);
    insertItem.run(bobHeroId, 'Rations', 'Food', 5, 'backpack');
    const rationsId = Number(db.prepare("SELECT id FROM character_items WHERE character_id = ? AND name = 'Rations'").get(bobHeroId).id);
    const transferPath = `${inventoryPath}/${rationsId}/transfer`;
    for (const invalid of [{ recipientId: bobHeroId, quantity: 1 }, { recipientId: heroId, quantity: 0 }, { recipientId: heroId, quantity: 1.5 }]) {
      assert.equal((await request(transferPath, invalid, bob)).status, 400);
    }
    assert.equal((await request(transferPath, { recipientId: 999999, quantity: 1 }, bob)).status, 404);
    assert.equal((await request(transferPath, { recipientId: heroId, quantity: 6 }, bob)).status, 409);
    assert.equal(db.prepare('SELECT quantity FROM character_items WHERE id = ?').get(rationsId).quantity, 5);
    assert.equal((await request(transferPath, { recipientId: heroId, quantity: 2 }, bob)).status, 200);
    assert.equal(db.prepare('SELECT quantity FROM character_items WHERE id = ?').get(rationsId).quantity, 3);
    const receivedRations = db.prepare("SELECT quantity, slot, equipped, description FROM character_items WHERE character_id = ? AND name = 'Rations'").get(heroId);
    assert.deepEqual({ ...receivedRations }, { quantity: 2, slot: 'backpack', equipped: 0, description: 'Food' });
    assert.equal((await request(`${inventoryPath}/${helmet.id}/transfer`, { recipientId: heroId, quantity: 1 }, bob)).status, 200);
    assert.equal(db.prepare('SELECT character_id FROM character_items WHERE id = ?').get(helmet.id).character_id, heroId);
    assert.equal((await request(`${inventoryPath}/${helmet.id}/transfer`, { recipientId: heroId, quantity: 1 }, bob)).status, 404);
    assert.equal((await request(`/characters/${heroId}/inventory/${helmet.id}/transfer`, { recipientId: bobHeroId, quantity: 1 }, bob)).status, 404);
    assert.equal((await request(`${inventoryPath}/${hat.id}/equip`, {}, bob)).status, 200);
    assert.equal((await request(`${inventoryPath}/${hat.id}/transfer`, { recipientId: heroId, quantity: 1 }, bob)).status, 409);
    assert.equal((await request(`${inventoryPath}/${hat.id}/unequip`, {}, bob)).status, 200);
    assert.equal(all.find(c => c.id === heroId).species, 'Elf');
    assert.equal(all.find(c => c.id === heroId).background, 'Mędrzec (Sage)');
    assert.equal((await request('/admin/characters', undefined, bob)).status, 403);
    for (const kind of ['players', 'characters']) {
      for (const action of ['update', 'delete']) assert.equal((await request(`/admin/${kind}/${kind === 'players' ? aliceId : heroId}/${action}`, {}, bob)).status, 403);
    }
    assert.equal((await request(`/admin/players/${aliceId}/update`, { username: 'bob', name: 'Alice' }, admin)).status, 409);
    assert.equal((await request(`/admin/players/${aliceId}/update`, { username: 'alice-new', name: 'Alice New', password: '' }, admin)).status, 200);
    const aliceNew = await login('alice-new');
    assert.equal((await request(`/admin/characters/${heroId}/update`, { ...baseCharacter, subclass: 'Champion' }, admin)).status, 400);
    assert.equal((await request(`/admin/characters/${heroId}/update`, { userId: bobId, name: 'New Hero', characterClass: 'Bard', species: 'Elf', background: 'Mędrzec (Sage)', subclass: 'College of Lore', level: 0 }, admin)).status, 400);
    assert.equal((await request(`/admin/characters/${heroId}/update`, { userId: 1, name: 'New Hero', characterClass: 'Bard', species: 'Elf', background: 'Mędrzec (Sage)', subclass: 'College of Lore', level: 3 }, admin)).status, 400);
    assert.equal((await request(`/admin/characters/${heroId}/update`, { userId: bobId, name: 'New Hero', characterClass: 'Bard', species: 'Elf', background: 'Mędrzec (Sage)', subclass: 'College of Lore', level: 3 }, admin)).status, 200);
    assert.equal((await (await request('/characters', undefined, aliceNew)).json()).characters.length, 0);
    assert.deepEqual((await (await request('/characters', undefined, bob)).json()).characters.find(c => c.id === heroId), { id: heroId, gameName: null, activeSessionId: null, participating: 0, name: 'New Hero', class: 'Bard', level: 3, species: 'Elf', background: 'Mędrzec (Sage)', subclass: 'College of Lore' });
    assert.equal((await request(`/admin/players/${aliceId}/update`, { username: 'alice', name: 'Alice', password: 'new-long-test-password' }, admin)).status, 200);
    assert.equal((await request('/me', undefined, aliceNew)).status, 401);
    assert.equal((await request('/login', { username: 'alice', password }, '')).status, 401);
    assert.equal((await request('/login', { username: 'alice', password: 'new-long-test-password' })).status, 200);
    assert.equal((await request('/admin/players/1/delete', {}, admin)).status, 404);
    assert.equal((await request(`/admin/characters/${heroId}/delete`, {}, admin)).status, 200);
    assert.equal((await request(`/admin/characters/${heroId}/delete`, {}, admin)).status, 404);
    assert.equal((await request(`/admin/players/${bobId}/delete`, {}, admin)).status, 200);
    assert.equal((await request('/me', undefined, bob)).status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM characters WHERE user_id = ?').get(bobId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM character_items WHERE character_id = ?').get(bobHeroId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(bobId).count, 0);
    db.prepare('UPDATE sessions SET expires = 0').run();
    assert.equal((await request('/characters', undefined, bob)).status, 401);
    const stored = db.prepare("SELECT password FROM users WHERE username = 'alice'").get();
    assert.notEqual(stored.password, password);
  } finally { await new Promise(resolve => app.close(resolve)); db.close(); }
});

test('repeated login attempts are limited', async () => {
  const db = openDatabase(':memory:');
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    for (let i = 0; i < 11; i++) {
      const response = await fetch(`http://127.0.0.1:${app.address().port}/api/login`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'missing', password: 'wrong' }) });
      assert.equal(response.status, i < 10 ? 401 : 429);
    }
  } finally { await new Promise(resolve => app.close(resolve)); db.close(); }
});
