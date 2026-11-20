import { randomUUID } from 'node:crypto';
import { resourceState, saveResources } from './spell-resources.mjs';
import { automaticSaveFailure, canSeeConditionTarget, isIncapacitated, cannotHarm } from '../shared/conditions.mjs';
import { healingBlocked } from './spell-conditions.mjs';

export const isCleric = c => c?.class === 'Kleryk (Cleric)';
const check = (ok, message) => { if (!ok) throw new Error(message); };
export const validDice = (rolls, count, sides) => Array.isArray(rolls) && rolls.length === count && rolls.every(n => Number.isInteger(n) && n >= 1 && n <= sides);
const sum = rolls => rolls.reduce((total, roll) => total + roll, 0);

export function clericResources(character, state, choices = {}) {
  if (!isCleric(character)) return null;
  const { level, subclass } = character;
  const channelMax = level >= 18 ? 4 : level >= 6 ? 3 : level >= 2 ? 2 : 0;
  return {
    channelMax, channelRemaining: Math.max(0, channelMax - (state.clericChannelSpent ?? 0)),
    sparkDice: level >= 18 ? 4 : level >= 13 ? 3 : level >= 7 ? 2 : level >= 2 ? 1 : 0,
    sear: level >= 5, preserveLife: level >= 3 && subclass === 'Life Domain',
    supremeHealing: level >= 17 && subclass === 'Life Domain',
    strikes: level >= 7 ? choices.blessedStrikes ?? null : null,
    interventionAvailable: level >= 10 && !(state.divineInterventionRests > 0),
    interventionRests: state.divineInterventionRests ?? 0,
    greaterIntervention: level >= 20,
  };
}

export function restCleric(character, state, rest) {
  if (!isCleric(character)) return;
  state.clericChannelSpent = rest === 'long' ? 0 : Math.max(0, (state.clericChannelSpent ?? 0) - 1);
  if (rest === 'long') state.divineInterventionRests = Math.max(0, (state.divineInterventionRests ?? 0) - 1);
}

export function divineIntervention(character, state, spell, level, rolls) {
  const profile = clericResources(character, state);
  const wish = spell?.id === 'wish';
  check(profile?.interventionAvailable && spell && spell.level === level &&
    (wish ? profile.greaterIntervention : level >= 1 && level <= 5 && spell.classes.includes('cleric') && !/^Reaction/i.test(spell.castingTime)),
    'Divine Intervention wymaga dostępnego użycia i właściwego zaklęcia.');
  check(!wish || validDice(rolls, 2, 4), 'Wish: podaj dwa wyniki k4 określające liczbę długich odpoczynków.');
  state.divineInterventionRests = wish ? sum(rolls) : 1;
}

export function healTarget(db, target, amount, persistVitals) {
  const restored = healingBlocked(target) || target.deathFailures >= 3 ? 0 : Math.max(0, Math.min(amount, target.maxHp - target.hp));
  if (restored > 0) {
    target.hp += restored;
    target.deathFailures = 0;
    target.deathSuccesses = 0;
    persistVitals(db, target);
  }
  return restored;
}

export function syncTurnUndead(b) {
  for (const target of b.fighters) {
    target.conditionSources = (target.conditionSources ?? []).filter(effect => {
      if (!effect.turnUndead) return true;
      const source = b.fighters.find(f => f.id === effect.sourceId);
      return b.active && source && !isIncapacitated(source) && (b.round < effect.expiresRound ||
        b.round === effect.expiresRound && b.turn < b.fighters.indexOf(source));
    });
  }
}

export function applyTurnUndead(b, source, target, frightenedImmune) {
  const expiresRound = b.round + 10;
  target.conditionSources ??= [];
  for (const kind of ['incapacitated', 'frightened']) {
    if (kind === 'frightened' && (frightenedImmune || target.rageProfile?.berserker && target.level >= 6 && target.rage)) continue;
    target.conditionSources.push({ id: randomUUID(), kind, sourceId: source.id, sourceName: source.name, turnUndead: true, expiresRound });
  }
}

