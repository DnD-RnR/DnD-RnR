import { randomUUID } from 'node:crypto';
import { healingBlocked } from './spell-conditions.mjs';
import { healTarget, validDice } from './cleric.mjs';
import { automaticSaveFailure, cannotHarm, isIncapacitated } from '../shared/conditions.mjs';
import { druidForms, druidProfile, isDruid, isMoonDruid, isLandDruid, landWard, eligibleDruidForms } from '../shared/druid.mjs';
import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { characterTraits } from '../shared/character-traits.mjs';
import definitions from '../shared/statistics.json' with { type: 'json' };
import { resourceState, saveResources, casterData } from './spell-resources.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };

export function druidChoiceUpdate(character, stats, stored, resources, explicitSpells, explicitTraits) {
  if (!isDruid(character)) return {};
  const old = stored?.druidProgression;
  const history = structuredClone(old ?? { level: character.level, rest: resources.lastLongRest ?? 0, cantripSwaps: 0, formSwaps: 0 });
  if (old && character.level < old.level) return { error: 'Druid: przywróć zapisany poziom przed zmianą wyborów.' };
  if (old && character.level > old.level) history.cantripSwaps += character.level - old.level;
  if (history.rest !== (resources.lastLongRest ?? 0)) { history.formSwaps = 1; history.rest = resources.lastLongRest ?? 0; }
  const previousSpells = old?.spells ?? stored?.spells;
  if (explicitSpells) {
    if (!['magic', 'martial'].includes(stats.spells.choices.order)) return { error: 'Druid: wybierz Primal Order.' };
    if (previousSpells?.choices?.order && previousSpells.choices.order !== stats.spells.choices.order) return { error: 'Primal Order jest stałym wyborem.' };
    if (previousSpells?.choices?.elementalFury && previousSpells.choices.elementalFury !== stats.spells.choices.elementalFury)
      return { error: 'Elemental Fury is a permanent choice.' };
    if (isLandDruid(character) && character.level >= 3) {
      const previousLand = previousSpells?.choices?.land;
      const currentLand = stats.spells.choices.land;
      if (previousLand && previousLand !== currentLand && (old?.landRest ?? old?.rest ?? resources.lastLongRest ?? 0) === (resources.lastLongRest ?? 0))
        return { error: 'Circle Spells terrain can change after a Long Rest.' };
      if (previousLand !== currentLand) history.landRest = resources.lastLongRest ?? 0;
    }
    const profile = spellcastingProfile(character, stats.spells, stats.traits);
    for (const id of ['cantrips', 'prepared']) {
      const selected = stats.spells.selections[id] ?? [];
      if (selected.length !== profile.groups.find(g => g.id === id).limit) return { error: `Druid: uzupełnij wybór ${id}.` };
      const previous = previousSpells?.selections?.[id] ?? [];
      const removed = previous.filter(s => !selected.includes(s) && !profile.automatic.some(spell => spell.id === s)).length;
      if (id === 'cantrips' && removed > history.cantripSwaps) return { error: 'Druid: możesz wymienić jedną sztuczkę na zdobyty poziom.' };
      if (id === 'prepared' && removed && (old?.preparedRest ?? old?.rest ?? resources.lastLongRest ?? 0) === (resources.lastLongRest ?? 0)) return { error: 'Druid: przygotowane czary zmieniasz po długim odpoczynku.' };
      if (id === 'prepared' && (removed || !previous.length)) history.preparedRest = resources.lastLongRest ?? 0;
      if (id === 'cantrips') history.cantripSwaps -= removed;
    }
    history.spells = structuredClone(stats.spells);
  }
  if (explicitTraits && character.level >= 2) {
    const forms = stats.traits.druidForms ?? [];
    const limit = druidProfile(character).knownForms;
    if (forms.length !== limit || new Set(forms).size !== limit || forms.some(id => !eligibleDruidForms(character).some(f => f.id === id))) return { error: `Wild Shape: select ${limit} different eligible Beast forms.` };
    const previous = old?.forms ?? stored?.traits?.druidForms ?? [];
    const removed = previous.filter(id => !forms.includes(id)).length;
    if (removed > history.formSwaps) return { error: 'Wild Shape: wymień najwyżej jedną formę po długim odpoczynku.' };
    history.formSwaps -= removed;
    history.forms = [...forms];
  }
  history.level = character.level;
  return { history };
}

