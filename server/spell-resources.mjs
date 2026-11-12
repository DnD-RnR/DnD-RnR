import { restWarlock, useWarlockFeature } from './warlock-features.mjs';
import { psiResources, restPsi } from './psi-warrior.mjs';
import { paladinResources, restPaladin } from './paladin.mjs';
import { druidProfile } from '../shared/druid.mjs';
import { warlockProfile } from '../shared/warlock.mjs';
import { rageProfile } from '../shared/barbarian.mjs';
import { selectedOriginFeats, originSpellGrants } from '../shared/origin-feats.mjs';
import { spellcastingProfile, spellById, validateSpellSelection } from '../shared/spellcasting.mjs';
import { spellEffects, spellAction } from '../shared/combat-spells.mjs';
import { statisticsSummary } from './statistics-summary.mjs';
import { emptyStatistics } from './statistics.mjs';
import { characterTraits, dragonbornAncestryProfile, goliathAncestryProfile, tieflingLegacyProfile } from '../shared/character-traits.mjs';

export const resourceState = (db, id) => {
  const row = db.prepare('SELECT data FROM character_spell_resources WHERE character_id = ?').get(id);
  if (row) return JSON.parse(row.data);
  const initial = { spent: Array(9).fill(0), pactSpent: 0, arcanum: {}, tieflingLegacyUses: {}, secondWindUses: null, adrenalineRushUses: null, breathWeaponUses: null, giantAncestryUses: null, largeFormAvailable: true, draconicFlightAvailable: true, relentlessEnduranceAvailable: true, heroicInspirationAvailable: null, version: 0 };
  db.prepare('INSERT INTO character_spell_resources (character_id, data) VALUES (?, ?)').run(id, JSON.stringify(initial));
  return initial;
};
export const proficiencyBonus = level => 2 + Math.floor((level - 1) / 4);
export const speciesResourceState = (db, id, character = null) => {
  const c = character ?? db.prepare('SELECT class, subclass, level, species FROM characters WHERE id = ?').get(id);
  const state = resourceState(db, id);
  const maxAdrenalineRush = c?.species === 'Ork (Orc)' ? proficiencyBonus(c.level) : 0;
  const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id);
  const stats = row ? JSON.parse(row.data) : emptyStatistics();
  const traits = character ? characterTraits(character, stats) : null;
  const dragonborn = c?.species === 'Smokowiec (Dragonborn)' ? traits?.ancestry ?? dragonbornAncestryProfile(stats.traits?.dragonbornAncestry?.[0]) : null;
  const maxBreathWeapon = dragonborn ? proficiencyBonus(c.level) : 0;
  const tieflingLegacy = c?.species === 'Diabelstwo (Tiefling)' ? tieflingLegacyProfile(stats.traits?.tieflingLegacy?.[0]) : null;
  const maxFlight = dragonborn && c.level >= 5 ? 1 : 0;
  const goliathAncestry = c?.species === 'Goliat (Goliath)'
    ? traits?.goliathAncestry ?? goliathAncestryProfile(stats.traits?.giantAncestry?.[0])
    : null;
  const maxGiantAncestry = goliathAncestry ? proficiencyBonus(c.level) : 0;
  const maxLargeForm = goliathAncestry && c.level >= 5 ? 1 : 0;
  const human = c?.species === 'Człowiek (Human)';
  if (maxAdrenalineRush && state.adrenalineRushUses == null) state.adrenalineRushUses = maxAdrenalineRush;
  if (maxBreathWeapon && state.breathWeaponUses == null) state.breathWeaponUses = maxBreathWeapon;
  if (state.draconicFlightAvailable == null) state.draconicFlightAvailable = true;
  if (state.relentlessEnduranceAvailable == null) state.relentlessEnduranceAvailable = true;
  if (human && state.heroicInspirationAvailable == null) state.heroicInspirationAvailable = true;
  if (maxGiantAncestry && state.giantAncestryUses == null) state.giantAncestryUses = maxGiantAncestry;
  if (state.largeFormAvailable == null) state.largeFormAvailable = true;
  return {
    maxAdrenalineRush, adrenalineRushUses: Math.min(maxAdrenalineRush, state.adrenalineRushUses ?? maxAdrenalineRush),
    maxBreathWeapon, breathWeaponUses: Math.min(maxBreathWeapon, state.breathWeaponUses ?? maxBreathWeapon),
    breathWeaponDamage: maxBreathWeapon ? (c.level >= 17 ? 4 : c.level >= 11 ? 3 : c.level >= 5 ? 2 : 1) : 0,
    breathWeaponType: dragonborn?.damageType ?? null, draconicFlightAvailable: Boolean(maxFlight && state.draconicFlightAvailable !== false),
    goliathAncestry, giantAncestry: goliathAncestry, maxGiantAncestry, giantAncestryUses: Math.min(maxGiantAncestry, state.giantAncestryUses ?? maxGiantAncestry),
    largeFormAvailable: Boolean(maxLargeForm && state.largeFormAvailable !== false),
    tieflingLegacy, tieflingLegacyUses: tieflingLegacy ? Object.fromEntries(tieflingLegacy.spells.filter((spell, index) => index > 0 && (c.level >= (index === 1 ? 3 : 5))).map(spell => [spell, state.tieflingLegacyUses?.[spell] !== true])) : {},
    relentlessEnduranceAvailable: c?.species === 'Ork (Orc)' && state.relentlessEnduranceAvailable !== false,
    heroicInspirationAvailable: human ? state.heroicInspirationAvailable !== false : false,
  };
};
export const secondWindMaximum = character => character.class?.includes('Fighter')
  ? character.level >= 10 ? 4 : character.level >= 4 ? 3 : 2
  : 0;
