import { timedSpeedBonus, timedSpeedMultiplier, timedFlySpeed } from '../shared/timed-effects.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';
import { conditionDefinitions, hasCondition, isIncapacitated, conditionSpeedZero } from '../shared/conditions.mjs';
// Effects are separate from manually assigned conditions and never overwrite them.
export const hasSpellCondition = (fighter, kind) => conditionDefinitions[kind] ? hasCondition(fighter, kind) : (fighter.spellConditions ?? []).some(effect => effect.kind === kind);
export const healingBlocked = fighter => fighter.healingBlocked || hasSpellCondition(fighter, 'chill-touch');
export const spellSpeed = fighter => conditionSpeedZero(fighter) ? 0 : Math.floor(Math.max(0, fighter.speed + timedSpeedBonus(fighter) - 5 * (fighter.exhaustion ?? 0) - (hasSpellCondition(fighter, 'ray-of-frost') ? 10 : 0) - (hasSpellCondition(fighter, 'wrath') ? 10 : 0)) * timedSpeedMultiplier(fighter) / (fighter.zoneSpeedHalved ? 2 : 1));
export const spellFlySpeed = fighter => conditionSpeedZero(fighter) || timedFlySpeed(fighter) <= 0 ? 0 : spellSpeed({ ...fighter, speed: timedFlySpeed(fighter) });
export function consumeSavePenalty(fighter, roll) {
  if (!hasSpellCondition(fighter, 'mind-sliver')) return 0;
  if (!Number.isInteger(roll) || roll < 1 || roll > 4) throw new Error('Mind Sliver: podaj odejmowane k4.');
  fighter.spellConditions = fighter.spellConditions.filter(e => e.kind !== 'mind-sliver');
  return roll;
}
export function enfeeblementReduction(fighter, roll) {
  if (!hasSpellCondition(fighter, 'enfeebled')) return 0;
  if (!Number.isInteger(roll) || roll < 1 || roll > 8) throw new Error('Ray of Enfeeblement: podaj k8 odejmowane od każdego rzutu obrażeń.');
  return roll;
}
export const spellDisadvantage = (fighter, ability, check = false) => hasSpellCondition(fighter, 'poisoned') && !check
  || hasSpellCondition(fighter, 'enfeebled') && ability === 'str'
  || !check && hasSpellCondition(fighter, 'enfeebled-miss');
export function consumeSpellAttack(fighter) {
  fighter.spellConditions = (fighter.spellConditions ?? []).filter(effect => effect.kind !== 'enfeebled-miss');
}
export function addSpellCondition(b, target, source, kind, options = {}) {
  target.spellConditions ??= [];
  target.spellConditions = target.spellConditions.filter(effect => !(effect.kind === kind && effect.sourceId === source.id));
  target.spellConditions.push({ kind, sourceId: source.id, sourceInitiative: source.initiative, expiresRound: b.round + 1, ...options });
}
export function syncSpellConditions(b, db) {
  for (const fighter of b.fighters) {
    if (fighter.concentration && (fighter.concentrationExpiresRound && (b.round > fighter.concentrationExpiresRound || b.round === fighter.concentrationExpiresRound && b.turn >= b.fighters.indexOf(fighter)) || isIncapacitated(fighter))) {
      fighter.concentration = null; fighter.concentrationDC = null; fighter.concentrationChecks = [];
      if (fighter.characterId) { const state = resourceState(db, fighter.characterId); state.concentration = null; saveResources(db, fighter.characterId, state); }
    }
  }
  for (const fighter of b.fighters) {
    fighter.spellConditions = (fighter.spellConditions ?? []).filter(effect => {
      const source = b.fighters.find(f => f.id === effect.sourceId);
      if (!effect.concentrationKey) return source || b.round < effect.expiresRound || b.round === effect.expiresRound && b.fighters[b.turn].initiative >= effect.sourceInitiative;
      return source && source.concentration && source.hp > 0 && !isIncapacitated(source) && source.concentrationKey === effect.concentrationKey && (b.round < effect.expiresRound || b.round === effect.expiresRound && b.turn < b.fighters.indexOf(source));
    });
  }
}
export function endSpellTurn(b, fighter) {
  for (const target of b.fighters) target.spellConditions = (target.spellConditions ?? []).filter(effect => effect.expiresOnSourceStart || effect.expiresOnTargetStart || effect.concentrationKey || effect.sourceId !== fighter.id || effect.expiresRound > b.round);
}
export function startSpellTurn(b, fighter) {
  for (const target of b.fighters) target.spellConditions = (target.spellConditions ?? []).filter(effect => !(effect.expiresOnSourceStart && effect.sourceId === fighter.id && effect.expiresRound <= b.round) && !(effect.expiresOnTargetStart && target.id === fighter.id) && (!['enfeebled-miss', 'ray-of-frost'].includes(effect.kind) || effect.sourceId !== fighter.id || effect.expiresRound > b.round));
}
