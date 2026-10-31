import { mkdirSync, writeFileSync } from 'node:fs';
import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { statisticsSummary } from '../server/statistics-summary.mjs';

const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const snapshot = await db.run(() => {
    const matches = db.prepare('SELECT * FROM characters').all().filter(c => c.name.toLowerCase() === 'bobas');
    if (matches.length !== 1 || matches[0].class !== 'Bard') throw new Error('Expected exactly one Bard named Bobas.');
    const character = matches[0];
    return { character, items: db.prepare('SELECT * FROM character_items WHERE character_id = ? ORDER BY id').all(character.id) };
  });
  mkdirSync('data/backups', { recursive: true });
  const backup = `data/backups/bobas-equipment-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify(snapshot, null, 2));
  await db.run(() => {
    const id = snapshot.character.id;
    const current = db.prepare('SELECT * FROM character_items WHERE character_id = ? ORDER BY id').all(id);
    if (JSON.stringify(current) !== JSON.stringify(snapshot.items)) throw new Error('Inventory changed; refusing to overwrite.');
    db.prepare('DELETE FROM character_items WHERE character_id = ?').run(id);
    const addWeapon = db.prepare(`INSERT INTO character_items
      (character_id, name, description, quantity, slot, equipped, weapon_id, grip, weight, cost)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`);
    for (const [weaponId, slot, equipped, grip] of [['dagger', 'main-hand', 1, 'one'], ['handaxe', 'backpack', 0, 'one'], ['shortbow', 'belt', 1, 'none']]) {
      const w = db.prepare('SELECT * FROM weapon_catalog WHERE id = ?').get(weaponId);
      if (!w) throw new Error(`Missing weapon: ${weaponId}`);
      addWeapon.run(id, w.name, `${w.damage} · ${w.damage_type} · ${JSON.parse(w.properties).join(', ')}`, slot, equipped, weaponId, grip, w.weight, w.cost);
    }
    const armor = db.prepare("SELECT * FROM armor_catalog WHERE id = 'studded-leather'").get();
    db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, armor_id, grip, weight, cost)
      VALUES (?, ?, ?, 1, 'armor', 1, ?, 'none', ?, ?)`).run(id, armor.name, armor.armor_class, armor.id, armor.weight, armor.cost);
    db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, grip, weight, cost)
      VALUES (?, 'Strzały', 'Amunicja do krótkiego łuku.', 20, 'backpack', 0, 'none', 0.05, '1 GP / 20')`).run(id);
  });
  // Reopen the Firestore-backed connection to verify the committed inventory.
  db.close();
  db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    const id = snapshot.character.id;
    const items = db.prepare('SELECT name, quantity, slot, equipped, weapon_id, armor_id FROM character_items WHERE character_id = ? ORDER BY id').all(id);
    const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass,
      a.strength, a.stealth_disadvantage AS stealthDisadvantage FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(id);
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id).data);
    const summary = statisticsSummary(snapshot.character, stats, equipment);
    console.log(JSON.stringify({ character: snapshot.character.name, backup, items, ac: summary.ac, hp: summary.hp }));
  });
} finally { db?.close(); await firestore.terminate(); }
