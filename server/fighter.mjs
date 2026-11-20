import { randomUUID } from 'node:crypto';
import { timedSize } from '../shared/timed-effects.mjs';
import { automaticSaveFailure, isIncapacitated } from '../shared/conditions.mjs';
import { healingBlocked, spellSpeed } from './spell-conditions.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };

// Keep the ordinary action and the restricted additional action separate.
export function prepareSurgeAction(b, body, canControl) {
  if (!body.useActionSurge) return null;
  const f = b.fighters[b.turn];
  check(canControl(f) && !b.pending && f.surgeAction !== null && f.surgeAction !== undefined,
    'Najpierw aktywuj Action Surge w swojej turze.');
  check(['attack', 'dash', 'dodge', 'disengage', 'help', 'skip'].includes(body.kind)
    && (!['attack', 'skip'].includes(body.kind) || body.slot === 'action'),
  'Dodatkowa akcja Action Surge nie pozwala na akcję Magic ani akcje bonusowe i reakcje.');
  const original = { action: f.action, attacksLeft: f.attacksLeft };
  f.action = f.surgeAction;
  f.attacksLeft = f.surgeAttacksLeft;
  return original;
}

export function finishSurgeAction(f, original) {
  if (!original) return;
  f.surgeAction = f.action;
  f.surgeAttacksLeft = f.attacksLeft;
  Object.assign(f, original);
}

export function handleFighter({ db, b, body, canControl, activeMember, log }) {
  if (!['action-surge', 'tactical-mind'].includes(body.kind)) return false;
  const f = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(f && canControl(f) && activeMember(db, b.sessionId, f) && f.characterId
    && f.hp > 0 && !isIncapacitated(f) && f.deathFailures < 3,
  'Ta postać nie może teraz działać.');
  check((!b.pending || body.kind === 'tactical-mind' && b.pending.kind === 'request' && b.pending.actorId === f.id) && !b.fighters.some(f => f.concentrationDC || f.relentlessRagePending),
    'Najpierw rozstrzygnij rozpoczęte działanie.');
  check(f.actionSurgeMax > 0, 'Ta zdolność wymaga 2. poziomu Fightera.');
  const state = resourceState(db, f.characterId);
  if (body.kind === 'action-surge') {
    check(f.id === b.fighters[b.turn].id && !f.actionSurgeUsedThisTurn && f.actionSurgeUses > 0,
      'Action Surge jest niedostępne w tej turze.');
    f.actionSurgeUses--;
    f.actionSurgeUsedThisTurn = true;
    f.surgeAction = '';
    f.surgeAttacksLeft = 0;
    state.actionSurgeUses = f.actionSurgeUses;
    log(b, `${f.name}: Action Surge — dodatkowa akcja bez akcji Magic.`);
  } else {
    const test = f.lastAbilityCheck;
    check(test && !test.attempted && test.total < test.dc, 'Brak nieudanego testu do Tactical Mind.');
    check(f.secondWindUses > 0, 'Brak użyć Second Wind.');
    check(Number.isInteger(body.roll) && body.roll >= 1 && body.roll <= 10, 'Podaj wynik k10 (1–10).');
    test.attempted = true;
    test.total += body.roll;
    test.success = test.total >= test.dc;
    if (test.success) {
      f.secondWindUses--;
      state.secondWindUses = f.secondWindUses;
    }
    log(b, `${f.name}: Tactical Mind, wynik ${test.total}, ST ${test.dc} — ${test.success ? 'sukces; zużyto Second Wind' : 'porażka; zachowano Second Wind'}.`);
  }
  saveResources(db, f.characterId, state);
  return true;
}

export const isFighter = character => character?.class?.includes('Fighter') === true;

export function fighterProfile(character, state = {}) {
  const level = isFighter(character) ? character.level : 0;
  const surgeMax = level >= 17 ? 2 : level >= 2 ? 1 : 0;
  const indomitableMax = level >= 17 ? 3 : level >= 13 ? 2 : level >= 9 ? 1 : 0;
  const champion = level >= 3 && character.subclass === 'Champion';
  return {
    level, surgeMax, surgeUses: Math.min(surgeMax, state.actionSurgeUses ?? surgeMax),
    indomitableMax, indomitableRemaining: Math.max(0, indomitableMax - (state.fighterIndomitableSpent ?? 0)),
    tacticalShift: level >= 5, tacticalMaster: level >= 9, studiedAttacks: level >= 13,
    athlete: champion, criticalThreshold: champion ? level >= 15 ? 18 : 19 : 20,
    heroicWarrior: champion && level >= 10, survivor: champion && level >= 18,
  };
}

export function fighterIndomitable(db, fighter, body, original, dc, modifier, advantage, disadvantage, logResult, capture = null) {
  if (body.indomitableRoll == null) return original;
  const die = value => Number.isInteger(value) && value >= 1 && value <= 20;
  check(fighter.characterId && fighter.fighter?.indomitableMax && Number.isFinite(dc) && original < dc &&
    Number.isFinite(modifier) && die(body.indomitableRoll) && (advantage === disadvantage || die(body.indomitableRoll2)),
    'Indomitable requires a failed saving throw and the dice for the reroll.');
  const state = resourceState(db, fighter.characterId);
  check((state.fighterIndomitableSpent ?? 0) < fighter.fighter.indomitableMax, 'No Indomitable uses remain.');
  state.fighterIndomitableSpent = (state.fighterIndomitableSpent ?? 0) + 1;
  saveResources(db, fighter.characterId, state);
  const first = body.indomitableRoll, second = body.indomitableRoll2;
  const roll = advantage === disadvantage ? first : advantage ? Math.max(first, second) : Math.min(first, second);
  if (capture) capture.roll = roll;
  const result = roll + modifier + fighter.fighter.level;
  logResult(`${fighter.name}: Indomitable +${fighter.fighter.level}, wynik ${result}.`);
  return result;
}