export function endWildShape(f) {
  if (!f.wildShape) return;
  Object.assign(f, f.wildShape.original);
  f.wildShape = null;
}
export function applyWildShape(f, form, character, stats, shape) {
  endWildShape(f);
  const original = Object.fromEntries(['ac', 'speed', 'saves', 'attacks', 'maxAttacks', 'notes', 'formSkills', 'formAbilities', 'size', 'climbSpeed', 'flySpeed', 'swimSpeed', 'darkvision', 'wearingArmor', 'wearingAnyArmor', 'equipmentShieldBonus', 'dexModifier'].map(k => [k, f[k] ?? null]));
  const traits = characterTraits(character, stats), pb = 2 + Math.floor((character.level - 1) / 4);
  const mod = ability => Math.floor(((form[ability] ?? stats.values[ability]) - 10) / 2);
  const formAbilities = Object.fromEntries(definitions.abilities.map(a => [a.id, mod(a.id)]));
  f.saves = Object.fromEntries(definitions.abilities.map(a => [a.id, Math.max(mod(a.id) + (traits.effectiveSavingThrows.includes(a.id) || form.saves?.includes(a.id) ? pb : 0), mod(a.id) + (form.saves?.includes(a.id) ? 2 : 0))]));
  if (isMoonDruid(character) && character.level >= 6) f.saves.con += mod('wis');
  f.formSkills = Object.fromEntries(definitions.skills.map(s => [s.id, mod(s.ability) + Math.max(pb * Math.max(traits.effectiveSkills[s.id], form.skills?.[s.id] ? 1 : 0), 2 * (form.skills?.[s.id] ?? 0)) + (traits.skillBonuses[s.id] ?? 0)]));
  Object.assign(f, { ac: isMoonDruid(character) ? Math.max(form.ac, 13 + mod('wis')) : form.ac, speed: form.speed, maxAttacks: 1, size: form.size, climbSpeed: form.climb ?? 0, flySpeed: form.fly ?? 0, swimSpeed: form.swim ?? 0,
    wearingArmor: false, wearingAnyArmor: false, equipmentShieldBonus: 0, dexModifier: formAbilities.dex, darkvision: form.darkvision ?? 0, formAbilities,
    attacks: [{ ...form.attack, id: `beast:${form.id}`, ability: form.attack.ability ?? (['riding-horse', 'wolf', 'dire-wolf'].includes(form.id) ? 'str' : 'dex'), light: false, melee: true }], notes: form.notes ?? '',
    wildShape: { ...shape, original } });
}
export function syncWildShapes(db, b) {
  for (const f of b.fighters) if (f.wildShape && (Date.now() >= f.wildShape.expiresAt || isIncapacitated(f) || f.deathFailures >= 3)) {
    endWildShape(f);
    const state = resourceState(db, f.characterId); state.wildShape = null; saveResources(db, f.characterId, state);
  }
}
export function handleDruid({ db, b, body, canControl, activeMember, persistVitals, gm, log }) {
  if (body.kind === 'nature-sanctuary-members') {
    const zone = b.natureSanctuaries?.find(zone => zone.sourceId === body.actorId);
    check(gm && !b.pending && zone, 'The GM confirms which allies are inside Nature’s Sanctuary.');
    zone.members = sanctuaryMembers(b, body.targetIds);
    syncNatureSanctuary(b);
    return true;
  }
  if (!['wild-shape', 'wild-shape-end', 'wild-companion', 'lands-aid', 'moonlight-step', 'moonlight-step-recover', 'nature-sanctuary', 'nature-sanctuary-move', ...druidConversionKinds].includes(body.kind)) return false;
  const f = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(f?.characterId && activeMember(db, b.sessionId, f) && canControl(f), 'Nie możesz sterować tą postacią.');
  check(f.id === b.fighters[b.turn].id && !b.pending && !b.fighters.some(a => a.concentrationDC || a.relentlessRagePending), 'Wymagana własna tura bez oczekujących działań.');
  check(f.hp > 0 && !f.incapacitated && !f.unconscious, 'Postać nie może teraz działać.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(f.characterId);
  const profile = druidProfile(character);
  check(profile.max, 'Ta zdolność wymaga 2. poziomu druida.');
  const state = resourceState(db, f.characterId);
  const uses = wildShapeUses(character, state);
  if (druidConversionKinds.includes(body.kind)) {
    check(body.kind !== 'wild-resurgence-shape' || !f.wildResurgenceUsed, 'Wild Resurgence: odzyskano ju? przemian? w tej turze.');
    convertDruidResources(db, casterData(db, f.characterId), body);
    const updated = resourceState(db, f.characterId);
    f.wildShapeUses = wildShapeUses(character, updated);
    if (body.kind === 'wild-resurgence-shape') f.wildResurgenceUsed = true;
    log(b, `${f.name}: ${body.kind}.`);
    return true;
  }
  state.wildShapeUses = uses;
  if (body.kind === 'moonlight-step' || body.kind === 'moonlight-step-recover') {
    const caster = casterData(db, f.characterId);
    check(isMoonDruid(character) && character.level >= 10 && caster.ability != null, 'Moonlight Step requires Circle of the Moon level 10.');
    const max = Math.max(1, caster.ability);
    const spent = Math.min(max, state.moonlightStepSpent ?? 0);
    if (body.kind === 'moonlight-step-recover') {
      check(spent > 0 && caster.slots.some(slot => slot.source === 'slot' && slot.level === body.level && slot.level >= 2 && slot.remaining > 0),
        'Moonlight Step requires an expended use and a level 2+ slot.');
      state.spent[body.level - 1] = (state.spent[body.level - 1] ?? 0) + 1;
      state.moonlightStepSpent = spent - 1;
    } else {
      check(spent < max && !f.bonus && body.confirmed === true, 'Moonlight Step requires an available bonus action and a confirmed destination within 30 feet.');
      const companion = body.targetId == null ? null : b.fighters.find(target => target.id === body.targetId);
      check(body.targetId == null || character.level >= 14 && companion && companion.id !== f.id && companion.deathFailures < 3 && body.confirmedCompanion === true,
        'Shared Moonlight requires a willing companion and a confirmed destination.');
      state.moonlightStepSpent = spent + 1;
      f.moonlightStepAdvantage = true;
      f.bonus = 'Moonlight Step';
      log(b, `${f.name}: Moonlight Step${companion ? ` + ${companion.name}` : ''}.`);
    }
    saveResources(db, f.characterId, state);
    return true;
  }
  if (['nature-sanctuary', 'nature-sanctuary-move'].includes(body.kind)) {
    const ward = landWard(character, casterData(db, f.characterId).stats.spells.choices);
    const move = body.kind === 'nature-sanctuary-move';
    const previous = b.natureSanctuaries?.find(zone => zone.sourceId === f.id);
    check(ward && character.level >= 14 && body.confirmed === true && (move ? previous && !f.bonus : uses > 0 && !f.action),
      'Nature’s Sanctuary requires confirmed ground within range and the available action.');
    const members = sanctuaryMembers(b, body.targetIds);
    if (move) {
      previous.members = members;
      f.bonus = 'Move Nature’s Sanctuary';
    } else {
      b.natureSanctuaries = [...(b.natureSanctuaries ?? []).filter(zone => zone.sourceId !== f.id),
        { sourceId: f.id, resistance: ward.resistance, members, expiresRound: b.round + 10 }];
      f.wildShapeUses = state.wildShapeUses = uses - 1;
      state.wildShapeMax = profile.max;
      saveResources(db, f.characterId, state);
      f.action = 'Nature’s Sanctuary';
    }
    syncNatureSanctuary(b);
    log(b, `${f.name}: ${f[move ? 'bonus' : 'action']}.`);
    return true;
  }
  if (body.kind === 'lands-aid') {
    const caster = casterData(db, f.characterId);
    check(isLandDruid(character) && character.level >= 3 && uses > 0 && !f.action && body.confirmed === true,
      "Land's Aid requires an available Magic action, Wild Shape use and confirmed area.");
    const targets = Array.isArray(body.targetIds) ? body.targetIds.map(id => b.fighters.find(target => target.id === id)) : null;
    const heal = body.healTargetId == null ? null : b.fighters.find(target => target.id === body.healTargetId);
    const dice = character.level >= 14 ? 4 : character.level >= 10 ? 3 : 2;
    check(targets && (targets.length || heal) && new Set(body.targetIds).size === targets.length &&
      targets.every(target => target && target.deathFailures < 3 && !cannotHarm(f, target) &&
        (automaticSaveFailure(target, 'con') || target.saves?.con != null)) && (!targets.length || caster.dc != null) &&
      (body.healTargetId == null || heal && heal.deathFailures < 3 && !healingBlocked(heal) && validDice(body.healRolls, dice, 6)),
      "Land's Aid requires valid damage targets and, for healing, one target and the healing dice.");
    const healAmount = heal ? body.healRolls.reduce((total, roll) => total + roll, 0) : 0;
    if (targets.length) {
      b.pending = { kind: 'spell', actorId: f.id, castingId: randomUUID(), spellName: "Land's Aid", dc: caster.dc, stage: 'save',
        spec: { mode: 'save', save: 'con', half: true, dice, sides: 6, bonus: 0, type: 'Necrotic', landAidHealing: heal && { targetId: heal.id, amount: healAmount } },
        targets: targets.map(target => ({ id: target.id })) };
    } else healTarget(db, heal, healAmount, persistVitals);
    f.wildShapeUses = state.wildShapeUses = uses - 1;
    state.wildShapeMax = profile.max;
    saveResources(db, f.characterId, state);
    f.action = "Land's Aid";
    log(b, `${f.name}: Land's Aid.`);
    return true;
  }
  if (body.kind === 'wild-shape') check(!(b.spellZones ?? []).some(z => z.shapeLockedIds?.includes(f.id)), 'Moonbeam blokuje przemianę do opuszczenia cylindra.');
  if (body.kind === 'wild-companion') {
    check(!f.action && !f.wildShape && !f.rage, 'Wild Companion wymaga akcji Magic i możliwości rzucania czarów.');
    check(!casterData(db, f.characterId).blocked, 'Brak wyszkolenia w pancerzu blokuje rzucanie czarów.');
    check(typeof body.form === 'string' && ['bat', 'cat', 'crab', 'frog', 'hawk', 'lizard', 'octopus', 'owl', 'rat', 'raven', 'sea-horse', 'spider', 'weasel'].includes(body.form), 'Wybierz formę Find Familiar.');
    if (body.source === 'wild-shape') { check(uses > 0, 'Brak użyć Wild Shape.'); state.wildShapeUses = uses - 1; }
    else {
      check(body.source === 'slot' && Number.isInteger(body.level) && body.level >= 1 && body.level <= 9 && !(b.slotCasters ?? []).includes(f.id), 'Wybierz dostępne miejsce na czar.');
      const total = (spellcastingProfile(character).slots[body.level - 1] ?? 0) + (state.druidCreatedSlots?.[body.level] ?? 0);
      check(total > (state.spent[body.level - 1] ?? 0), 'Brak miejsca na czar.');
      state.spent[body.level - 1] = (state.spent[body.level - 1] ?? 0) + 1;
      b.slotCasters = [...(b.slotCasters ?? []), f.id];
    }
    state.wildCompanion = { form: body.form, creatureType: 'fey', materialComponents: false, summonedAt: Date.now() };
    f.wildCompanion = state.wildCompanion; f.action = 'Wild Companion';
  } else {
    check(!f.bonus, 'Akcja dodatkowa została wykorzystana.');
    if (body.kind === 'wild-shape-end') { check(f.wildShape, 'Wild Shape nie jest aktywne.'); endWildShape(f); state.wildShape = null; }
    else {
      check(uses > 0, 'Brak użyć Wild Shape.');
      const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(f.characterId).data);
      const form = druidForms.find(form => form.id === body.formId);
      check(form && eligibleDruidForms(character).some(f => f.id === form.id) && stats.traits?.druidForms?.includes(form.id), 'Nie znasz tej formy.');
      check(['merge', 'drop'].includes(body.equipment), 'Wybierz merge albo drop dla wyposażenia.');
      state.wildShape = { formId: form.id, equipment: body.equipment, expiresAt: Date.now() + profile.durationHours * 3600000 };
      applyWildShape(f, form, character, stats, state.wildShape);
      f.tempHp = Math.max(f.tempHp ?? 0, profile.temporaryHitPoints); state.wildShapeUses = uses - 1;
    }
    f.bonus = body.kind === 'wild-shape' ? 'Wild Shape' : 'Koniec Wild Shape';
    persistVitals(db, f);
  }
  state.wildShapeMax = profile.max;
  f.wildShapeUses = state.wildShapeUses ?? uses;
  saveResources(db, f.characterId, state);
  log(b, `${f.name}: ${body.kind}; Wild Shape ${f.wildShapeUses}/${profile.max}. ${f.notes ?? ''}`);
  return true;
}

