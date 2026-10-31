import samples from '../shared/sample-monsters.json' with { type: 'json' };

const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const valid = m => m && typeof m === 'object' && typeof m.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(m.id)
  && typeof m.name === 'string' && m.name.trim().length > 0 && m.name.length <= 80
  && integer(m.hp, 1, 9999) && integer(m.ac, 0, 9999) && integer(m.speed, 0, 9999)
  && typeof m.notes === 'string' && m.notes.length <= 5000 && m.saves && typeof m.saves === 'object'
  && ['str', 'dex', 'con', 'int', 'wis', 'cha'].every(a => integer(m.saves[a], -30, 40));
const clean = m => ({ id: m.id, name: m.name.trim(), hp: m.hp, ac: m.ac, speed: m.speed, notes: m.notes,
  saves: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => [a, m.saves[a]])) });

export function handleMonsters(db, user, path, method, body, send) {
  const route = path.match(/^\/api\/games\/([1-9]\d*)\/monsters(?:\/(create|update|delete|import))?$/);
  if (!route) return false;
  const reply = (status, data) => { send(status, data); return true; };
  const gameId = Number(route[1]);
  if (user.role !== 'gm' || !db.prepare('SELECT id FROM games WHERE id = ? AND gm_id = ?').get(gameId, user.id)) return reply(404, { error: 'Nie znaleziono gry.' });
  const action = route[2];
  if ((!action && method !== 'GET') || (action && method !== 'POST')) return reply(405, { error: 'Niedozwolona metoda.' });
  const row = db.prepare('SELECT data FROM game_monsters WHERE game_id = ?').get(gameId);
  const insert = db.prepare(`INSERT OR IGNORE INTO game_monster_entries
    (game_id, id, name, hp, ac, speed, notes, saves) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const add = m => insert.run(gameId, m.id, m.name, m.hp, m.ac, m.speed, m.notes, JSON.stringify(m.saves));
  // Migrate a former single-document catalog atomically on its first access.
  // An initialized empty catalog stays empty, so deleted samples never return.
  if (!row || row.data !== '[]') {
    const previous = row ? JSON.parse(row.data) : [];
    for (const monster of previous) add(monster);
    db.prepare(`INSERT INTO game_monsters (game_id, data) VALUES (?, '[]')
      ON CONFLICT(game_id) DO UPDATE SET data = '[]'`).run(gameId);
  }
  const read = () => db.prepare('SELECT id, name, hp, ac, speed, notes, saves FROM game_monster_entries WHERE game_id = ? ORDER BY name, id').all(gameId)
    .map(m => ({ ...m, saves: JSON.parse(m.saves) }));
  const monsters = read();
  if (action === 'delete') {
    const index = monsters.findIndex(m => m.id === body.id);
    if (index < 0) return reply(404, { error: 'Potwór został usunięty. Odśwież katalog.' });
    db.prepare('DELETE FROM game_monster_entries WHERE game_id = ? AND id = ?').run(gameId, body.id);
  } else if (action) {
    if (!valid(body.monster)) return reply(400, { error: 'Nieprawidłowe dane potwora.' });
    const monster = clean(body.monster);
    const index = monsters.findIndex(m => m.id === monster.id);
    const replace = () => db.prepare(`UPDATE game_monster_entries SET name = ?, hp = ?, ac = ?, speed = ?, notes = ?, saves = ?
      WHERE game_id = ? AND id = ?`).run(monster.name, monster.hp, monster.ac, monster.speed, monster.notes, JSON.stringify(monster.saves), gameId, monster.id);
    if (action === 'update') {
      if (index < 0) return reply(404, { error: 'Potwór został usunięty. Odśwież katalog.' });
      replace();
    } else if (index < 0) {
      add(monster);
    } else if (action === 'create') return reply(409, { error: 'Potwór o tym identyfikatorze już istnieje.' });
    else if (action === 'import' && samples.some(sample => JSON.stringify(clean(sample)) === JSON.stringify(clean(monsters[index])))) replace();
    // Import preserves cloud edits; only an untouched sample may be replaced.
  }
  return reply(200, { monsters: read() });
}
