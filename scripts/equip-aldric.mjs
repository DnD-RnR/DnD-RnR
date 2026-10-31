import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { statisticsSummary } from '../server/statistics-summary.mjs';

const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const character = await db.run(() => {
    const matches = db.prepare('SELECT * FROM characters').all().filter(c => c.name.toLowerCase() === 'aldric');
    if (matches.length !== 1 || !matches[0].class.includes('Fighter')) throw new Error('Expected exactly one Fighter named Aldric.');
    const c = matches[0];
    for (const [weaponId, slot, equipped, grip] of [['longsword', 'main-hand', 1, 'one'], ['shortbow', 'belt', 1, 'none'], ['handaxe', 'backpack', 0, 'one']]) {
      if (db.prepare('SELECT id FROM character_items WHERE character_id = ? AND weapon_id = ?').get(c.id, weaponId)) continue;
      const w = db.prepare('SELECT * FROM weapon_catalog WHERE id = ?').get(weaponId);
      if (equipped) db.prepare("UPDATE character_items SET equipped = 0, slot = 'backpack' WHERE character_id = ? AND slot = ? AND equipped = 1").run(c.id, slot);
      db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, weapon_id, grip, weight, cost)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`).run(c.id, w.name, `${w.damage} · ${w.damage_type}`, slot, equipped, weaponId, grip, w.weight, w.cost);
    }
    for (const [armorId, slot] of [['chain-mail', 'armor'], ['shield', 'off-hand']]) {
      if (db.prepare('SELECT id FROM character_items WHERE character_id = ? AND armor_id = ?').get(c.id, armorId)) continue;
      const a = db.prepare('SELECT * FROM armor_catalog WHERE id = ?').get(armorId);
      db.prepare("UPDATE character_items SET equipped = 0, slot = 'backpack' WHERE character_id = ? AND slot = ? AND equipped = 1").run(c.id, slot);
      db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, armor_id, grip, weight, cost)
        VALUES (?, ?, ?, 1, ?, 1, ?, 'none', ?, ?)`).run(c.id, a.name, a.armor_class, slot, armorId, a.weight, a.cost);
    }
    if (!db.prepare('SELECT id FROM character_items WHERE character_id = ? AND name = ?').get(c.id, 'Strzały')) {
      db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, grip, weight, cost)
        VALUES (?, 'Strzały', 'Amunicja do krótkiego łuku.', 20, 'backpack', 0, 'none', 0.05, '1 GP / 20')`).run(c.id);
    }
    return c;
  });
  db.close(); db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    const items = db.prepare('SELECT name, quantity, slot, equipped, weapon_id, armor_id FROM character_items WHERE character_id = ? ORDER BY id').all(character.id);
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(character.id).data);
    const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength,
      a.stealth_disadvantage AS stealthDisadvantage FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(character.id);
    const summary = statisticsSummary(character, stats, equipment);
    if (!items.some(i => i.weapon_id === 'longsword' && i.equipped) || summary.ac !== 18) throw new Error('Equipment verification failed.');
    console.log(JSON.stringify({ character: character.name, items, ac: summary.ac, hp: summary.hp, maxHp: summary.maxHp, verified: true }));
  });
} finally { db?.close(); await firestore.terminate(); }
