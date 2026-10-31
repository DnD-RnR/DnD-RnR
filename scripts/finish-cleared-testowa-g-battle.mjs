import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { handleBattles } from '../server/battles.mjs';

const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const sessionId = await db.run(() => {
    const games = db.prepare('SELECT id, gm_id FROM games WHERE name = ?').all('Testowa G');
    if (games.length !== 1) throw new Error('Expected exactly one Testowa G.');
    const game = games[0];
    const session = db.prepare('SELECT id FROM game_sessions WHERE game_id = ? AND ended_at IS NULL').get(game.id);
    if (!session) throw new Error('No active session.');
    const row = db.prepare('SELECT data FROM session_battles WHERE session_id = ?').get(session.id);
    if (!row) throw new Error('No saved battle.');
    const battle = JSON.parse(row.data);
    if (!battle.active) return session.id;
    // Complete only the cleared battle the user already tried to end.
    if (battle.fighters.some(f => !f.characterId && f.hp > 0)) throw new Error('Monsters remain; refusing to end this battle.');
    handleBattles(db, { id: game.gm_id, role: 'gm' }, `/api/games/${game.id}/battle/end`, 'POST', { sessionId: session.id, version: battle.version }, (status, data) => {
      if (status !== 200) throw new Error(data.error);
    });
    return session.id;
  });
  db.close(); db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    const battle = JSON.parse(db.prepare('SELECT data FROM session_battles WHERE session_id = ?').get(sessionId).data);
    if (battle.active || !battle.summary) throw new Error('Summary verification failed.');
    console.log(JSON.stringify({ sessionId, active: battle.active, summary: battle.summary, verified: true }));
  });
} finally { db?.close(); await firestore.terminate(); }
