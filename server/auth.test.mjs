import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, hashPassword } from './db.mjs';
import { createApp } from './index.mjs';

test('admin provisions players; sessions and character ownership are enforced', async () => {
  const db = openDatabase(':memory:');
  const password = 'a-long-test-password';
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
    for (const username of ['alice', 'bob']) assert.equal((await request('/admin/players', { username, name: username, password }, admin)).status, 201);
    assert.equal((await request('/admin/players', { username: 'alice', name: 'Duplicate', password }, admin)).status, 409);
    const { players } = await (await request('/admin/players', undefined, admin)).json();
    for (const player of players) assert.equal((await request('/admin/characters', { userId: player.id, name: player.username + ' hero', characterClass: 'Mag' }, admin)).status, 201);
    const alice = await login('alice');
    assert.equal((await request('/admin/players', undefined, alice)).status, 403);
    assert.equal((await request('/admin/players', { username: 'hacker', name: 'X', password }, alice)).status, 403);
    const characters = await (await request('/characters?userId=1', undefined, alice)).json();
    assert.equal(characters.characters.length, 1);
    assert.equal(characters.characters[0].name, 'alice hero');
    assert.equal((await request('/logout', {}, alice, 'https://evil.example')).status, 403);
    assert.equal((await request('/me', undefined, alice)).status, 200);
    assert.equal((await request('/logout', {}, alice)).status, 200);
    assert.equal((await request('/me', undefined, alice)).status, 401);
    const bob = await login('bob');
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
