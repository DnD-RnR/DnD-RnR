import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, hashPassword } from './db.mjs';
import { createApp } from './index.mjs';

test('weapon catalog is seeded and available to authenticated users', async () => {
  const db = openDatabase(':memory:');
  const password = 'weapon-test-password';
  const hash = await hashPassword(password);
  db.prepare("INSERT INTO users (username, name, password, role) VALUES ('player', 'Player', ?, 'player')").run(hash);
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const request = (path, cookie = '') => fetch(`http://127.0.0.1:${app.address().port}/api${path}`, {
    headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' },
  });
  try {
    assert.equal((await request('/weapons')).status, 401);
    const login = await fetch(`http://127.0.0.1:${app.address().port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ username: 'player', password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await request('/weapons', cookie);
    assert.equal(response.status, 200);
    const { weapons } = await response.json();
    assert.equal(weapons.length, 38);
    assert.deepEqual(weapons.find(weapon => weapon.id === 'dagger'), {
      id: 'dagger',
      name: 'Sztylet',
      category: 'simple',
      type: 'wręczna',
      damage: '1d4',
      damageType: 'kłute',
      range: '20/60',
      weight: 1,
      cost: '2 GP',
      properties: ['finezyjna', 'lekka', 'miotana'],
      mastery: 'Nick',
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM weapon_catalog').get().count, weapons.length);
    const userId = db.prepare("SELECT id FROM users WHERE username = 'player'").get().id;
    const characterId = Number(db.prepare("INSERT INTO characters (user_id, name, class) VALUES (?, 'Weapon hero', 'Fighter')").run(userId).lastInsertRowid);
    db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, weapon_id)
      VALUES (?, 'Sztylet', '', 1, 'backpack', 'dagger')`).run(characterId);
    const inventoryPath = `/characters/${characterId}/inventory`;
    const inventory = await (await request(inventoryPath, cookie)).json();
    const dagger = inventory.items[0];
    assert.equal(dagger.weapon.id, 'dagger');
    assert.equal((await fetch(`http://127.0.0.1:${app.address().port}/api${inventoryPath}/${dagger.id}/equip`, {
      method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ grip: 'two' }),
    })).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${app.address().port}/api${inventoryPath}/${dagger.id}/equip`, {
      method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ grip: 'one' }),
    })).status, 200);
    assert.deepEqual({ ...db.prepare('SELECT slot, equipped, grip FROM character_items WHERE id = ?').get(dagger.id) }, { slot: 'main-hand', equipped: 1, grip: 'one' });
    const bowId = Number(db.prepare(`INSERT INTO character_items
      (character_id, name, description, quantity, slot, weapon_id) VALUES (?, 'Krótki łuk', '', 1, 'backpack', 'shortbow')`).run(characterId).lastInsertRowid);
    assert.equal((await fetch(`http://127.0.0.1:${app.address().port}/api${inventoryPath}/${bowId}/equip`, {
      method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ grip: 'two' }),
    })).status, 200);
    assert.deepEqual({ ...db.prepare('SELECT slot, equipped, grip FROM character_items WHERE id = ?').get(bowId) }, { slot: 'belt', equipped: 1, grip: 'none' });
    assert.equal(db.prepare('SELECT equipped FROM character_items WHERE id = ?').get(dagger.id).equipped, 1);
  } finally {
    await new Promise(resolve => app.close(resolve));
    db.close();
  }
});
