import { selectedFightingStyles, wizardCantrips } from '../shared/fighting-style.mjs';
import { fighterProfile } from './fighter.mjs';
import { advanceWildShape, convertDruidResources, druidConversionKinds, restDruid, validateNaturalRecovery, wildShapeUses } from './druid.mjs';
import { clericResources, divineIntervention, restCleric } from './cleric.mjs';
import { activeInspiration, bardResources, isBard, recoverInspiration } from './bard.mjs';
import { advanceSpeciesTime } from './species.mjs';
import { speciesOutside } from './species-outside.mjs';
import { characterZoneConditions } from './spell-zones.mjs';
import { endProtectiveSpell } from './protective-spells.mjs';
import { timedSpeedMultiplier, timedFlySpeed, timedSize, timedDarkvision } from '../shared/timed-effects.mjs';
import { spellClimbSpeed } from './spell-conditions.mjs';
import { conditionsOf, conditionSpeedZero, isIncapacitated } from '../shared/conditions.mjs';
import { restWarlock, useWarlockFeature } from './warlock-features.mjs';
import { psiResources, restPsi } from './psi-warrior.mjs';
import { paladinResources, restPaladin } from './paladin.mjs';
import { canCastInWildShape, druidCantripRange, druidProfile, druidForms, isDruid, isLandDruid, isMoonDruid, landWard } from '../shared/druid.mjs';
import { warlockProfile } from '../shared/warlock.mjs';
import { rageProfile } from '../shared/barbarian.mjs';
import { selectedOriginFeats, originSpellGrants } from '../shared/origin-feats.mjs';
import { spellcastingProfile, spellById, validateSpellSelection } from '../shared/spellcasting.mjs';
import { spellEffects, spellAction } from '../shared/combat-spells.mjs';
import { statisticsSummary } from './statistics-summary.mjs';
import { defensiveEquipment } from './armor-class.mjs';
import { emptyStatistics } from './statistics.mjs';
import { characterTraits, dragonbornAncestryProfile, goliathAncestryProfile, tieflingLegacyProfile } from '../shared/character-traits.mjs';
import { advanceEffectTime, characterTimedEffects, applyTimedEffect, dismissTimedEffect } from './timed-effects.mjs';
import { timedAc, timedHpBonus, timedSpeedBonus, timedSpellDefinitions } from '../shared/timed-effects.mjs';
import { endConcentration, startConcentration } from './concentration.mjs';
import { randomUUID } from 'node:crypto';

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
    name: c?.species ?? '', level: c?.level ?? 1,
    effects: Object.fromEntries(Object.entries(state.speciesEffects ?? {}).filter(([key, e]) => e.expiresAt > Date.now())),
    healingHandsAvailable: c?.species === 'Aasimar' && !state.healingHandsUsed,
    revelationAvailable: c?.species === 'Aasimar' && c.level >= 3 && !state.revelationUsed,
    stonecunningRemaining: c?.species === 'Krasnolud (Dwarf)' ? Math.max(0, proficiencyBonus(c.level) - (state.stonecunningUses ?? 0)) : 0,
    gnomeDevices: (state.gnomeDevices ?? []).filter(d => d.expiresAt > Date.now()),
    rockGnome: c?.species === 'Gnom (Gnome)' && stats.traits?.gnomeLineage?.[0] === 'rock',
    maxAdrenalineRush, adrenalineRushUses: Math.min(maxAdrenalineRush, state.adrenalineRushUses ?? maxAdrenalineRush),
    maxBreathWeapon, breathWeaponUses: Math.min(maxBreathWeapon, state.breathWeaponUses ?? maxBreathWeapon),
    breathWeaponDamage: maxBreathWeapon ? (c.level >= 17 ? 4 : c.level >= 11 ? 3 : c.level >= 5 ? 2 : 1) : 0,
    breathWeaponType: dragonborn?.damageType ?? null, draconicFlightAvailable: Boolean(maxFlight && state.draconicFlightAvailable !== false),
    goliathAncestry, giantAncestry: goliathAncestry, maxGiantAncestry, giantAncestryUses: Math.min(maxGiantAncestry, state.giantAncestryUses ?? maxGiantAncestry),
    largeFormAvailable: Boolean(maxLargeForm && state.largeFormAvailable !== false),
    tieflingLegacy, tieflingLegacyUses: tieflingLegacy ? Object.fromEntries(tieflingLegacy.spells.filter((spell, index) => index > 0 && (c.level >= (index === 1 ? 3 : 5))).map(spell => [spell, state.tieflingLegacyUses?.[spell] !== true])) : {},
    relentlessEnduranceAvailable: c?.species === 'Ork (Orc)' && state.relentlessEnduranceAvailable !== false,
    heroicInspirationAvailable: state.heroicInspirationAvailable ?? human,
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
  characterTimedEffects(db, id);
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id);
  const stats = row ? JSON.parse(row.data) : emptyStatistics();
  const profile = spellcastingProfile(character, stats.spells, stats.traits);
  const error = validateSpellSelection(character, stats.spells);
  const arcaneWarrior = selectedFightingStyles(stats.choices).includes('arcane-warrior') ? stats.choices.arcaneWarrior : null;
  const validArcaneAbility = ['int', 'wis', 'cha'].includes(arcaneWarrior?.ability);
  const ids = new Set(profile.automatic.map(s => s.id));
  for (const group of profile.groups.filter(g => g.id !== 'book')) for (const id of stats.spells.selections[group.id] ?? []) if (group.options.some(s => s.id === id)) ids.add(id);
  const arcaneCantrips = new Set(validArcaneAbility ?
    (arcaneWarrior.cantrips ?? []).filter(id => !ids.has(id) && wizardCantrips.some(spell => spell.id === id)) : []);
  for (const id of arcaneCantrips) ids.add(id);
  const bookRituals = new Set();
  for (const id of stats.spells.selections.book ?? []) {
    if (!ids.has(id) && profile.groups.find(g => g.id === 'book')?.options.some(s => s.id === id && /\bor Ritual\b/i.test(s.castingTime))) { bookRituals.add(id); ids.add(id); }
  }
  const equipment = defensiveEquipment(db, id);
  const state = resourceState(db, id), s = statisticsSummary(character, stats, equipment);
  const slots = profile.pactSlotLevel ? [] : profile.slots.map((base, i) => base + (isDruid(character) ? state.druidCreatedSlots?.[i + 1] ?? 0 : 0)).map((total, i) => ({ level: i + 1, total, remaining: Math.max(0, total - (state.spent[i] ?? 0)), source: 'slot' })).filter(s => s.total);
  if (profile.pactSlotLevel) slots.push({ level: profile.pactSlotLevel, total: profile.slots[0], remaining: Math.max(0, profile.slots[0] - state.pactSpent), source: 'pact' });
  const originGrants = originSpellGrants(selectedOriginFeats(character, stats.traits), stats.traits);
  const species = speciesResourceState(db, id, character);
  const spells = [...ids].map(id => spellById.get(id)).filter(Boolean).map(spell => {
    const arcanum = profile.groups.find(g => g.id.startsWith('arcanum') && stats.spells.selections[g.id]?.includes(spell.id));
    const origin = originGrants.find(g => g.id === spell.id);
    const automatic = profile.automatic.find(s => s.id === spell.id);
    if (automatic?.speciesFreeMaximum) species.tieflingLegacyUses[spell.id] = (state.speciesSpellUses?.[spell.id] ?? 0) < automatic.speciesFreeMaximum;
    const spellcastingAbility = arcaneCantrips.has(spell.id) ? arcaneWarrior.ability : automatic?.spellcastingAbility ?? origin?.ability ?? profile.ability;
    const modifier = s.abilities[spellcastingAbility]?.modifier ?? null;
    const druidCantrip = isDruid(character) && spell.level === 0 && (spell.classes.includes('druid') && stats.spells.selections.cantrips?.includes(spell.id) || automatic?.reason === character.subclass);
    return { ...spell, ...(druidCantrip ? { range: druidCantripRange(character, spell, stats.spells.choices), druidCantrip } : {}), speciesFreeRemaining: automatic?.speciesFreeMaximum ? Math.max(0, automatic.speciesFreeMaximum - (state.speciesSpellUses?.[spell.id] ?? 0)) : undefined, speciesFreeMaximum: automatic?.speciesFreeMaximum, legacySpell: Object.hasOwn(species.tieflingLegacyUses, spell.id), legacyFreeCast: species.tieflingLegacyUses[spell.id] === true, spellcastingAbility, ability: modifier, attack: modifier === null ? null : modifier + proficiencyBonus(character.level) + (stats.values.spellBonus ?? 0), dc: modifier === null ? null : 8 + modifier + proficiencyBonus(character.level) + (stats.values.spellDcBonus ?? 0), ritualOnly: automatic?.ritualOnly === true || bookRituals.has(spell.id), originAbility: origin?.ability, originFreeCast: originGrants.some(g => g.id === spell.id && g.freeCast && !state.originSpellUses?.[g.reason]), action: spellAction(spell), effect: spellEffects[spell.id] ?? null, arcanum: Boolean(arcanum), arcanumRemaining: arcanum ? !state.arcanum[spell.id] : false };
  });
  return { character, stats, profile, state, equipment, blocked: s.spellcastingBlocked && !(state.wildShape?.expiresAt > Date.now()), ability: s.abilities[profile.ability]?.modifier ?? null, attack: s.spellAttack, dc: s.spellDc, slots, spells, species, error };
}
export function publicCaster(db, id) {
  const c = casterData(db, id);
  const summary = statisticsSummary(c.character, c.stats, c.equipment);
  const timedEffects = c.state.activeEffects ?? [];
  const speciesEffects = c.species.effects;
  const conditionSubject = { poisonConditionImmune: Boolean(landWard(c.character, c.stats.spells.choices)), speciesEffects, zoneConditions: characterZoneConditions(db, id), hp: summary.hp, conditionSources: c.state.conditionSources, exhaustion: c.state.exhaustion, manualConditions: c.state.manualConditions, timedEffects, prone: c.state.prone };
  if (isIncapacitated(conditionSubject)) delete speciesEffects.flight;
  const conditions = [...conditionsOf(conditionSubject)];
  const form = c.state.wildShape?.expiresAt > Date.now() ? druidForms.find(f => f.id === c.state.wildShape.formId) : null;
  const traits = characterTraits(c.character, c.stats);
  const walk = form?.speed ?? summary.speed;
  const baseAc = form && isMoonDruid(c.character) ? Math.max(form.ac, 13 + (summary.abilities.wis.modifier ?? 0)) : form?.ac ?? summary.ac;
  const effectiveStats = {
    hp: summary.hp,
    maxHp: summary.maxHp == null ? null : summary.maxHp + timedHpBonus(timedEffects),
    ac: timedAc({ ac: baseAc, timedEffects, dexModifier: form ? Math.floor((form.dex - 10) / 2) : summary.abilities.dex.modifier,
      wearingArmor: !form && c.equipment.some(i => i.equipped && i.armorCategory && i.armorCategory !== 'shield'),
      equipmentShieldBonus: form || summary.untrainedShield ? 0 : Number.parseInt(c.equipment.find(i => i.equipped && i.armorCategory === 'shield')?.armorClass ?? '0', 10) || 0,
      equipmentAcBonus: form ? 0 : summary.equipmentAcBonus }),
    speed: conditionSpeedZero(conditionSubject) ? 0 : walk == null ? null : Math.floor(Math.max(0, walk + timedSpeedBonus(conditionSubject) - 5 * (c.state.exhaustion ?? 0)) * timedSpeedMultiplier(conditionSubject)),
  };
  const flight = timedFlySpeed({ ...conditionSubject, speed: walk ?? 0, flySpeed: form?.fly ?? 0 });
  effectiveStats.flySpeed = conditionSpeedZero(conditionSubject) || !flight ? 0 : Math.floor(Math.max(0, flight + timedSpeedBonus(conditionSubject) - 5 * (c.state.exhaustion ?? 0)) * timedSpeedMultiplier(conditionSubject));
  effectiveStats.tremorsense = speciesEffects.stonecunning ? 60 : 0;
  effectiveStats.size = timedSize({ size: form?.size ?? traits.size, timedEffects, speciesEffects });
  effectiveStats.darkvision = timedDarkvision({ darkvision: form ? form.darkvision ?? 0 : traits.darkvision, timedEffects });
  effectiveStats.swimSpeed = spellClimbSpeed({ ...conditionSubject, speed: walk ?? 0, climbSpeed: form ? form.swim ?? 0 : traits.swimSpeed == null ? 0 : walk ?? 0 });
  effectiveStats.climbSpeed = spellClimbSpeed({ ...conditionSubject, speed: form?.speed ?? summary.speed ?? 0, climbSpeed: form?.climb ?? (traits.climbSpeed == null ? 0 : summary.speed ?? 0) });
  return { conditions, effectiveStats, fighter: fighterProfile(c.character, c.state), cleric: clericResources(c.character, c.state, c.stats.spells.choices), bard: bardResources(c.character, c.ability, c.state), bardicInspiration: activeInspiration(c.state), activeEffects: c.state.activeEffects ?? [], concentration: c.state.concentration ?? null, warlock: warlockProfile(c.character, c.stats.values.cha, c.state), psiWarrior: psiResources(c.character, c.state), paladin: { ...paladinResources(c.character, c.state), channelDivinityDc: c.dc }, druid: { ...druidProfile(c.character), uses: wildShapeUses(c.character, c.state), wildResurgenceSlotAvailable: isDruid(c.character) && c.character.level >= 5 && !c.state.wildResurgenceSlotUsed, natureMagicianAvailable: druidProfile(c.character).archdruid && !c.state.natureMagicianUsed, naturalRecoveryCastAvailable: isLandDruid(c.character) && c.character.level >= 6 && !c.state.naturalRecoveryCastUsed, naturalRecoverySlotsAvailable: isLandDruid(c.character) && c.character.level >= 6 && !c.state.naturalRecoverySlotsUsed, moonlightStepRemaining: isMoonDruid(c.character) && c.character.level >= 10 ? Math.max(0, Math.max(1, c.ability ?? 0) - (c.state.moonlightStepSpent ?? 0)) : 0, forms: c.stats.traits?.druidForms ?? [], wildShape: c.state.wildShape?.expiresAt > Date.now() ? c.state.wildShape : null, companion: c.state.wildCompanion ?? null }, slots: c.slots, spells: c.spells, ability: c.ability, attack: c.attack, dc: c.dc, error: c.error, species: c.species, barbarian: { ...rageProfile(c.character), uses: Math.min(rageProfile(c.character).max, c.state.rageUses ?? rageProfile(c.character).max), relentlessDC: c.state.relentlessRageDC ?? 10, recoveryAvailable: c.state.persistentRageAvailable !== false }, resourceVersion: c.state.version };
}
export function spendSpell(db, id, spellId, level, source, options = {}) {
  const c = casterData(db, id);
  if (source === 'divine-intervention') {
    const original = spellById.get(spellId);
    divineIntervention(c.character, c.state, original, level, options.interventionRolls);
    const spell = { ...original, components: original.components.split(',').map(part => part.trim()).filter(part => part !== 'M').join(', '), action: 'action', effect: spellEffects[spellId] ?? null };
    saveResources(db, id, c.state);
    return { ...c, spell };
  }
  const spell = c.spells.find(s => s.id === spellId);
  if (c.state.wildShape?.expiresAt > Date.now() && !canCastInWildShape(c.character, spell)) throw new Error('This spell cannot be cast in Wild Shape.');
  if (c.error || !spell) throw new Error(c.error || 'Ten czar nie jest przygotowany ani dostępny dla postaci.');
  if (spell.ritualOnly && !options.ritual) throw new Error('Ten czar jest dostępny wyłącznie jako rytuał poza walką.');
  if (!spell.action && !options.outsideCombat) throw new Error('Ten czar wymaga dłuższego czasu rzucania; rozstrzyga go GM.');
  if (source === 'ritual') {
    if (!options.outsideCombat || !options.ritual || !(spell.ritualOnly || /\bor Ritual\b/i.test(spell.castingTime)) || level !== spell.level) throw new Error('Rytuał jest niedostępny albo ma niepoprawny krąg.');
  } else if (source === 'legacy') {
    if (!spell.legacyFreeCast || level !== spell.level) throw new Error('Czar gatunku: brak bezpłatnego użycia lub niepoprawny krąg czaru.');
    const speciesGrant = c.profile.automatic.find(s => s.id === spellId && s.speciesFreeMaximum);
    if (speciesGrant) {
      c.state.speciesSpellUses ??= {};
      c.state.speciesSpellUses[spellId] = (c.state.speciesSpellUses[spellId] ?? 0) + 1;
    } else {
      c.state.tieflingLegacyUses ??= {};
      c.state.tieflingLegacyUses[spellId] = true;
    }
    saveResources(db, id, c.state);
  } else if (spell.originFreeCast && source === 'origin') {
    if (level !== spell.level) throw new Error('Bezpłatny czar atutu używa swojego podstawowego kręgu.');
    const grant = originSpellGrants(selectedOriginFeats(c.character, c.stats.traits), c.stats.traits).find(g => g.id === spellId && g.freeCast && !c.state.originSpellUses?.[g.reason]);
    c.state.originSpellUses ??= {};
    c.state.originSpellUses[grant.reason] = true;
    saveResources(db, id, c.state);
  } else if (source === 'natural-recovery') {
    const grant = c.profile.automatic.find(grant => grant.id === spellId && grant.reason === 'Circle of the Land');
    if (!isLandDruid(c.character) || c.character.level < 6 || c.state.naturalRecoveryCastUsed || !grant || spell.level < 1 || level !== spell.level)
      throw new Error('Natural Recovery requires a prepared Circle Spell at its base level and an available use.');
    c.state.naturalRecoveryCastUsed = true;
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
  return { ...c, ability: spell.ability, attack: spell.attack, dc: spell.dc, spell };
}
export function handleSpellResources(db, user, path, method, body, send) {
  const own = path.match(/^\/api\/characters\/([1-9]\d*)\/spell-resources$/);
  const rest = path.match(/^\/api\/games\/([1-9]\d*)\/spell-rest$/);
  if (!own && !rest) return false;
  const reply = (status, data) => { send(status, data); return true; };
  if (own) {
    const id = Number(own[1]);
    if (!db.prepare('SELECT 1 FROM characters WHERE id = ? AND user_id = ?').get(id, user.id)) return reply(404, { error: 'Nie znaleziono postaci.' });
    if (method === 'POST' && druidConversionKinds.includes(body.kind)) {
      db.exec('SAVEPOINT druid_conversion');
      try {
        const c = casterData(db, id);
        if (body.version !== c.state.version) throw new Error('Refresh the character resources.');
        const inBattle = db.prepare('SELECT data FROM session_battles').all().some(row => {
          const battle = JSON.parse(row.data);
          return battle.active && battle.fighters.some(f => f.characterId === id);
        });
        if (inBattle) throw new Error('Use the battle action during combat.');
        convertDruidResources(db, c, body);
        const spellcasting = publicCaster(db, id);
        db.exec('RELEASE druid_conversion');
        return reply(200, { spellcasting });
      } catch (error) {
        db.exec('ROLLBACK TO druid_conversion; RELEASE druid_conversion');
        return reply(409, { error: error.message });
      }
    }
    if (method === 'POST' && body.kind === 'bard-font') {
      db.exec('SAVEPOINT bard_font');
      try {
        const c = casterData(db, id);
        if (body.version !== c.state.version) throw new Error('Zasoby zmieni?y si?. Od?wie? kart?.');
        if (db.prepare('SELECT data FROM session_battles').all().some(row => {
          const battle = JSON.parse(row.data);
          return battle.active && battle.fighters.some(f => f.characterId === id);
        })) throw new Error('W trakcie walki u?yj akcji walki.');
        recoverInspiration(c, body.level);
        saveResources(db, id, c.state);
        const spellcasting = publicCaster(db, id);
        db.exec('RELEASE bard_font');
        return reply(200, { spellcasting });
      } catch (error) {
        db.exec('ROLLBACK TO bard_font; RELEASE bard_font');
        return reply(409, { error: error.message });
      }
    }
    if (method === 'POST' && body.kind === 'species-outside') {
      db.exec('SAVEPOINT outside_species');
      try { speciesOutside(db, id, body); db.exec('RELEASE outside_species'); return reply(200, { spellcasting: publicCaster(db, id) }); }
      catch (error) { db.exec('ROLLBACK TO outside_species; RELEASE outside_species'); return reply(409, { error: error.message }); }
    }
    if (method === 'POST' && ['end-concentration', 'dismiss-effect'].includes(body.kind)) {
      const state = resourceState(db, id);
      if (body.version !== state.version) return reply(409, { error: 'Zasoby zmieniły się. Odśwież kartę.' });
      const battles = db.prepare('SELECT data FROM session_battles').all();
      if (battles.some(row => { const b = JSON.parse(row.data); return b.active && b.fighters.some(f => f.characterId === id); })) return reply(409, { error: 'W trakcie walki użyj jej kontrolek efektów.' });
      const source = { characterId: id };
      if (body.kind === 'end-concentration') endConcentration(db, source);
      else {
        if (typeof body.castingId !== 'string') return reply(400, { error: 'Wybierz aktywny czar.' });
        const caster = casterData(db, id), stats = caster.stats;
        if (!(stats.values.hp > 0) || isIncapacitated({ hp: stats.values.hp, manualConditions: caster.state.manualConditions, timedEffects: caster.state.activeEffects })) return reply(409, { error: 'Incapacitated uniemożliwia zakończenie tego czaru.' });
        if (dismissTimedEffect(db, { fighters: [] }, source, body.castingId) === false) return reply(409, { error: 'Tego skutku nie można dobrowolnie odwołać.' });
      }
      return reply(200, { spellcasting: publicCaster(db, id) });
    }
    if (method === 'POST' && body.kind === 'cast-outside-combat') {
      const state = resourceState(db, id);
      if (body.version !== state.version) return reply(409, { error: 'Zasoby zmieniły się. Odśwież kartę postaci.' });
      if (body.confirmed !== true) return reply(409, { error: 'Potwierdź z MG czas rzucania, komponenty, cel i wyzwalacz reakcji.' });
      const battles = db.prepare('SELECT data FROM session_battles').all();
      if (battles.some(row => { const b = JSON.parse(row.data); return b.active && b.fighters.some(f => f.characterId === id); })) return reply(409, { error: 'W trakcie walki użyj formularza walki.' });
      db.exec('SAVEPOINT outside_spell');
      try {
        const caster = casterData(db, id);
        if (caster.blocked || !(caster.stats.values.hp > 0) || isIncapacitated({ hp: caster.stats.values.hp, manualConditions: caster.state.manualConditions, timedEffects: caster.state.activeEffects })) throw new Error('Pancerz lub stan postaci blokuje czarowanie.');
        if (body.targetIds?.some(targetId => targetId !== id)) throw new Error('Poza walką automatyczne efekty dotyczą własnej postaci; inne cele rozstrzyga MG.');
        const cast = spendSpell(db, id, body.spellId, body.level, body.source, { outsideCombat: true, ritual: body.source === 'ritual', interventionRolls: body.interventionRolls });
        endProtectiveSpell(db, { characterId: id, timedEffects: cast.state.activeEffects ?? [] }, 'sanctuary');
        const source = { id: `character:${id}`, characterId: id, initiative: 0 };
        if (/Koncentracja|Concentration/i.test(cast.spell.duration)) startConcentration(db, source, cast.spell);
        else if (!cast.spell.action || body.source === 'ritual') endConcentration(db, source);
        const latest = resourceState(db, id);
        const record = { spellId: cast.spell.id, name: cast.spell.name, level: body.level, source: body.source, castAt: Date.now(), ritual: body.source === 'ritual', resolution: 'Efekty poza walką rozstrzyga MG na podstawie opisu czaru.' };
        latest.castHistory = [...(latest.castHistory ?? []), record].slice(-50);
        saveResources(db, id, latest);
        const definition = timedSpellDefinitions[cast.spell.id];
        if (definition && !definition.save && !definition.hostile) {
          if (definition.ward && cast.dc == null) throw new Error('Uzupełnij ST Sanctuary.');
          if (definition.mageArmor && (cast.stats.values.dex == null || cast.equipment.some(item => item.equipped && item.armorCategory && item.armorCategory !== 'shield'))) throw new Error('Mage Armor wymaga celu bez pancerza i znanego DEX.');
          applyTimedEffect(db, { round: 0, sessionId: null, startedAt: null }, source, source, cast.spell, body.level, randomUUID(), { effectChoice: body.effectChoice, dc: cast.dc });
          record.resolution = 'Aktywny efekt zastosowany do własnej postaci.';
        }
        db.exec('RELEASE outside_spell');
        return reply(200, { spellcasting: publicCaster(db, id), cast: record });
      } catch (error) {
        db.exec('ROLLBACK TO outside_spell; RELEASE outside_spell');
        return reply(409, { error: error.message });
      }
    }
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
  if (!['long', 'short', 'time'].includes(body.rest)) return reply(400, { error: 'Wybierz rodzaj odpoczynku.' });
  const fights = db.prepare(`SELECT b.data FROM session_battles b JOIN game_sessions s ON s.id = b.session_id WHERE s.game_id = ? AND s.ended_at IS NULL`).all(gameId);
  if (fights.some(row => JSON.parse(row.data).active)) return reply(409, { error: 'Odpoczynek nie jest dostępny w trakcie walki.' });
  const characters = db.prepare(`SELECT m.character_id FROM game_members m JOIN session_participants p ON p.member_id = m.id JOIN game_sessions s ON s.id = p.session_id
    WHERE m.game_id = ? AND m.status = 'accepted' AND s.ended_at IS NULL`).all(gameId);
  if (!characters.length) return reply(409, { error: 'Brak postaci w bieżącej sesji.' });
  const recovery = body.naturalRecovery;
  if (recovery != null) {
    if (body.rest !== 'short' || typeof recovery !== 'object' || Array.isArray(recovery))
      return reply(400, { error: 'Natural Recovery requires a Short Rest.' });
    for (const [id, levels] of Object.entries(recovery)) {
      const character = characters.some(c => String(c.character_id) === id) && db.prepare('SELECT class, level, subclass FROM characters WHERE id = ?').get(id);
      const row = character && db.prepare('SELECT data FROM character_spell_resources WHERE character_id = ?').get(id);
      if (!row || !validateNaturalRecovery(character, JSON.parse(row.data), levels)) return reply(409, { error: 'Invalid Natural Recovery slots.' });
    }
  }
  if (body.rest === 'time') {
    if (!Number.isInteger(body.seconds) || body.seconds < 1 || body.seconds > 31536000) return reply(400, { error: 'Podaj poprawny czas w sekundach.' });
    advanceEffectTime(db, characters.map(c => c.character_id), body.seconds);
    advanceSpeciesTime(db, characters.map(c => c.character_id), body.seconds);
    for (const { character_id: id } of characters) {
      const state = resourceState(db, id);
      const shapeChanged = advanceWildShape(state, body.seconds);
      if (!state.bardicInspiration) {
        if (shapeChanged) saveResources(db, id, state);
        continue;
      }
      state.bardicInspiration.expiresAt -= body.seconds * 1000;
      if (!activeInspiration(state)) delete state.bardicInspiration;
      saveResources(db, id, state);
    }
    return reply(200, { advanced: characters.length });
  }
  advanceEffectTime(db, characters.map(c => c.character_id), body.rest === 'long' ? 28800 : 3600);
  advanceSpeciesTime(db, characters.map(c => c.character_id), body.rest === 'long' ? 28800 : 3600);
  for (const { character_id: id } of characters) {
    const character = db.prepare('SELECT class, subclass, level, species FROM characters WHERE id = ?').get(id);
    const state = resourceState(db, id);
    if (isBard(character) && (body.rest === 'long' || character.level >= 5)) state.bardicSpent = 0;
    delete state.bardicInspiration;
    restWarlock(state, body.rest);
    restPaladin(character, state, body.rest);
    restCleric(character, state, body.rest);
    restPsi(character, state, body.rest);
    const maxSecondWind = secondWindMaximum(character);
    if (maxSecondWind) state.actionSurgeUses = fighterProfile(character).surgeMax;
    restDruid(character, state, body.rest);
    if (recovery?.[id]) {
      for (const level of recovery[id]) state.spent[level - 1]--;
      state.naturalRecoverySlotsUsed = true;
    }
    if (body.rest === 'long') { const vitals = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id)?.data ?? '{}').values; if ((vitals?.deathFailures ?? 0) < 3) state.exhaustion = Math.max(0, (state.exhaustion ?? 0) - 1); }
    const rage = rageProfile(character);
    state.rageUses = body.rest === 'long' ? rage.max : Math.min(rage.max, (state.rageUses ?? rage.max) + 1);
    state.relentlessRageDC = 10; state.epicFateUsed = false;
    if (character.species === 'Ork (Orc)') state.adrenalineRushUses = proficiencyBonus(character.level);
    if (body.rest === 'long') state.persistentRageAvailable = true;
    if (body.rest === 'long') {
      state.fighterIndomitableSpent = 0;
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
      state.speciesSpellUses = {};
      state.stonecunningUses = 0; state.healingHandsUsed = false; state.revelationUsed = false;
      state.speciesEffects = {};
      state.originSpellUses = {};
      state.zealotDiceSpent = 0; state.divineFormUsed = false; state.intimidatingUsed = false; state.zealousUsed = false;
      state.layOnHandsSpent = 0; state.paladinSmiteUsed = false;
      state.draconicFlightAvailable = true;
      state.relentlessEnduranceAvailable = true; state.lastLongRest = Date.now();
      if (character.species === 'Człowiek (Human)') state.heroicInspirationAvailable = true;
    } else if (maxSecondWind) state.secondWindUses = Math.min(maxSecondWind, (state.secondWindUses ?? maxSecondWind) + 1);
    state.pactSpent = 0; state.lastRest = Date.now(); saveResources(db, id, state);
  }
  return reply(200, { restored: characters.length });
}