export function handleCleric({ db, b, body, canControl, activeMember, casterData, persistVitals, log }) {
  const { kind } = body;
  if (!['cleric-spark', 'cleric-turn-undead', 'cleric-preserve-life'].includes(kind)) return false;
  const actor = b.fighters[b.turn];
  check((body.actorId == null || body.actorId === actor.id) && actor.characterId && canControl(actor) && activeMember(db, b.sessionId, actor) &&
    !b.pending && !b.fighters.some(f => f.concentrationDC) && !actor.action && !isIncapacitated(actor) && body.confirmed === true,
    'Channel Divinity wymaga własnej akcji Magia oraz potwierdzenia symbolu i zasięgu z MG.');
  const caster = casterData(db, actor.characterId);
  const profile = clericResources(caster.character, caster.state);
  check(profile?.channelRemaining > 0, 'Brak użyć Channel Divinity.');
  const ids = body.targetIds;
  check(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, 'Wskaż różne cele zdolności.');
  const targets = ids.map(id => b.fighters.find(f => f.id === id));
  check(targets.every(t => t && t.deathFailures < 3), 'Wybierz żywe lub nieumarłe cele dostępne w walce.');
  let spec, label;
  if (kind === 'cleric-preserve-life') {
    check(profile.preserveLife && Array.isArray(body.amounts) && body.amounts.length === targets.length &&
      body.amounts.every((amount, i) => Number.isInteger(amount) && amount > 0 &&
        targets[i].hp + amount <= Math.floor(targets[i].maxHp / 2) && !healingBlocked(targets[i])) &&
      sum(body.amounts) <= 5 * caster.character.level, 'Preserve Life: podziel pulę 5 × poziom bez przekraczania połowy maksymalnych PW celu.');
    targets.forEach((target, i) => healTarget(db, target, body.amounts[i], persistVitals));
    label = 'Preserve Life';
  } else if (kind === 'cleric-spark') {
    label = 'Divine Spark';
    const target = targets[0];
    const heal = body.mode === 'heal';
    const maximum = heal && profile.supremeHealing;
    check(targets.length === 1 && target.id !== actor.id && canSeeConditionTarget(actor, target) && caster.ability != null &&
      (maximum || validDice(body.rolls, profile.sparkDice, 8)), 'Divine Spark: wybierz inny widoczny cel i podaj kości k8.');
    const amount = Math.max(0, (maximum ? profile.sparkDice * 8 : sum(body.rolls)) + caster.ability);
    if (heal) {
      check(!healingBlocked(target), 'Cel nie może odzyskiwać PW.');
      healTarget(db, target, amount, persistVitals);
    } else {
      check(body.mode === 'damage' && ['Radiant', 'Necrotic'].includes(body.damageType) && !cannotHarm(actor, target), 'Wybierz dozwolony cel i typ obrażeń.');
      spec = { mode: 'save', save: 'con', half: true, dice: 0, sides: 0, type: body.damageType, bonus: amount };
    }
  } else {
    label = 'Turn Undead';
    check(targets.every(t => t.id !== actor.id && (t.creatureType === 'Undead' || !t.creatureType && body.confirmedUndead === true) && !cannotHarm(actor, t)), 'Turn Undead obejmuje wyłącznie nieumarłych.');
    const rolls = body.searRolls;
    check(rolls == null || profile.sear && caster.ability != null && validDice(rolls, Math.max(1, caster.ability), 8), 'Sear Undead: podaj k8 w liczbie wynikającej z Mądrości.');
    spec = { mode: 'condition', save: 'wis', dice: 0, sides: 0, bonus: 0, rider: 'frightened', turnUndead: true, searDamage: rolls ? sum(rolls) : 0, ...(rolls ? { type: 'Radiant' } : {}) };
  }
  if (spec) {
    check(caster.dc != null && targets.every(t => automaticSaveFailure(t, spec.save) || t.saves?.[spec.save] != null), 'Uzupełnij ST i modyfikatory rzutów obronnych.');
    b.pending = { kind: 'spell', actorId: actor.id, spellName: label, dc: caster.dc, castingId: randomUUID(), stage: 'save', spec, targets: ids.map(id => ({ id })) };
  }
  caster.state.clericChannelSpent = (caster.state.clericChannelSpent ?? 0) + 1;
  saveResources(db, actor.characterId, caster.state);
  actor.action = label;
  log(b, `${actor.name}: ${label}.`);
  return true;
}
