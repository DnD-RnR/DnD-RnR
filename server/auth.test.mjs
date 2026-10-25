import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, hashPassword } from './db.mjs';
import { createApp } from './index.mjs';

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
    for (const username of ['alice', 'bob']) assert.equal((await request('/admin/players', { username, name: username, password }, admin)).status, 201);
    assert.equal((await request('/admin/players', { username: 'alice', name: 'Duplicate', password }, admin)).status, 409);
    const { players } = await (await request('/admin/players', undefined, admin)).json();
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
    assert.deepEqual((await (await request('/characters', undefined, bob)).json()).characters.find(c => c.id === heroId), { id: heroId, name: 'New Hero', class: 'Bard', level: 3, species: 'Elf', background: 'Mędrzec (Sage)', subclass: 'College of Lore' });
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
