import { connectFirestore, openFirestoreDatabase } from '../server/firestore.mjs';
import { statisticsSummary } from '../server/statistics-summary.mjs';

const firestore = connectFirestore();
let db;
try {
  db = await openFirestoreDatabase(firestore);
  const result = await db.run(() => {
    const matches = db.prepare('SELECT * FROM characters').all().filter(c => c.name.toLowerCase() === 'bobas');
    if (matches.length !== 1) throw new Error('Expected exactly one Bobas.');
    const character = matches[0];
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(character.id).data);
    const maxHp = statisticsSummary(character, stats).maxHp;
    if (!Number.isInteger(maxHp) || maxHp < 1) throw new Error('Missing maximum HP.');
    Object.assign(stats.values, { hp: maxHp, deathSuccesses: 0, deathFailures: 0 });
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = ?').run(JSON.stringify(stats), character.id);
    let updatedBattles = 0;
    for (const row of db.prepare(`SELECT b.session_id, b.data FROM session_battles b JOIN game_sessions s ON s.id = b.session_id WHERE s.ended_at IS NULL`).all()) {
      const battle = JSON.parse(row.data);
      if (!battle.active) continue;
      const fighter = battle.fighters.find(f => f.characterId === character.id);
      if (!fighter) continue;
      Object.assign(fighter, { hp: maxHp, maxHp, deathSuccesses: 0, deathFailures: 0 });
      battle.version++;
      battle.log = [...battle.log, `Bobas: przywrócono pełne PW (${maxHp}).`].slice(-100);
      db.prepare('UPDATE session_battles SET data = ? WHERE session_id = ?').run(JSON.stringify(battle), row.session_id);
      updatedBattles++;
    }
    return { id: character.id, hp: maxHp, maxHp, updatedBattles };
  });
  db.close();
  db = await openFirestoreDatabase(firestore);
  await db.run(() => {
    const values = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(result.id).data).values;
    if (values.hp !== result.maxHp || values.deathFailures !== 0 || values.deathSuccesses !== 0) throw new Error('Verification failed.');
    console.log(JSON.stringify({ ...result, verified: true }));
  });
} finally { db?.close(); await firestore.terminate(); }
