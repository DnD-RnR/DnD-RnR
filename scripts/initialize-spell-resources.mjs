import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { publicCaster } from '../server/spell-resources.mjs';

const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const ids = await db.run(() => {
    const characters = db.prepare('SELECT id FROM characters').all();
    // Lazy initialization preserves any existing expenditures; it never resets them.
    for (const { id } of characters) publicCaster(db, id);
    return characters.map(c => c.id);
  });
  db.close(); db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    for (const id of ids) if (!db.prepare('SELECT 1 FROM character_spell_resources WHERE character_id = ?').get(id)) throw new Error('Verification failed.');
    console.log(JSON.stringify({ initializedCharacters: ids.length, collection: 'dnd_rnr/main/character_spell_resources', verified: true }));
  });
} finally { db?.close(); await firestore.terminate(); }
