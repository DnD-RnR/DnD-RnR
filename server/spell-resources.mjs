import { spellcastingProfile, spellById, validateSpellSelection } from '../shared/spellcasting.mjs';
import { spellEffects, spellAction } from '../shared/combat-spells.mjs';
import { statisticsSummary } from './statistics-summary.mjs';
import { emptyStatistics } from './statistics.mjs';

export const resourceState = (db, id) => {
  const row = db.prepare('SELECT data FROM character_spell_resources WHERE character_id = ?').get(id);
  if (row) return JSON.parse(row.data);
  const initial = { spent: Array(9).fill(0), pactSpent: 0, arcanum: {}, version: 0 };
  db.prepare('INSERT INTO character_spell_resources (character_id, data) VALUES (?, ?)').run(id, JSON.stringify(initial));
  return initial;
};
export function saveResources(db, id, state) {
  state.version++;
  db.prepare(`INSERT INTO character_spell_resources (character_id, data) VALUES (?, ?)
    ON CONFLICT(character_id) DO UPDATE SET data = excluded.data`).run(id, JSON.stringify(state));
}
export function casterData(db, id) {
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id);
  const stats = row ? JSON.parse(row.data) : emptyStatistics();
  const profile = spellcastingProfile(character, stats.spells);
  const error = validateSpellSelection(character, stats.spells);
  const ids = new Set(profile.automatic.map(s => s.id));
  for (const group of profile.groups.filter(g => g.id !== 'book')) for (const id of stats.spells.selections[group.id] ?? []) if (group.options.some(s => s.id === id)) ids.add(id);
  const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength, a.stealth_disadvantage AS stealthDisadvantage FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(id);
  const state = resourceState(db, id), s = statisticsSummary(character, stats, equipment);
  const slots = profile.pactSlotLevel ? [] : profile.slots.map((total, i) => ({ level: i + 1, total, remaining: Math.max(0, total - (state.spent[i] ?? 0)), source: 'slot' })).filter(s => s.total);
  if (profile.pactSlotLevel) slots.push({ level: profile.pactSlotLevel, total: profile.slots[0], remaining: Math.max(0, profile.slots[0] - state.pactSpent), source: 'pact' });
  const spells = [...ids].map(id => spellById.get(id)).filter(Boolean).map(spell => {
    const arcanum = profile.groups.find(g => g.id.startsWith('arcanum') && stats.spells.selections[g.id]?.includes(spell.id));
    return { ...spell, action: spellAction(spell), effect: spellEffects[spell.id] ?? null, arcanum: Boolean(arcanum), arcanumRemaining: arcanum ? !state.arcanum[spell.id] : false };
  });
  return { character, stats, profile, state, blocked: s.spellcastingBlocked, ability: s.abilities[profile.ability]?.modifier ?? null, attack: s.spellAttack, dc: s.spellDc, slots, spells, error };
}
export function publicCaster(db, id) {
  const c = casterData(db, id);
  return { slots: c.slots, spells: c.spells, ability: c.ability, attack: c.attack, dc: c.dc, error: c.error, resourceVersion: c.state.version };
}
export function spendSpell(db, id, spellId, level, source) {
  const c = casterData(db, id), spell = c.spells.find(s => s.id === spellId);
  if (c.error || !spell) throw new Error(c.error || 'Ten czar nie jest przygotowany ani dostępny dla postaci.');
  if (!spell.action) throw new Error('Ten czar wymaga dłuższego czasu rzucania; rozstrzyga go GM.');
  if (spell.level === 0) {
    if (level !== 0) throw new Error('Sztuczki nie zużywają miejsc na czary.');
  } else if (source === 'arcanum') {
    if (!spell.arcanum || !spell.arcanumRemaining || level !== spell.level) throw new Error('Mystic Arcanum jest niedostępne.');
    c.state.arcanum[spell.id] = true; saveResources(db, id, c.state);
  } else {
    const slot = c.slots.find(s => s.level === level && s.source === source && s.remaining > 0);
    if (!slot || level < spell.level) throw new Error('Brak miejsca na czar odpowiedniego kręgu.');
    if (source === 'pact') c.state.pactSpent++; else c.state.spent[level - 1] = (c.state.spent[level - 1] ?? 0) + 1;
    saveResources(db, id, c.state);
  }
  return { ...c, spell };
}
export function handleSpellResources(db, user, path, method, body, send) {
  const own = path.match(/^\/api\/characters\/([1-9]\d*)\/spell-resources$/);
  const rest = path.match(/^\/api\/games\/([1-9]\d*)\/spell-rest$/);
  if (!own && !rest) return false;
  const reply = (status, data) => { send(status, data); return true; };
  if (own) {
    const id = Number(own[1]);
    if (!db.prepare('SELECT 1 FROM characters WHERE id = ? AND user_id = ?').get(id, user.id)) return reply(404, { error: 'Nie znaleziono postaci.' });
    if (method !== 'GET') return reply(405, { error: 'Niedozwolona metoda.' });
    return reply(200, { spellcasting: publicCaster(db, id) });
  }
  const gameId = Number(rest[1]);
  if (user.role !== 'gm' || !db.prepare('SELECT 1 FROM games WHERE id = ? AND gm_id = ?').get(gameId, user.id)) return reply(404, { error: 'Nie znaleziono gry.' });
  if (method !== 'POST') return reply(405, { error: 'Niedozwolona metoda.' });
  if (!['long', 'short'].includes(body.rest)) return reply(400, { error: 'Wybierz rodzaj odpoczynku.' });
  const fights = db.prepare(`SELECT b.data FROM session_battles b JOIN game_sessions s ON s.id = b.session_id WHERE s.game_id = ? AND s.ended_at IS NULL`).all(gameId);
  if (fights.some(row => JSON.parse(row.data).active)) return reply(409, { error: 'Odpoczynek nie jest dostępny w trakcie walki.' });
  const characters = db.prepare(`SELECT m.character_id FROM game_members m JOIN session_participants p ON p.member_id = m.id JOIN game_sessions s ON s.id = p.session_id
    WHERE m.game_id = ? AND m.status = 'accepted' AND s.ended_at IS NULL`).all(gameId);
  if (!characters.length) return reply(409, { error: 'Brak postaci w bieżącej sesji.' });
  for (const { character_id: id } of characters) {
    const state = resourceState(db, id);
    if (body.rest === 'long') { state.spent = Array(9).fill(0); state.arcanum = {}; state.concentration = null; state.lastLongRest = Date.now(); }
    state.pactSpent = 0; state.lastRest = Date.now(); saveResources(db, id, state);
  }
  return reply(200, { restored: characters.length });
}