export const studiedAdvantage = (actor, target) => (actor.studiedTargets?.[target.id] ?? 0) > (actor.completedTurns ?? 0);

export function studiedResult(b, actor, target, hit) {
  if (!actor.fighter?.studiedAttacks) return;
  actor.studiedTargets ??= {};
  if (hit) delete actor.studiedTargets[target.id];
  else actor.studiedTargets[target.id] = (actor.completedTurns ?? 0) + (b.fighters[b.turn].id === actor.id ? 2 : 1);
}

export function endFighterTurn(fighter) {
  if (!fighter.fighter?.studiedAttacks && !fighter.vexTargets) return;
  fighter.completedTurns = (fighter.completedTurns ?? 0) + 1;
  for (const [target, expires] of Object.entries(fighter.studiedTargets ?? {})) if (expires <= fighter.completedTurns) delete fighter.studiedTargets[target];
  for (const [target, expires] of Object.entries(fighter.vexTargets ?? {})) if (expires <= fighter.completedTurns) delete fighter.vexTargets[target];
}

export function startFighterTurn(db, b, f, persistVitals, log) {
  if (!f.fighter?.athlete || !f.characterId || f.deathFailures >= 3) return;
  if (f.fighter.heroicWarrior) {
    const state = resourceState(db, f.characterId);
    if (!(state.heroicInspirationAvailable ?? f.species === 'Człowiek (Human)')) {
      state.heroicInspirationAvailable = true;
      saveResources(db, f.characterId, state);
      log(b, `${f.name}: Heroic Warrior — Heroic Inspiration.`);
    }
  }
  if (f.fighter.survivor && f.hp > 0 && f.hp <= f.maxHp / 2 && !healingBlocked(f)) {
    const healed = Math.max(0, Math.min(f.maxHp - f.hp, 5 + (f.constitutionModifier ?? 0)));
    f.hp += healed;
    persistVitals(db, f);
    log(b, `${f.name}: Heroic Rally — ${healed} PW.`);
  }
}

export function fighterShift(b, f, feet, log, label) {
  check(Number.isInteger(feet) && feet >= 0 && feet <= Math.floor(spellSpeed(f) / 2), 'Movement exceeds half Speed.');
  if (!feet) return;
  f.lastFreeMovement = { feet, opportunityAttacks: false, source: label };
  log(b, `${f.name}: ${label} — ${feet} stóp bez ataków okazyjnych.`);
}

export function selectMastery(fighter, attack, choice) {
  if (choice == null) return attack;
  check(attack.mastery && (choice === attack.mastery || fighter.fighter?.tacticalMaster && ['Push', 'Sap', 'Slow'].includes(choice)),
    'Tactical Master requires a mastered weapon and Push, Sap or Slow.');
  return { ...attack, mastery: choice, nick: choice === 'Nick' };
}

export function masteryAttackFlags(actor, target) {
  return {
    advantage: (actor.vexTargets?.[target.id] ?? 0) > (actor.completedTurns ?? 0),
    disadvantage: Boolean(actor.masterySap?.length),
  };
}

export function consumeMasteryAttack(actor, target) {
  if (actor.vexTargets) delete actor.vexTargets[target.id];
  actor.masterySap = [];
}

export function clearMasterySource(b, source) {
  for (const target of b.fighters) {
    if (target.masterySap) target.masterySap = target.masterySap.filter(id => id !== source.id);
    if (target.masterySlow) target.masterySlow = target.masterySlow.filter(id => id !== source.id);
  }
}

export function applyWeaponMastery(b, actor, target, p, body, amount, log) {
  const mastery = p.attack.mastery;
  if (mastery === 'Push' && body.pushFeet != null) {
    const size = timedSize(target)?.toLowerCase();
    check(Number.isInteger(body.pushFeet) && body.pushFeet >= 0 && body.pushFeet <= 10 &&
      !['huge', 'gargantuan'].includes(size) && (size || body.confirmedSize === true), 'Push requires a Large or smaller target and up to 10 feet.');
    if (body.pushFeet) log(b, `${target.name}: Push ${body.pushFeet} stóp od ${actor.name}.`);
  }
  if (mastery === 'Sap') target.masterySap = [...new Set([...(target.masterySap ?? []), actor.id])];
  if (mastery === 'Slow' && amount > 0) target.masterySlow = [...new Set([...(target.masterySlow ?? []), actor.id])];
  if (mastery === 'Vex' && amount > 0) {
    actor.vexTargets ??= {};
    actor.vexTargets[target.id] = (actor.completedTurns ?? 0) + (b.fighters[b.turn].id === actor.id ? 2 : 1);
  }
  if (mastery === 'Topple' && body.topple === true && target.deathFailures < 3 && target.hp > 0) {
    const modifier = actor.attackAbilityModifiers?.[p.attack.ability];
    check(modifier != null && (target.saves?.con != null || automaticSaveFailure(target, 'con')), 'Topple requires the attack ability and target CON save.');
    return { kind: 'spell', actorId: actor.id, castingId: randomUUID(), spellName: 'Topple', dc: 8 + modifier + actor.proficiency,
      stage: 'save', spec: { mode: 'condition', save: 'con', dice: 0, sides: 0, bonus: 0, rider: 'prone', weaponTopple: true }, targets: [{ id: target.id }] };
  }
  return null;
}
