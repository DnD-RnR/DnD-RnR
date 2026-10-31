import { mkdirSync, writeFileSync } from 'node:fs';
import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import samples from '../shared/sample-monsters.json' with { type: 'json' };

const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const result = await db.run(() => {
    const removed = [];
    const games = db.prepare('SELECT id, name FROM games ORDER BY id').all();
    for (const game of games) {
      // Game 1 is where the user explicitly requested the five test monsters.
      if (game.id === 1) continue;
      for (const row of db.prepare('SELECT * FROM game_monster_entries WHERE game_id = ?').all(game.id)) {
        const sample = samples.find(m => m.id === row.id);
        if (!sample) continue;
        const saves = JSON.parse(row.saves);
        const unchanged = ['name', 'hp', 'ac', 'speed', 'notes'].every(key => row[key] === sample[key])
          && Object.keys(sample.saves).every(key => saves[key] === sample.saves[key]);
        if (unchanged) removed.push(row);
      }
    }
    if (removed.length) {
      mkdirSync('data/backups', { recursive: true });
      writeFileSync(`data/backups/auto-sample-monsters-${Date.now()}.json`, JSON.stringify(removed, null, 2));
      for (const row of removed) db.prepare('DELETE FROM game_monster_entries WHERE game_id = ? AND id = ?').run(row.game_id, row.id);
    }
    return { removed: removed.map(m => ({ gameId: m.game_id, id: m.id })), games };
  });
  db.close(); db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    console.log(JSON.stringify({ removed: result.removed, verifiedCounts: result.games.map(g => ({ ...g, monsters: db.prepare('SELECT COUNT(*) AS n FROM game_monster_entries WHERE game_id = ?').get(g.id).n })) }));
  });
} finally { db?.close(); await firestore.terminate(); }