export const druidConversionKinds = ['wild-resurgence-shape', 'wild-resurgence-slot', 'nature-magician'];

export function wildShapeUses(character, state) {
  const max = druidProfile(character).max;
  if (state.wildShapeUses == null) return max;
  const gained = Math.max(0, max - (state.wildShapeMax ?? max));
  return Math.max(0, Math.min(max, state.wildShapeUses + gained));
}

export function restoreEvergreen(character, state) {
  if (druidProfile(character).archdruid && wildShapeUses(character, state) === 0) {
    state.wildShapeUses = 1;
    state.wildShapeMax = druidProfile(character).max;
  }
}

export function advanceWildShape(state, seconds) {
  if (!state.wildShape) return false;
  state.wildShape.expiresAt -= seconds * 1000;
  if (state.wildShape.expiresAt <= Date.now()) state.wildShape = null;
  return true;
}

export function restDruid(character, state, rest) {
  const profile = druidProfile(character);
  if (!profile.max) return;
  state.wildShapeUses = rest === 'long' ? profile.max : Math.min(profile.max, wildShapeUses(character, state) + 1);
  state.wildShapeMax = profile.max;
  advanceWildShape(state, rest === 'long' ? 28800 : 3600);
  if (rest === 'long') {
    state.wildCompanion = null;
    state.druidCreatedSlots = {};
    state.wildResurgenceSlotUsed = false;
    state.natureMagicianUsed = false;
    state.moonlightStepSpent = 0;
    state.naturalRecoveryCastUsed = false;
    state.naturalRecoverySlotsUsed = false;
  }
}

