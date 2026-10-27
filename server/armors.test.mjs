import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, hashPassword } from './db.mjs';
import { createApp } from './index.mjs';
import { armorClassFromEquipment, armorTrainingEffects, hasStealthDisadvantage, speedFromEquipment } from './armor-class.mjs';

test('armor catalog is seeded and available to authenticated users', async () => {
  const db = openDatabase(':memory:');
  const password = 'armor-test-password';
  const hash = await hashPassword(password);
  db.prepare("INSERT INTO users (username, name, password, role) VALUES ('player', 'Player', ?, 'player')").run(hash);
  const app = createApp(db);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}/api`;
  try {
    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ username: 'player', password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${baseUrl}/armors`, {
      headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' },
    });
    assert.equal(response.status, 200);
    const { armors } = await response.json();
    assert.equal(armors.length, 13);
    assert.deepEqual(armors.find(armor => armor.id === 'plate'), {
      id: 'plate',
      name: 'Zbroja płytowa',
      category: 'heavy',
      armorClass: '18',
      strength: 15,
      stealthDisadvantage: true,
      weight: 65,
      cost: '1,500 GP',
      donTime: 10,
      doffTime: 5,
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM armor_catalog').get().count, armors.length);
    const userId = db.prepare("SELECT id FROM users WHERE username = 'player'").get().id;
    const characterId = Number(db.prepare("INSERT INTO characters (user_id, name, class) VALUES (?, 'Armor hero', 'Fighter')").run(userId).lastInsertRowid);
    const insertItem = db.prepare(`INSERT INTO character_items (character_id, name, quantity, slot, armor_id)
      VALUES (?, ?, 1, ?, ?)`);
    const plateId = Number(insertItem.run(characterId, 'Zbroja płytowa', 'backpack', 'plate').lastInsertRowid);
    const shieldId = Number(insertItem.run(characterId, 'Tarcza', 'backpack', 'shield').lastInsertRowid);
    const inventoryPath = `/characters/${characterId}/inventory`;
    const equip = (id) => fetch(`${baseUrl}${inventoryPath}/${id}/equip`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal((await equip(plateId)).status, 200);
    assert.deepEqual({ ...db.prepare('SELECT slot, equipped FROM character_items WHERE id = ?').get(plateId) }, { slot: 'armor', equipped: 1 });
    assert.equal((await equip(shieldId)).status, 200);
    assert.deepEqual({ ...db.prepare('SELECT slot, equipped FROM character_items WHERE id = ?').get(shieldId) }, { slot: 'off-hand', equipped: 1 });
    assert.equal(armorClassFromEquipment({ values: { ac: 10, dex: 18 } }, [
      { equipped: 1, armorCategory: 'medium', armorClass: '14 + modyfikator Zręczności (maks. 2)' },
      { equipped: 1, armorCategory: 'shield', armorClass: '+2' },
    ]), 18);
    assert.equal(armorClassFromEquipment({ values: { ac: 10, dex: 18 } }, [
      { equipped: 1, armorCategory: 'heavy', armorClass: '16' },
    ]), 16);
    assert.equal(speedFromEquipment({ values: { str: 12 } }, [
      { equipped: 1, armorCategory: 'heavy', strength: 13 },
    ], 30), 20);
    assert.equal(speedFromEquipment({ values: { str: 13 } }, [
      { equipped: 1, armorCategory: 'heavy', strength: 13 },
    ], 30), 30);
    assert.equal(hasStealthDisadvantage([{ equipped: 1, stealthDisadvantage: 1 }]), true);
    assert.equal(hasStealthDisadvantage([{ equipped: 0, stealthDisadvantage: 1 }]), false);
    const untrained = armorTrainingEffects({ armor: ['Light armor'] }, [
      { equipped: 1, armorCategory: 'heavy' },
      { equipped: 1, armorCategory: 'shield' },
    ]);
    assert.deepEqual(untrained, {
      untrainedArmor: true,
      untrainedShield: true,
      d20StrengthDexDisadvantage: true,
      spellcastingBlocked: true,
    });
    assert.equal(armorClassFromEquipment({ values: { ac: 10, dex: 10 } }, [
      { equipped: 1, armorCategory: 'light', armorClass: '11', trained: true },
      { equipped: 1, armorCategory: 'shield', armorClass: '+2', trained: false },
    ]), 11);
    db.prepare("UPDATE character_items SET slot = 'head', equipped = 0 WHERE id = ?").run(shieldId);
    assert.equal((await equip(shieldId)).status, 400);
  } finally {
    await new Promise(resolve => app.close(resolve));
    db.close();
  }
});
