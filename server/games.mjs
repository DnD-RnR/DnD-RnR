import { statisticsSummary } from './statistics-summary.mjs';

export function handleGames(db, user, path, method, body, send) {
  if (!/^\/api\/(games|invitations)(\/|$)/.test(path)) return false;
  const reply = (status, data) => { send(status, data); return true; };
  if (path === '/api/games' && method === 'GET') {
    const games = db.prepare(`SELECT g.*, u.name AS gmName FROM games g JOIN users u ON u.id = g.gm_id
      WHERE g.gm_id = ? OR EXISTS (SELECT 1 FROM game_members m JOIN characters c ON c.id = m.character_id WHERE m.game_id = g.id AND c.user_id = ? AND m.status = 'accepted') ORDER BY g.id DESC`).all(user.id, user.id);
    for (const game of games) {
      const row = db.prepare(`SELECT b.session_id, b.data FROM session_battles b JOIN game_sessions s ON s.id = b.session_id
        WHERE s.game_id = ? AND s.ended_at IS NULL`).get(game.id);
      game.activeBattleSessionId = row && JSON.parse(row.data).active ? row.session_id : null;
    }
    return reply(200, { games });
  }
  if (path === '/api/games' && method === 'POST') {
    if (user.role !== 'gm') return reply(403, { error: 'Tylko GM może tworzyć gry.' });
    const { name, description = '' } = body;
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || typeof description !== 'string' || description.length > 2000) return reply(400, { error: 'Podaj nazwę (do 80 znaków) i opis (do 2000 znaków).' });
    const result = db.prepare('INSERT INTO games (gm_id, name, description) VALUES (?, ?, ?)').run(user.id, name.trim(), description.trim());
    return reply(201, { id: Number(result.lastInsertRowid) });
  }
  if (path === '/api/invitations' && method === 'GET') return reply(200, { invitations: db.prepare(`SELECT m.id, g.name AS gameName, u.name AS gmName, c.name AS characterName
    FROM game_members m JOIN games g ON g.id = m.game_id JOIN users u ON u.id = g.gm_id JOIN characters c ON c.id = m.character_id
    WHERE c.user_id = ? AND m.status = 'pending' ORDER BY m.id DESC`).all(user.id) });
  const invitation = path.match(/^\/api\/invitations\/([1-9]\d*)\/(accept|decline)$/);
  if (invitation && method === 'POST') {
    const owned = db.prepare(`SELECT m.character_id FROM game_members m JOIN characters c ON c.id = m.character_id WHERE m.id = ? AND m.status = 'pending' AND c.user_id = ?`).get(Number(invitation[1]), user.id);
    if (!owned) return reply(404, { error: 'Zaproszenie jest niedostępne lub zostało już rozpatrzone.' });
    if (invitation[2] === 'accept' && db.prepare("SELECT id FROM game_members WHERE character_id = ? AND status = 'accepted'").get(owned.character_id)) return reply(409, { error: 'Ta postać już uczestniczy w grze. Może być tylko w jednej grze na raz.' });
    let result;
    try {
      result = db.prepare(`UPDATE game_members SET status = ? WHERE id = ? AND status = 'pending' AND character_id IN (SELECT id FROM characters WHERE user_id = ?)`).run(invitation[2] === 'accept' ? 'accepted' : 'declined', Number(invitation[1]), user.id);
    } catch (error) {
      if (error.errcode === 2067) return reply(409, { error: 'Ta postać już uczestniczy w grze. Może być tylko w jednej grze na raz.' });
      throw error;
    }
    return result.changes ? reply(200, { ok: true }) : reply(404, { error: 'Zaproszenie jest niedostępne lub zostało już rozpatrzone.' });
  }
  const removeMember = path.match(/^\/api\/games\/([1-9]\d*)\/members\/([1-9]\d*)\/remove$/);
  if (removeMember && method === 'POST') {
    if (user.role !== 'gm') return reply(404, { error: 'Nie znaleziono uczestnika gry.' });
    const result = db.prepare(`DELETE FROM game_members WHERE id = ? AND game_id = ? AND status = 'accepted'
      AND EXISTS (SELECT 1 FROM games WHERE id = game_members.game_id AND gm_id = ?)`).run(Number(removeMember[2]), Number(removeMember[1]), user.id);
    return result.changes ? reply(200, { ok: true }) : reply(404, { error: 'Nie znaleziono uczestnika gry.' });
  }
  const route = path.match(/^\/api\/games\/([1-9]\d*)(?:\/(candidates|invitations|equipment))?$/);
  const equipmentRemoval = path.match(/^\/api\/games\/([1-9]\d*)\/equipment\/remove$/);
  if (equipmentRemoval && method === 'POST') {
    const gameId = Number(equipmentRemoval[1]);
    if (user.role !== 'gm' || !db.prepare('SELECT id FROM games WHERE id = ? AND gm_id = ?').get(gameId, user.id)) return reply(404, { error: 'Nie znaleziono gry.' });
    const { characterId, itemId, quantity } = body;
    if (!Number.isSafeInteger(characterId) || characterId < 1 || !Number.isSafeInteger(itemId) || itemId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return reply(400, { error: 'Wybierz przedmiot i liczbę sztuk 1–9999.' });
    db.exec('BEGIN IMMEDIATE');
    try {
      const item = db.prepare(`SELECT i.id, i.quantity FROM character_items i
        JOIN game_members m ON m.character_id = i.character_id JOIN games g ON g.id = m.game_id
        WHERE i.id = ? AND i.character_id = ? AND m.game_id = ? AND m.status = 'accepted' AND g.gm_id = ?`).get(itemId, characterId, gameId, user.id);
      if (!item) { db.exec('ROLLBACK'); return reply(404, { error: 'Nie znaleziono przedmiotu u członka tej gry.' }); }
      if (quantity > item.quantity) { db.exec('ROLLBACK'); return reply(409, { error: 'Postać nie ma tylu sztuk. Odśwież ekwipunek.' }); }
      if (quantity === item.quantity) db.prepare('DELETE FROM character_items WHERE id = ?').run(itemId);
      else db.prepare('UPDATE character_items SET quantity = quantity - ? WHERE id = ?').run(quantity, itemId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return reply(200, { ok: true });
  }
  if (route) {
    const game = db.prepare('SELECT * FROM games WHERE id = ? AND gm_id = ?').get(Number(route[1]), user.id);
    if (!game || user.role !== 'gm') return reply(404, { error: 'Nie znaleziono gry.' });
    if (route[2] === 'equipment' && method === 'POST') {
      const { characterId, itemId, armorId, quantity } = body;
      const hasItem = Number.isSafeInteger(itemId) && itemId > 0;
      const hasArmor = typeof armorId === 'string' && armorId.length > 0;
      if (!Number.isSafeInteger(characterId) || characterId < 1 || hasItem === hasArmor || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return reply(400, { error: 'Wybierz bohatera, przedmiot z katalogu i liczbę sztuk 1–9999.' });
      if (!db.prepare("SELECT id FROM game_members WHERE game_id = ? AND character_id = ? AND status = 'accepted'").get(game.id, characterId)) return reply(404, { error: 'Bohater nie uczestniczy w tej grze.' });
      // Copy catalog data into the backpack; future catalog changes do not change awarded items.
      const result = db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, armor_id, weight, cost)
        SELECT ?, a.name, '', ?, CASE WHEN a.category = 'shield' THEN 'off-hand' ELSE 'armor' END, 0, a.id, a.weight, a.cost FROM armor_catalog a
        WHERE ? IS NOT NULL AND a.id = ? AND EXISTS (SELECT 1 FROM game_members m JOIN games g ON g.id = m.game_id
          WHERE m.game_id = ? AND g.gm_id = ? AND m.character_id = ? AND m.status = 'accepted')
        UNION ALL
        SELECT ?, i.name, i.description, ?, i.slot, 0, i.armor_id, i.weight, i.cost FROM item_catalog i
        WHERE i.id = ? AND EXISTS (SELECT 1 FROM game_members m JOIN games g ON g.id = m.game_id
          WHERE m.game_id = ? AND g.gm_id = ? AND m.character_id = ? AND m.status = 'accepted')`).run(
        characterId, quantity, armorId ?? null, armorId ?? '', game.id, user.id, characterId,
        characterId, quantity, itemId ?? 0, game.id, user.id, characterId);
      return result.changes ? reply(201, { ok: true }) : reply(404, { error: 'Przedmiot lub uczestnik gry jest już niedostępny.' });
    }
    if (route[2] === 'candidates' && method === 'GET') return reply(200, { characters: db.prepare(`SELECT c.id, c.name, u.name AS playerName FROM characters c JOIN users u ON u.id = c.user_id
      WHERE u.role IN ('player', 'gm') AND NOT EXISTS (SELECT 1 FROM game_members m WHERE m.game_id = ? AND m.character_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM game_members m WHERE m.character_id = c.id AND m.status = 'accepted') ORDER BY c.name, c.id`).all(game.id) });
    if (route[2] === 'invitations' && method === 'POST') {
      if (!Number.isSafeInteger(body.characterId) || !db.prepare("SELECT c.id FROM characters c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND u.role IN ('player', 'gm')").get(body.characterId)) return reply(400, { error: 'Wybierz istniejącego bohatera gracza.' });
      if (db.prepare("SELECT id FROM game_members WHERE character_id = ? AND status = 'accepted'").get(body.characterId)) return reply(409, { error: 'Ta postać już uczestniczy w grze. Może być tylko w jednej grze na raz.' });
      const result = db.prepare('INSERT OR IGNORE INTO game_members (game_id, character_id) VALUES (?, ?)').run(game.id, body.characterId);
      return result.changes ? reply(201, { ok: true }) : reply(409, { error: 'Ten bohater został już zaproszony.' });
    }
    if (!route[2] && method === 'GET') {
      const activeSession = db.prepare('SELECT id, started_at AS startedAt FROM game_sessions WHERE game_id = ? AND ended_at IS NULL').get(game.id) ?? null;
      const members = db.prepare(`SELECT m.id, m.status, c.id AS characterId, c.name, u.name AS playerName FROM game_members m JOIN characters c ON c.id = m.character_id JOIN users u ON u.id = c.user_id WHERE m.game_id = ? ORDER BY m.id`).all(game.id);
      for (const member of members) if (member.status === 'accepted') {
        member.participating = Boolean(activeSession && db.prepare('SELECT 1 FROM session_participants WHERE session_id = ? AND member_id = ?').get(activeSession.id, member.id));
        member.character = db.prepare('SELECT id, name, class, level, species, background, subclass FROM characters WHERE id = ?').get(member.characterId);
        const saved = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(member.characterId);
        const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength,
          a.stealth_disadvantage AS stealthDisadvantage
          FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(member.characterId);
        member.statistics = statisticsSummary(member.character, saved ? JSON.parse(saved.data) : null, equipment);
        member.items = db.prepare('SELECT id, name, description, quantity, slot, equipped, armor_id AS armorId FROM character_items WHERE character_id = ? ORDER BY id').all(member.characterId);
      }
      const savedBattle = activeSession ? db.prepare('SELECT data FROM session_battles WHERE session_id = ?').get(activeSession.id) : null;
      const activeBattle = savedBattle && JSON.parse(savedBattle.data).active ? { sessionId: activeSession.id } : null;
      return reply(200, { game, members, activeSession, activeBattle });
    }
  }
  return reply(404, { error: 'Nie znaleziono zasobu.' });
}