export function saveResources(db, id, state) {
  state.version++;
  db.prepare(`INSERT INTO character_spell_resources (character_id, data) VALUES (?, ?)
    ON CONFLICT(character_id) DO UPDATE SET data = excluded.data`).run(id, JSON.stringify(state));
}
export function casterData(db, id) {
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id);
  const stats = row ? JSON.parse(row.data) : emptyStatistics();
  const profile = spellcastingProfile(character, stats.spells, stats.traits);
  const error = validateSpellSelection(character, stats.spells);
  const ids = new Set(profile.automatic.map(s => s.id));
  for (const group of profile.groups.filter(g => g.id !== 'book')) for (const id of stats.spells.selections[group.id] ?? []) if (group.options.some(s => s.id === id)) ids.add(id);
  const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength, a.stealth_disadvantage AS stealthDisadvantage FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(id);
  const state = resourceState(db, id), s = statisticsSummary(character, stats, equipment);
  const slots = profile.pactSlotLevel ? [] : profile.slots.map((total, i) => ({ level: i + 1, total, remaining: Math.max(0, total - (state.spent[i] ?? 0)), source: 'slot' })).filter(s => s.total);
  if (profile.pactSlotLevel) slots.push({ level: profile.pactSlotLevel, total: profile.slots[0], remaining: Math.max(0, profile.slots[0] - state.pactSpent), source: 'pact' });
  const originGrants = originSpellGrants(selectedOriginFeats(character, stats.traits), stats.traits);
  const spells = [...ids].map(id => spellById.get(id)).filter(Boolean).map(spell => {
    const arcanum = profile.groups.find(g => g.id.startsWith('arcanum') && stats.spells.selections[g.id]?.includes(spell.id));
    const origin = originGrants.find(g => g.id === spell.id);
    return { ...spell, ritualOnly: profile.automatic.find(s => s.id === spell.id)?.ritualOnly === true, originAbility: origin?.ability, originFreeCast: originGrants.some(g => g.id === spell.id && g.freeCast && !state.originSpellUses?.[g.reason]), action: spellAction(spell), effect: spellEffects[spell.id] ?? null, arcanum: Boolean(arcanum), arcanumRemaining: arcanum ? !state.arcanum[spell.id] : false };
  });
  const species = speciesResourceState(db, id, character);
  return { character, stats, profile, state, blocked: s.spellcastingBlocked, ability: s.abilities[profile.ability]?.modifier ?? null, attack: s.spellAttack, dc: s.spellDc, slots, spells, species, error };
}
export function publicCaster(db, id) {
  const c = casterData(db, id);
  return { warlock: warlockProfile(c.character, c.stats.values.cha, c.state), psiWarrior: psiResources(c.character, c.state), paladin: { ...paladinResources(c.character, c.state), channelDivinityDc: c.dc }, druid: { ...druidProfile(c.character), uses: Math.min(druidProfile(c.character).max, c.state.wildShapeUses ?? druidProfile(c.character).max), forms: c.stats.traits?.druidForms ?? [], wildShape: c.state.wildShape?.expiresAt > Date.now() ? c.state.wildShape : null, companion: c.state.wildCompanion ?? null }, slots: c.slots, spells: c.spells, ability: c.ability, attack: c.attack, dc: c.dc, error: c.error, species: c.species, barbarian: { ...rageProfile(c.character), uses: Math.min(rageProfile(c.character).max, c.state.rageUses ?? rageProfile(c.character).max), relentlessDC: c.state.relentlessRageDC ?? 10, recoveryAvailable: c.state.persistentRageAvailable !== false }, resourceVersion: c.state.version };
}
export function spendSpell(db, id, spellId, level, source) {
  const c = casterData(db, id), spell = c.spells.find(s => s.id === spellId);
  if (c.error || !spell) throw new Error(c.error || 'Ten czar nie jest przygotowany ani dostępny dla postaci.');
  if (spell.ritualOnly) throw new Error('Animal Speaker: this spell can only be cast as a ritual outside combat.');
  if (!spell.action) throw new Error('Ten czar wymaga dłuższego czasu rzucania; rozstrzyga go GM.');
  const free = c.species?.tieflingLegacyUses?.[spellId] === true;
  if (free) {
    c.state.tieflingLegacyUses ??= {};
    c.state.tieflingLegacyUses[spellId] = true;
    saveResources(db, id, c.state);
  } else if (spell.originFreeCast && source === 'origin') {
    if (level !== spell.level) throw new Error('Bezpłatny czar atutu używa swojego podstawowego kręgu.');
    const grant = originSpellGrants(selectedOriginFeats(c.character, c.stats.traits), c.stats.traits).find(g => g.id === spellId && g.freeCast && !c.state.originSpellUses?.[g.reason]);
    c.state.originSpellUses ??= {};
    c.state.originSpellUses[grant.reason] = true;
    saveResources(db, id, c.state);
  } else if (source === 'paladin-smite') {
    if (spellId !== 'divine-smite' || level !== 1 || !paladinResources(c.character, c.state).smiteAvailable) throw new Error('Paladin Smite unavailable.');
    c.state.paladinSmiteUsed = true; saveResources(db, id, c.state);
  } else if (spell.level === 0) {
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
  const originMod = ['int', 'wis', 'cha'].includes(spell.originAbility) ? c.stats.values?.[spell.originAbility] : null;
  const modifier = originMod == null ? null : Math.floor((originMod - 10) / 2);
  return { ...c, ...(modifier === null ? {} : { ability: modifier, attack: modifier + proficiencyBonus(c.character.level) + (c.stats.values.spellBonus ?? 0), dc: 8 + modifier + proficiencyBonus(c.character.level) + (c.stats.values.spellDcBonus ?? 0) }), spell };
}
export function handleSpellResources(db, user, path, method, body, send) {
  const own = path.match(/^\/api\/characters\/([1-9]\d*)\/spell-resources$/);
  const rest = path.match(/^\/api\/games\/([1-9]\d*)\/spell-rest$/);
  if (!own && !rest) return false;
  const reply = (status, data) => { send(status, data); return true; };
  if (own) {
    const id = Number(own[1]);
    if (!db.prepare('SELECT 1 FROM characters WHERE id = ? AND user_id = ?').get(id, user.id)) return reply(404, { error: 'Nie znaleziono postaci.' });
    if (method === 'POST' && ['dark-ones-own-luck', 'magical-cunning', 'contact-patron', 'fiendish-resilience', 'clairvoyant-recover', 'awakened-mind'].includes(body.kind)) {
      const state = resourceState(db, id);
      if (body.version !== state.version) return reply(409, { error: 'Zasoby zmieniły się. Odśwież kartę postaci.' });
      const battles = db.prepare('SELECT data FROM session_battles').all();
      if (battles.some(row => { const b = JSON.parse(row.data); return b.active && b.fighters.some(f => f.characterId === id); })) return reply(409, { error: 'W trakcie walki użyj kontrolek walki; obrzędy wykonuj poza walką.' });
      try { const result = useWarlockFeature(db, id, body); return reply(200, { spellcasting: publicCaster(db, id), ...result }); }
      catch (error) { return reply(409, { error: error.message }); }
    }
    if (method === 'POST' && body.kind === 'ritual') {
      const c = casterData(db, id), spell = c.spells.find(s => s.id === body.spellId && s.ritualOnly);
      if (c.error || !spell) return reply(409, { error: c.error || 'Ritual unavailable.' });
      const battles = db.prepare('SELECT data FROM session_battles').all();
      if (battles.some(row => { const b = JSON.parse(row.data); return b.active && b.fighters.some(f => f.characterId === id); })) return reply(409, { error: 'Complete rituals outside combat.' });
      if (c.blocked) return reply(409, { error: 'Spellcasting is blocked.' });
      if (spell.description?.includes('Concentration') || spell.id === 'beast-sense') {
        c.state.concentration = spell.name; saveResources(db, id, c.state);
      }
      return reply(200, { spellcasting: publicCaster(db, id), ritual: { spellId: spell.id, ability: 'wis', additionalMinutes: 10, castingTime: spell.castingTime, resolution: 'GM confirms casting time, components, targets and effects.' } });
    }
    if (method !== 'GET') return reply(405, { error: 'Niedozwolona metoda.' });
    return reply(200, { spellcasting: publicCaster(db, id), species: speciesResourceState(db, id) });
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
    const character = db.prepare('SELECT class, subclass, level, species FROM characters WHERE id = ?').get(id);
    const state = resourceState(db, id);
    restWarlock(state, body.rest);
    restPaladin(character, state, body.rest);
    restPsi(character, state, body.rest);
    const maxSecondWind = secondWindMaximum(character);
    if (maxSecondWind && character.level >= 2) state.actionSurgeUses = 1;
    const druid = druidProfile(character);
    if (druid.max) state.wildShapeUses = body.rest === 'long' ? druid.max : Math.min(druid.max, (state.wildShapeUses ?? druid.max) + 1);
    if (body.rest === 'long') { state.wildShape = null; state.wildCompanion = null; }
    const rage = rageProfile(character);
    state.rageUses = body.rest === 'long' ? rage.max : Math.min(rage.max, (state.rageUses ?? rage.max) + 1);
    state.relentlessRageDC = 10;
    if (body.rest === 'long') state.persistentRageAvailable = true;
    if (body.rest === 'long') {
      state.spent = Array(9).fill(0); state.arcanum = {}; state.concentration = null; state.secondWindUses = maxSecondWind;
      const maxAdrenalineRush = character.species === 'Ork (Orc)' ? proficiencyBonus(character.level) : 0;
      const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id);
      const stats = row ? JSON.parse(row.data) : emptyStatistics();
      const dragonborn = character.species === 'Smokowiec (Dragonborn)' && dragonbornAncestryProfile(stats.traits?.dragonbornAncestry?.[0]);
      state.adrenalineRushUses = maxAdrenalineRush;
      state.breathWeaponUses = dragonborn ? proficiencyBonus(character.level) : 0;
      const goliath = character.species === 'Goliat (Goliath)' && goliathAncestryProfile(stats.traits?.giantAncestry?.[0]);
      state.giantAncestryUses = goliath ? proficiencyBonus(character.level) : 0;
      state.largeFormAvailable = true;
      state.tieflingLegacyUses = {};
      state.originSpellUses = {};
      state.layOnHandsSpent = 0; state.paladinSmiteUsed = false;
      state.draconicFlightAvailable = true;
      state.relentlessEnduranceAvailable = true; state.lastLongRest = Date.now();
      if (character.species === 'Człowiek (Human)') state.heroicInspirationAvailable = true;
    } else if (maxSecondWind) state.secondWindUses = Math.min(maxSecondWind, (state.secondWindUses ?? maxSecondWind) + 1);
    state.pactSpent = 0; state.lastRest = Date.now(); saveResources(db, id, state);
  }
  return reply(200, { restored: characters.length });
}
