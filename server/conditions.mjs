import { hasCondition, isIncapacitated } from '../shared/conditions.mjs';
import { endConcentration } from './concentration.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';

export function persistConditionState(db, fighter) {
  if (!fighter.characterId) return;
  const state = resourceState(db, fighter.characterId);
  state.manualConditions = fighter.manualConditions ?? [];
  state.prone = fighter.prone === true;
  saveResources(db, fighter.characterId, state);
}
export function syncConditionConsequences(db, b) {
  let concentrationEnded = false;
  for (const f of b.fighters) {
    if (hasCondition(f, 'unconscious') && !f.prone) { f.prone = true; persistConditionState(db, f); }
    if (isIncapacitated(f) && f.concentration) { endConcentration(db, f); concentrationEnded = true; }
    if (f.rage && (hasCondition(f, 'unconscious') || isIncapacitated(f) && !f.rageProfile?.persistent)) f.rage = null;
  }
  return concentrationEnded;
}
export function endCondition(db, fighter, kind) {
  fighter[kind] = false;
  fighter.manualConditions = (fighter.manualConditions ?? []).filter(c => c !== kind);
  fighter.spellConditions = (fighter.spellConditions ?? []).filter(c => c.kind !== kind);
  fighter.timedEffects = (fighter.timedEffects ?? []).filter(e => e.modifiers.condition !== kind);
  if (fighter.characterId) {
    const state = resourceState(db, fighter.characterId);
    state.activeEffects = (state.activeEffects ?? []).filter(e => e.modifiers.condition !== kind);
    state.manualConditions = fighter.manualConditions;
    state.prone = fighter.prone === true;
    saveResources(db, fighter.characterId, state);
  }
}
export function endTimedCondition(db, fighter, effectId) {
  fighter.timedEffects = (fighter.timedEffects ?? []).filter(e => e.id !== effectId);
  if (fighter.characterId) {
    const state = resourceState(db, fighter.characterId);
    state.activeEffects = (state.activeEffects ?? []).filter(e => e.id !== effectId);
    saveResources(db, fighter.characterId, state);
  }
}
