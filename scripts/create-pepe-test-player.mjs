import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { hashPassword, verifyPassword } from '../server/db.mjs';
import { emptyStatistics } from '../server/statistics.mjs';

const password = process.env.TEST_PLAYER_PASSWORD;
if (!password || password.length < 6) throw new Error('Set TEST_PLAYER_PASSWORD.');
const hashed = await hashPassword(password);
const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const created = await db.run(() => {
    if (db.prepare('SELECT id FROM users WHERE username = ?').get('pepe')) throw new Error('Login pepe already exists; refusing to overwrite.');
    const userId = Number(db.prepare('INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, ?)').run('pepe', 'Pepe', hashed, 'player').lastInsertRowid);
    const characterId = Number(db.prepare(`INSERT INTO characters (user_id, name, class, level, species, background, subclass)
      VALUES (?, ?, ?, 1, ?, ?, '')`).run(userId, 'Pepe Waleczny', 'Wojownik (Fighter)', 'Człowiek (Human)', 'Strażnik (Guard)').lastInsertRowid);
    const stats = emptyStatistics();
    Object.assign(stats.values, { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10, hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, deathSuccesses: 0, deathFailures: 0, exhaustion: 0, initiativeBonus: 0, hitDice: 1, inspiration: 0, xp: 0 });
    stats.choices.weaponMastery = ['longsword', 'shortbow'];
    db.prepare('INSERT INTO character_statistics VALUES (?, ?)').run(characterId, JSON.stringify(stats));
    for (const [weaponId, slot, equipped, grip] of [['longsword', 'main-hand', 1, 'one'], ['shortbow', 'belt', 1, 'none'], ['handaxe', 'backpack', 0, 'one']]) {
      const w = db.prepare('SELECT * FROM weapon_catalog WHERE id = ?').get(weaponId);
      db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, weapon_id, grip, weight, cost)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`).run(characterId, w.name, `${w.damage} · ${w.damage_type}`, slot, equipped, weaponId, grip, w.weight, w.cost);
    }
    for (const [armorId, slot] of [['chain-mail', 'armor'], ['shield', 'off-hand']]) {
      const a = db.prepare('SELECT * FROM armor_catalog WHERE id = ?').get(armorId);
      if (!a) throw new Error(`Missing armor: ${armorId}`);
      db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, armor_id, grip, weight, cost)
        VALUES (?, ?, ?, 1, ?, 1, ?, 'none', ?, ?)`).run(characterId, a.name, a.armor_class, slot, armorId, a.weight, a.cost);
    }
    db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, grip, weight, cost)
      VALUES (?, 'Strzały', 'Amunicja do krótkiego łuku.', 20, 'backpack', 0, 'none', 0.05, '1 GP / 20')`).run(characterId);
    return { userId, characterId };
  });
  db.close(); db = await openFirestoreDatabase(firestore);
  const result = await db.run(() => {
    const user = db.prepare('SELECT username, password FROM users WHERE id = ?').get(created.userId);
    const character = db.prepare('SELECT name, class, level FROM characters WHERE id = ? AND user_id = ?').get(created.characterId, created.userId);
    const items = db.prepare('SELECT name, equipped FROM character_items WHERE character_id = ?').all(created.characterId);
    return { user, character, items };
  });
  if (!await verifyPassword(password, result.user.password) || !result.character || result.items.length !== 6) throw new Error('Verification failed.');
  console.log(JSON.stringify({ username: result.user.username, character: result.character, items: result.items, verified: true }));
} finally { db?.close(); await firestore.terminate(); }
