import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { handleMonsters } from '../server/monsters.mjs';
import samples from '../shared/sample-monsters.json' with { type: 'json' };

const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const gameId = await db.run(() => {
    const games = db.prepare('SELECT id, gm_id FROM games WHERE name = ?').all('Testowa G');
    if (games.length !== 1) throw new Error('Expected exactly one game named Testowa G.');
    const game = games[0];
    for (const monster of samples) {
      const exists = db.prepare('SELECT 1 FROM game_monster_entries WHERE game_id = ? AND id = ?').get(game.id, monster.id);
      if (exists) continue;
      handleMonsters(db, { id: game.gm_id, role: 'gm' }, `/api/games/${game.id}/monsters/create`, 'POST', { monster }, (status, result) => {
        if (status !== 200) throw new Error(result.error);
      });
    }
    return game.id;
  });
  db.close(); db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    const monsters = db.prepare('SELECT id, name FROM game_monster_entries WHERE game_id = ? ORDER BY name').all(gameId);
    if (!samples.every(sample => monsters.some(monster => monster.id === sample.id))) throw new Error('Verification failed.');
    console.log(JSON.stringify({ gameId, game: 'Testowa G', monsters, verified: true }));
  });
} finally { db?.close(); await firestore.terminate(); }
