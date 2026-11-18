import { mindlessImmune } from '../shared/barbarian.mjs';
import { randomUUID } from 'node:crypto';
import { isIncapacitated } from '../shared/conditions.mjs';
import { persistConditionState } from './conditions.mjs';
import { handleBarbarian } from './barbarian.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };

export function bindConditionSources(b) {
  for (const f of b.fighters) f.conditionSources = (f.conditionSources ?? []).map(e => ({ ...e, sourceId: b.fighters.find(s => e.sourceCharacterId && s.characterId === e.sourceCharacterId)?.id ?? e.sourceId }));
}
export function syncSourceConditions(db, b) {
  for (const f of b.fighters) {
    const old = f.conditionSources ?? [];
    f.conditionSources = old.filter(e => e.kind !== 'grappled' || !isIncapacitated(b.fighters.find(s => s.id === e.sourceId) ?? {}));
    if (old.length !== f.conditionSources.length) persistConditionState(db, f);
  }
}
export function handleSourceConditions(context) {
  const { db, b, body, gm, canControl, log, persistVitals } = context;
  if (!['flight-state', 'base-size', 'condition-source', 'condition-sight', 'exhaustion', 'grapple-escape'].includes(body.kind)) return false;
  const target = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(target && !b.pending && !b.fighters.some(f => f.concentrationDC), 'Najpierw rozlicz działanie i koncentrację.');
  if (body.kind === 'grapple-escape') {
    const source = target.conditionSources?.find(e => e.id === body.effectId && e.kind === 'grappled');
    check(source?.escapeDC && target.characterId && canControl(target) && target.id === b.fighters[b.turn].id && !target.action && !isIncapacitated(target), 'Ucieczka wymaga własnej akcji, postaci i znanego ST chwytu.');
    check(['athletics', 'acrobatics'].includes(body.skill), 'Wybierz Athletics albo Acrobatics.');
    handleBarbarian({ ...context, body: { ...body, kind: 'ability-check', escapeGrapple: true, dc: source.escapeDC } });
    target.action = 'Ucieczka z chwytu';
    const success = target.lastAbilityCheck?.total >= source.escapeDC;
    if (success) target.conditionSources = target.conditionSources.filter(e => e !== source);
    persistConditionState(db, target); log(b, `${target.name}: ucieczka z chwytu — ${success ? 'sukces' : 'porażka'}.`);
    return true;
  }
  check(gm, 'Źródła, widoczność i poziom wyczerpania ustala MG.');
  if (body.kind === 'flight-state') {
    check(typeof body.aloft === 'boolean', 'Potwierdź pozycję w powietrzu albo lądowanie.');
    target.aloft = body.aloft; target.flightNeedsReview = false;
    log(b, `${target.name}: MG rozlicza lot / lądowanie / upadek (obrażenia osobno).`);
  } else if (body.kind === 'base-size') {
    check(['Tiny','Small','Medium','Large','Huge','Gargantuan'].includes(body.size), 'Wybierz rozmiar bazowy stworzenia.');
    target.size = body.size;
  } else if (body.kind === 'exhaustion') {
    check(Number.isInteger(body.level) && body.level >= 0 && body.level <= 6, 'Poziom Exhaustion musi być od 0 do 6.');
    target.exhaustion = body.level;
    if (body.level === 6) { target.hp = 0; target.deathFailures = 3; target.deathSuccesses = 0; persistVitals(db, target); }
    persistConditionState(db, target); log(b, `${target.name}: Exhaustion ${body.level}${body.level === 6 ? ' — śmierć' : ''}.`);
  } else if (body.kind === 'condition-sight') {
    check(b.fighters.some(f => f.id === body.targetId) && typeof body.visible === 'boolean', 'Wybierz widziany cel.');
    target.seenInvisibleIds = (target.seenInvisibleIds ?? []).filter(id => id !== body.targetId);
    if (body.visible) target.seenInvisibleIds.push(body.targetId);
  } else {
    check(!body.enabled || !mindlessImmune(target, body.condition), 'Mindless Rage: niewrażliwość na Charmed i Frightened.');
    check(['charmed', 'frightened', 'grappled'].includes(body.condition) && typeof body.enabled === 'boolean', 'Wybierz stan ze źródłem.');
    if (!body.enabled && typeof body.effectId === 'string') {
      target.conditionSources = (target.conditionSources ?? []).filter(e => e.id !== body.effectId);
      persistConditionState(db, target); return true;
    }
    const source = b.fighters.find(f => f.id === body.sourceId);
    check(source && source.id !== target.id, 'Wybierz inne stworzenie jako źródło stanu.');
    if (body.condition === 'grappled' && body.enabled) check(Number.isInteger(body.escapeDC) && body.escapeDC >= 1 && body.escapeDC <= 100 && !isIncapacitated(source), 'Podaj ST ucieczki; Incapacitated nie może utrzymywać chwytu.');
    target.conditionSources = (target.conditionSources ?? []).filter(e => !(e.kind === body.condition && e.sourceId === source.id));
    if (body.enabled) target.conditionSources.push({ id: randomUUID(), kind: body.condition, sourceId: source.id, sourceCharacterId: source.characterId, sourceName: source.name, escapeDC: body.escapeDC, visible: body.visible !== false });
    persistConditionState(db, target);
    log(b, `${target.name}: ${body.condition} od ${source.name} — ${body.enabled ? 'aktywny' : 'usunięty'}.`);
  }
  return true;
}
