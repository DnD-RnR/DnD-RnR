import { statisticsSummary } from './statistics-summary.mjs';
import { defensiveEquipment } from './armor-class.mjs';
import { listArmors } from './armors.mjs';
import { listItems } from './items.mjs';
import { listWeapons } from './weapons.mjs';
import { MAX_EQUIPMENT_GRANTS, MAX_ITEM_QUANTITY, splitGold } from '../shared/equipment.mjs';

const goldSourceId = 'gold-piece';
const isNumericId = id => Number.isSafeInteger(id) && id > 0;
const isCatalogKey = id => typeof id === 'string' && id.length > 0 && id.length <= 80;

function awardSource(entry) {
  if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > MAX_ITEM_QUANTITY) return null;
  const itemId = isNumericId(entry.itemId) ? entry.itemId : null;
  const armorId = isCatalogKey(entry.armorId) ? entry.armorId : null;
  const weaponId = isCatalogKey(entry.weaponId) ? entry.weaponId : null;
  return [itemId, armorId, weaponId].filter(Boolean).length === 1 ? { itemId, armorId, weaponId, quantity: entry.quantity } : null;
}

function awardEquipment(db, gameId, gmId, characterIds, items, gold, reply) {
  if (!Array.isArray(characterIds) || !characterIds.length || !characterIds.every(isNumericId) || new Set(characterIds).size !== characterIds.length) {
    return reply(400, { error: 'Wybierz postacie, którym chcesz przydzielić ekwipunek.' });
  }
  if (!Array.isArray(items) || !Number.isSafeInteger(gold) || gold < 0 || gold > MAX_ITEM_QUANTITY * characterIds.length) {
    return reply(400, { error: `Podaj poprawne przedmioty i pulę złota. Na jedną postać może przypaść do ${MAX_ITEM_QUANTITY} GP w jednym przydziale.` });
  }
  if (!items.length && !gold) return reply(400, { error: 'Dodaj przedmiot lub wpisz pulę złota.' });
  if (items.length * characterIds.length + Math.min(gold, characterIds.length) > MAX_EQUIPMENT_GRANTS) {
    return reply(400, { error: `Jeden przydział może zawierać do ${MAX_EQUIPMENT_GRANTS} pozycji we wszystkich plecakach łącznie.` });
  }
  const sources = items.map(awardSource);
  if (sources.includes(null)) return reply(400, { error: `Wybierz przedmioty z katalogu i podaj liczbę sztuk od 1 do ${MAX_ITEM_QUANTITY}.` });

  db.exec('BEGIN IMMEDIATE');
  try {
    const members = new Set(db.prepare(`SELECT m.character_id FROM game_members m JOIN games g ON g.id = m.game_id
      WHERE m.game_id = ? AND g.gm_id = ? AND m.status = 'accepted'`).all(gameId, gmId).map(row => row.character_id));
    if (!characterIds.every(id => members.has(id))) {
      db.exec('ROLLBACK');
      return reply(404, { error: 'Co najmniej jedna z wybranych postaci nie należy już do tej gry.' });
    }

    const findItem = db.prepare(`SELECT name, description, slot, armor_id, weight, cost, source_id, weapon_id FROM item_catalog WHERE id = ?
      UNION ALL SELECT name, '', CASE WHEN category = 'shield' THEN 'off-hand' ELSE 'armor' END, id, weight, cost, NULL, NULL FROM armor_catalog WHERE id = ?
      UNION ALL SELECT name, '', CASE WHEN type = 'dystansowa' THEN 'belt' ELSE 'main-hand' END, NULL, weight, cost, NULL, id FROM weapon_catalog WHERE id = ?`);
    const awards = sources.map(({ itemId, armorId, weaponId, quantity }) => {
      const item = findItem.get(itemId, armorId, weaponId);
      return item && { ...item, quantity };
    });
    if (awards.includes(undefined)) {
      db.exec('ROLLBACK');
      return reply(404, { error: 'Co najmniej jedna z wybranych pozycji nie jest już dostępna w katalogu.' });
    }

    // Copy the catalog entry and keep the IDs used by equipment and combat rules.
    const insert = db.prepare(`INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, armor_id, weight, cost, source_id, weapon_id)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`);
    const addGold = db.prepare(`UPDATE character_items SET quantity = quantity + ? WHERE id = (
      SELECT id FROM character_items WHERE character_id = ? AND source_id = ? AND slot = 'backpack' AND equipped = 0
        AND quantity <= ? ORDER BY id LIMIT 1)`);
    const shares = splitGold(gold, characterIds.length);
    for (const [index, characterId] of characterIds.entries()) {
      for (const item of awards) {
        insert.run(characterId, item.name, item.description, item.quantity, item.slot, item.armor_id, item.weight, item.cost, item.source_id, item.weapon_id);
      }
      const share = shares[index];
      if (share && !addGold.run(share, characterId, goldSourceId, MAX_ITEM_QUANTITY - share).changes) {
        insert.run(characterId, 'Złoto (GP)', '', share, 'backpack', null, null, '1 GP', goldSourceId, null);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return reply(201, { ok: true });
}

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
  const route = path.match(/^\/api\/games\/([1-9]\d*)(?:\/(candidates|invitations|equipment(?:\/batch)?))?$/);
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
    if (route[2] === 'equipment' && method === 'GET') {
      const members = db.prepare(`SELECT c.id AS characterId, c.name, u.name AS playerName FROM game_members m
        JOIN characters c ON c.id = m.character_id JOIN users u ON u.id = c.user_id
        WHERE m.game_id = ? AND m.status = 'accepted' ORDER BY m.id`).all(game.id);
      return reply(200, { game: { name: game.name }, members, items: listItems(db), armors: listArmors(db), weapons: listWeapons(db) });
    }
    if (route[2] === 'equipment' && method === 'POST') return awardEquipment(db, game.id, user.id, [body.characterId], [body], 0, reply);
    if (route[2] === 'equipment/batch' && method === 'POST') {
      const { characterIds, items = [], gold = 0 } = body;
      return awardEquipment(db, game.id, user.id, characterIds, items, gold, reply);
    }
    if (route[2] === 'candidates' && method === 'GET') return reply(200, { characters: db.prepare(`SELECT c.id, c.name, u.name AS playerName FROM characters c JOIN users u ON u.id = c.user_id
      WHERE u.role IN ('player', 'gm') AND NOT EXISTS (SELECT 1 FROM game_members m WHERE m.game_id = ? AND m.character_id = c.id AND m.status != 'declined')
      AND NOT EXISTS (SELECT 1 FROM game_members m WHERE m.character_id = c.id AND m.status = 'accepted') ORDER BY c.name, c.id`).all(game.id) });
    if (route[2] === 'invitations' && method === 'POST') {
      if (!Number.isSafeInteger(body.characterId) || !db.prepare("SELECT c.id FROM characters c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND u.role IN ('player', 'gm')").get(body.characterId)) return reply(400, { error: 'Wybierz istniejącego bohatera gracza.' });
      if (db.prepare("SELECT id FROM game_members WHERE character_id = ? AND status = 'accepted'").get(body.characterId)) return reply(409, { error: 'Ta postać już uczestniczy w grze. Może być tylko w jednej grze na raz.' });
      const result = db.prepare(`INSERT INTO game_members (game_id, character_id) VALUES (?, ?)
        ON CONFLICT(game_id, character_id) DO UPDATE SET status = 'pending' WHERE game_members.status = 'declined'`).run(game.id, body.characterId);
      return result.changes ? reply(201, { ok: true }) : reply(409, { error: 'Ten bohater został już zaproszony.' });
    }
    if (!route[2] && method === 'GET') {
      const activeSession = db.prepare('SELECT id, started_at AS startedAt FROM game_sessions WHERE game_id = ? AND ended_at IS NULL').get(game.id) ?? null;
      const members = db.prepare(`SELECT m.id, m.status, c.id AS characterId, c.name, u.name AS playerName FROM game_members m JOIN characters c ON c.id = m.character_id JOIN users u ON u.id = c.user_id WHERE m.game_id = ? ORDER BY m.id`).all(game.id);
      for (const member of members) if (member.status === 'accepted') {
        member.participating = Boolean(activeSession && db.prepare('SELECT 1 FROM session_participants WHERE session_id = ? AND member_id = ?').get(activeSession.id, member.id));
        member.character = db.prepare('SELECT id, name, class, level, species, background, subclass FROM characters WHERE id = ?').get(member.characterId);
        const saved = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(member.characterId);
        const equipment = defensiveEquipment(db, member.characterId);
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
