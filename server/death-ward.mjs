import { strongestEffects } from '../shared/timed-effects.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';
import { endConcentration } from './concentration.mjs';
import { endWildShape } from './druid.mjs';

// Consume just the currently effective casting; suppressed castings remain.
export function takeDeathWard(effects = []) {
  const ward = strongestEffects(effects).find(e => e.spellId === 'death-ward');
  if (!ward) return false;
  effects.splice(effects.findIndex(e => e.id === ward.id), 1);
  return true;
}
export function consumeDeathWard(db, target) {
  const before = target.timedEffects ?? [];
  const ids = new Set(before.map(e => e.id));
  if (!takeDeathWard(before)) return false;
  target.timedEffects = before;
  for (const e of before) ids.delete(e.id);
  if (target.characterId) {
    const state = resourceState(db, target.characterId);
    state.activeEffects = (state.activeEffects ?? []).filter(e => !ids.has(e.id));
    saveResources(db, target.characterId, state);
  }
  return true;
}
export function instantDeath(db, target, persistVitals) {
  if (consumeDeathWard(db, target)) return false;
  target.hp = 0; target.deathFailures = 3; target.deathSuccesses = 0;
  target.dodge = false; target.rage = null; target.relentlessRagePending = null;
  endConcentration(db, target); endWildShape(target);
  if (target.characterId) {
    const state = resourceState(db, target.characterId); state.wildShape = null; saveResources(db, target.characterId, state);
  }
  persistVitals(db, target);
  return true;
}
