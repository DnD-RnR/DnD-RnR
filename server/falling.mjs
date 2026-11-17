import { hasTimedModifier, timedResistance } from '../shared/timed-effects.mjs';
import { isIncapacitated, hasCondition } from '../shared/conditions.mjs';
import { barbarianResistance } from '../shared/barbarian.mjs';
import { warlockResistance } from '../shared/warlock.mjs';
import { defendSpellDamage } from '../shared/spell-damage.mjs';
import { hasSpellCondition } from './spell-conditions.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';
import { persistConditionState } from './conditions.mjs';
import { handleBarbarian } from './barbarian.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
export function syncFallingChecks(b) {
  for (const f of b.fighters) if (f.falling && f.fallWaterTried && f.lastAbilityCheck?.fallWater) f.fallWaterSuccess = f.lastAbilityCheck.total >= 15;
}
export function handleFalling(context) {
  const { db, b, body, gm, canControl, activeMember, damage, log } = context;
  if (!['fall-start', 'fall-stop', 'fall-land', 'fall-water'].includes(body.kind)) return false;
  check(!b.pending && !b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij działanie i koncentrację.');
  if (body.kind === 'fall-start') {
    check(gm && Array.isArray(body.targetIds) && body.targetIds.length > 0 && body.targetIds.length <= 50 && new Set(body.targetIds).size === body.targetIds.length, 'MG wskazuje spadające stworzenia.');
    const targets = body.targetIds.map(id => b.fighters.find(f => f.id === id));
    check(targets.every(f => f && !f.falling), 'Wybierz istniejące stworzenia, które jeszcze nie spadają.');
    for (const f of targets) {
      f.falling = true; f.fallLiquid = body.liquid === true; f.fallWaterTried = false; f.fallWaterSuccess = false;
      f.aloft = true; f.flightNeedsReview = false;
      log(b, `${f.name}: MG deklaruje spadanie${f.fallLiquid ? ' w stronę cieczy' : ''}. Przed lądowaniem można użyć Feather Fall.`);
    }
    return true;
  }
  const f = b.fighters.find(f => f.id === body.actorId);
  check(f?.falling, 'To stworzenie nie ma zadeklarowanego spadania.');
  if (body.kind === 'fall-water') {
    check(canControl(f) && activeMember(db, b.sessionId, f) && f.fallLiquid && !f.fallWaterTried && !f.reaction && !isIncapacitated(f) && f.hp > 0 && !hasTimedModifier(f, 'slow') && !hasSpellCondition(f, 'no-reactions'), 'Wejście do wody wymaga wolnej reakcji i spadania do cieczy.');
    check(['athletics', 'acrobatics'].includes(body.skill), 'Wybierz STR (Athletics) albo DEX (Acrobatics).');
    let total;
    if (f.characterId) {
      handleBarbarian({ ...context, body: { ...body, kind: 'ability-check', dc: 15 } });
      total = f.lastAbilityCheck?.total ?? -Infinity;
      if (f.lastAbilityCheck) f.lastAbilityCheck.fallWater = true;
    } else {
      check(gm && Number.isInteger(body.total) && body.total >= -100 && body.total <= 100, 'MG podaje pełny wynik testu potwora.');
      total = body.total;
    }
    f.reaction = 'Spadanie do cieczy'; f.fallWaterTried = true; f.fallWaterSuccess = total >= 15;
    log(b, `${f.name}: wejście do cieczy, ST 15 — ${f.fallWaterSuccess ? 'połowa obrażeń upadku' : 'pełne obrażenia upadku'}.`);
    return true;
  }
  check(gm, 'Zatrzymanie spadania i lądowanie rozstrzyga MG.');
  if (body.kind === 'fall-stop') {
    f.falling = false; f.fallLiquid = false; f.flightNeedsReview = false;
    log(b, `${f.name}: MG zatrzymuje spadanie przed lądowaniem. Pozycję i źródło ratunku rozstrzyga MG.`);
    return true;
  }
  check(Number.isInteger(body.feet) && body.feet >= 0 && body.feet <= 1000000, 'Podaj wysokość całego upadku w stopach.');
  const protectedFall = hasTimedModifier(f, 'fallProtection');
  const count = protectedFall ? 0 : Math.min(20, Math.floor(body.feet / 10));
  check(Array.isArray(body.rolls) && body.rolls.length === count && body.rolls.every(n => Number.isInteger(n) && n >= 1 && n <= 6), `Podaj ${count} wyników k6 upadku.`);
  const raw = body.rolls.reduce((sum, n) => sum + n, 0);
  const resistant = body.resistant === true || hasCondition(f, 'petrified') || timedResistance(f, 'obuchowe') || f.damageResistance === 'obuchowe' || warlockResistance(f, 'obuchowe') || barbarianResistance(f, 'obuchowe');
  const amount = defendSpellDamage([{ type: 'obuchowe', amount: raw }], f.fallWaterSuccess === true, true, { obuchowe: { immune: body.immune === true, resistant, vulnerable: body.vulnerable === true } })[0].amount;
  // Defenses use the shared order: half damage, resistance, vulnerability.
  // The shared damage event handles temporary HP, death and concentration.
  damage(db, f, amount, false, 'obuchowe', true);
  if (f.lastDamage.amount > 0 && body.proneImmune !== true) { f.prone = true; persistConditionState(db, f); }
  if (protectedFall) {
    f.timedEffects = (f.timedEffects ?? []).filter(e => e.spellId !== 'feather-fall');
    if (f.characterId) {
      const state = resourceState(db, f.characterId);
      state.activeEffects = (state.activeEffects ?? []).filter(e => e.spellId !== 'feather-fall');
      saveResources(db, f.characterId, state);
    }
  }
  f.falling = false; f.fallLiquid = false; f.aloft = false; f.flightNeedsReview = false;
  log(b, `${f.name}: lądowanie po ${body.feet} stopach, ${f.lastDamage.amount} obrażeń obuchowych${protectedFall ? '; Feather Fall kończy się tylko na tym stworzeniu' : ''}.`);
  return true;
}
