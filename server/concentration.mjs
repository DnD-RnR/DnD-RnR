import { randomUUID } from 'node:crypto';
import { resourceState, saveResources } from './spell-resources.mjs';
import { timedSpellDefinitions } from '../shared/timed-effects.mjs';

export function durationSeconds(spell) {
  const explicit = timedSpellDefinitions[spell.id]?.seconds ?? (spell.effect?.concentrationRounds ? spell.effect.concentrationRounds * 6 : null);
  if (explicit) return explicit;
  const match = spell.duration?.match(/(\d+)\s*(round|rund|minut|minute|hour|godzin|day|dni|dzień)/i);
  return match ? Number(match[1]) * (/round|rund/i.test(match[2]) ? 6 : /minut/i.test(match[2]) ? 60 : /hour|godzin/i.test(match[2]) ? 3600 : 86400) : null;
}
export function endConcentration(db, fighter) {
  fighter.concentration = null; fighter.concentrationKey = null; fighter.concentrationExpiresRound = null;
  fighter.concentrationDC = null; fighter.concentrationChecks = [];
  if (fighter.characterId) {
    const state = resourceState(db, fighter.characterId);
    state.concentration = null; state.concentrationKey = null; state.concentrationExpiresAt = null; state.concentrationRemainingSeconds = null;
    saveResources(db, fighter.characterId, state);
  }
}
export function startConcentration(db, fighter, spell, b = null) {
  const seconds = durationSeconds(spell);
  fighter.concentration = spell.name; fighter.concentrationKey = randomUUID();
  fighter.concentrationDC = null; fighter.concentrationChecks = [];
  fighter.concentrationExpiresRound = b && seconds ? b.round + seconds / 6 : null;
  if (fighter.characterId) {
    const state = resourceState(db, fighter.characterId);
    state.concentration = spell.name; state.concentrationKey = fighter.concentrationKey;
    state.concentrationExpiresAt = seconds ? Date.now() + seconds * 1000 : null;
    state.concentrationRemainingSeconds = seconds;
    saveResources(db, fighter.characterId, state);
  }
}