export function convertDruidResources(db, caster, body) {
  const { character, state } = caster;
  check(isDruid(character) && character.level >= 5, 'Wild Resurgence requires Druid level 5.');
  const uses = wildShapeUses(character, state);
  let remaining;
  if (body.kind === 'wild-resurgence-shape') {
    check(uses === 0 && caster.slots.some(slot => slot.level === body.level && slot.source === 'slot' && slot.remaining > 0),
      'Wild Resurgence requires zero Wild Shape uses and an available spell slot.');
    state.spent[body.level - 1] = (state.spent[body.level - 1] ?? 0) + 1;
    remaining = 1;
  } else {
    const nature = body.kind === 'nature-magician';
    const count = nature ? body.uses : 1;
    const level = nature ? 2 * count : 1;
    const flag = nature ? 'natureMagicianUsed' : 'wildResurgenceSlotUsed';
    check((!nature || character.level >= 20) && !state[flag] && Number.isInteger(count) && count >= 1 && count <= uses && level <= 9,
      'Converting Wild Shape requires enough uses and an available feature.');
    state.druidCreatedSlots ??= {};
    state.druidCreatedSlots[level] = (state.druidCreatedSlots[level] ?? 0) + 1;
    state[flag] = true;
    remaining = uses - count;
  }
  state.wildShapeUses = remaining;
  state.wildShapeMax = druidProfile(character).max;
  saveResources(db, character.id, state);
}

