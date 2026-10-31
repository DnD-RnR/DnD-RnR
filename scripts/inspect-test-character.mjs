import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    const characters = db.prepare('SELECT id, name, class, level FROM characters').all().filter(c => c.name.toLocaleLowerCase('pl').includes('bobas'));
    for (const character of characters) {
      const stats = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(character.id);
      console.log(JSON.stringify({ character, values: stats ? JSON.parse(stats.data).values : null,
        items: db.prepare('SELECT id, name, slot, equipped, weapon_id, armor_id FROM character_items WHERE character_id = ?').all(character.id) }));
    }
  });
} finally { db?.close(); await firestore.terminate(); }
