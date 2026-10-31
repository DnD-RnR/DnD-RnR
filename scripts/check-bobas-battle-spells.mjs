import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { handleBattles } from '../server/battles.mjs';
const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    const c = db.prepare('SELECT id, user_id FROM characters WHERE name = ?').get('Bobas');
    for (const session of db.prepare('SELECT id, game_id FROM game_sessions WHERE ended_at IS NULL').all()) {
      handleBattles(db, { id: c.user_id, role: 'player' }, `/api/games/${session.game_id}/battle`, 'GET', {}, (status, response) => {
        if (status !== 200) return;
        const battle = response.battle;
        const fighter = battle?.fighters.find(f => f.characterId === c.id);
        console.log(JSON.stringify({ game: session.game_id, active: battle?.active, current: battle?.fighters[battle.turn]?.name,
          bobas: fighter ? { hp: fighter.hp, action: fighter.action, bonus: fighter.bonus, reaction: fighter.reaction,
            canControl: response.controlledIds.includes(fighter.id), spells: fighter.spellcasting?.spells.map(s => ({ name: s.name, action: s.action })) } : null }));
      });
    }
  });
} finally { db?.close(); await firestore.terminate(); }
