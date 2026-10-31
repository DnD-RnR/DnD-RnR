import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { handleMonsters } from '../server/monsters.mjs';

// Use the same transactional initialization/migration as the application.
// Existing catalogs, including deliberately empty ones, are preserved.
const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const games = await db.run(() => db.prepare('SELECT id, gm_id FROM games ORDER BY id').all());
  for (const game of games) {
    const count = await db.run(() => {
      let count;
      handleMonsters(db, { id: game.gm_id, role: 'gm' }, `/api/games/${game.id}/monsters`, 'GET', {}, (status, result) => {
        if (status !== 200) throw new Error(result.error);
        count = result.monsters.length;
      });
      return count;
    });
    console.log(`Game ${game.id}: ${count} monsters committed to Firestore.`);
  }
} finally { db?.close(); await firestore.terminate(); }