export function validateNaturalRecovery(character, state, levels) {
  if (!isLandDruid(character) || character.level < 6 || state.naturalRecoverySlotsUsed ||
    !Array.isArray(levels) || !levels.length || levels.length > 10 ||
    !levels.every(level => Number.isInteger(level) && level >= 1 && level <= 5) ||
    levels.reduce((sum, level) => sum + level, 0) > Math.ceil(character.level / 2)) return false;
  return levels.every(level => levels.filter(other => other === level).length <= (state.spent[level - 1] ?? 0));
}

function sanctuaryMembers(b, ids) {
  check(Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => b.fighters.some(f => f.id === id)),
    'Select the allies inside the sanctuary.');
  return ids;
}

export function syncNatureSanctuary(b) {
  if (!b.natureSanctuaries?.length && !b.fighters.some(f => f.natureSanctuaryCover)) return;
  b.natureSanctuaries = (b.natureSanctuaries ?? []).filter(zone => {
    const source = b.fighters.find(f => f.id === zone.sourceId);
    return b.active && source && !isIncapacitated(source) && (b.round < zone.expiresRound ||
      b.round === zone.expiresRound && b.turn < b.fighters.indexOf(source));
  });
  for (const fighter of b.fighters) {
    const areas = b.natureSanctuaries.filter(zone => zone.members.includes(fighter.id));
    fighter.natureSanctuaryCover = areas.length > 0;
    fighter.natureSanctuaryResistances = areas.map(zone => zone.resistance).filter(Boolean);
  }
}
