import { strongestEffects } from '../shared/timed-effects.mjs';
import { exhaustionPenalty, isIncapacitated } from '../shared/conditions.mjs';
import { timedRollModifier } from '../shared/timed-effects.mjs';
import { hexDisadvantage } from '../shared/warlock.mjs';
import { consumeSavePenalty } from './spell-conditions.mjs';
import { luckBonus } from './warlock-features.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';
import { spellEffects } from '../shared/combat-spells.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };
const die = n => Number.isInteger(n) && n >= 1 && n <= 20;

export function endProtectiveSpell(db, fighter, spellId) {
  if (!fighter?.timedEffects?.some(e => e.spellId === spellId)) return;
  fighter.timedEffects = fighter.timedEffects.filter(e => e.spellId !== spellId);
  if (fighter.characterId) {
    const state = resourceState(db, fighter.characterId);
    state.activeEffects = (state.activeEffects ?? []).filter(e => e.spellId !== spellId);
    saveResources(db, fighter.characterId, state);
  }
}
export function queueRetaliations(b, defender, attacker, hit) {
  if (!hit?.melee || !attacker || !defender) return;
  for (const e of strongestEffects(defender.timedEffects)) {
    if (!(e.modifiers.armorOfAgathys && defender.tempHp > 0 || e.modifiers.fireShield && hit.within5Feet)) continue;
    b.retaliations ??= [];
    b.retaliations.push({ sourceId: defender.id, sourceName: defender.name, targetId: attacker.id,
      name: e.name, sourceSnapshot: { id: defender.id, name: defender.name, spellConditions: defender.spellConditions ?? [] },
      spec: { mode: 'save', dice: e.modifiers.fireShield ? 2 : 0, sides: e.modifiers.fireShield ? 8 : 0,
        bonus: e.modifiers.retaliationAmount ?? 0, type: e.modifiers.retaliationType } });
  }
}
export function advanceRetaliations(b) {
  if (b.pending?.reactive || b.pending?.kind === 'sanctuary') return;
  while (b.retaliations?.length) {
    const e = b.retaliations.shift(), target = b.fighters.find(f => f.id === e.targetId);
    if (!target || target.deathFailures >= 3 || !target.characterId && target.hp <= 0) continue;
    if (b.pending) { b.retaliationSuspended = b.pending; b.pending = null; }
    b.pending = { kind: 'spell', reactive: true, actorId: target.id, sourceId: e.sourceId, reactiveSource: e.sourceSnapshot,
      spellName: e.name, spellId: 'retaliation', spec: e.spec, stage: 'effect', targets: [{ id: target.id }] };
    return;
  }
  if (!b.pending && b.retaliationSuspended) {
    const pending = b.retaliationSuspended, source = b.fighters.find(f => f.id === pending.actorId);
    b.retaliationSuspended = null;
    if (source && !isIncapacitated(source)) b.pending = pending;
  }
}

function wardFor(target) { return strongestEffects(target?.timedEffects).find(e => e.spellId === 'sanctuary'); }
function attemptedTarget(b, body, approved) {
  if (body.kind === 'attack') return body.targetId;
  if (body.kind === 'spell-attack' && b.pending?.stage === 'attack') return b.pending.targets[0]?.id;
  if (body.kind === 'cast') {
    const spec = spellEffects[body.spellId];
    if (spec && spec.mode !== 'attack' && (!spec.area || spec.directTargets) && (spec.dice > 0 || spec.components) && !['heal','temp-hp'].includes(spec.mode)) return spec.directTargets ? body.targetIds?.find(id => !approved.includes(id) && wardFor(b.fighters.find(f => f.id === id))) : body.targetIds?.[0];
  }
  return null;
}
export function interceptSanctuary({ db, b, body, canControl, activeMember, log }, visited = [], approved = []) {
  const gate = b.pending?.kind === 'sanctuary' ? b.pending : null;
  if (gate) {
    if (!['sanctuary-save','sanctuary-choice'].includes(body.kind)) return { waiting: false, body };
    const actor = b.fighters.find(f => f.id === gate.actorId);
    check(actor && canControl(actor) && activeMember(db, b.sessionId, actor), 'Sanctuary rozlicza właściciel atakującego.');
    const attempt = gate.attempt;
    if (die(body.attackRoll)) attempt.roll = body.attackRoll;
    if (die(body.attackRoll2)) attempt.roll2 = body.attackRoll2;
    if (body.kind === 'sanctuary-save') {
      check(gate.stage === 'save' && actor.saves.wis != null, 'Brak oczekującego WIS lub premii do rzutu.');
      const adv = Boolean(body.advantage), dis = Boolean(body.disadvantage || hexDisadvantage(b, actor, 'wis'));
      check(die(body.roll) && (adv === dis || die(body.roll2)), 'Podaj k20 i drugą kość przy ułatwieniu/utrudnieniu.');
      const roll = adv === dis ? body.roll : adv ? Math.max(body.roll, body.roll2) : Math.min(body.roll, body.roll2);
      const success = roll + actor.saves.wis - exhaustionPenalty(actor) + timedRollModifier(actor, body) + (actor.characterId ? luckBonus(db, actor.characterId, body.luckRoll) : 0) - consumeSavePenalty(actor, body.mindSliverRoll) >= gate.dc;
      log(b, `${actor.name}: WIS przeciw Sanctuary — ${success ? 'sukces' : 'wybierz inny cel albo strać atak/czar'}.`);
      if (!success) { gate.stage = 'choice'; return { waiting: true }; }
      b.pending = gate.originalPending;
      if (attempt.kind === 'cast' && spellEffects[attempt.spellId]?.directTargets) return interceptSanctuary({ db, b, body: attempt, canControl, activeMember, log }, gate.visited, [...gate.approved, gate.targetId]);
      return { body: attempt };
    }
    check(gate.stage === 'choice', 'Najpierw wykonaj WIS.');
    b.pending = gate.originalPending;
    if (!body.targetId) return { body: { ...attempt, sanctuaryLost: true } };
    check(!gate.visited.includes(body.targetId) && b.fighters.some(f => f.id === body.targetId && (attempt.kind !== 'attack' || f.id !== actor.id) && f.deathFailures < 3), 'Wybierz nowy, jeszcze nieodrzucony cel.');
    if (attempt.kind === 'spell-attack') b.pending.targets = [{ id: body.targetId }];
    else if (attempt.kind === 'cast') {
      check(!spellEffects[attempt.spellId]?.directTargets || !attempt.targetIds.includes(body.targetId), 'Ten czar już wskazuje wybrany cel.');
      attempt.targetIds = spellEffects[attempt.spellId]?.directTargets ? attempt.targetIds.map(id => id === gate.targetId ? body.targetId : id) : [body.targetId];
    }
    else attempt.targetId = body.targetId;
    return interceptSanctuary({ db, b, body: attempt, canControl, activeMember, log }, gate.visited, gate.approved);
  }
  const id = attemptedTarget(b, body, approved), target = b.fighters.find(f => f.id === id), ward = wardFor(target);
  if (!ward) return { body };
  const actor = b.fighters.find(f => f.id === (body.actorId ?? (body.kind === 'spell-attack' ? b.pending?.actorId : null) ?? b.fighters[b.turn].id));
  check(actor && canControl(actor) && activeMember(db, b.sessionId, actor) && !isIncapacitated(actor), 'Nie możesz rozpocząć tego ataku.');
  check(ward.dc != null && actor.saves.wis != null, 'Uzupełnij ST Sanctuary i WIS atakującego.');
  b.pending = { kind: 'sanctuary', actorId: actor.id, targetId: id, dc: ward.dc, stage: 'save', attempt: { ...body }, originalPending: b.pending, approved, visited: [...visited, id] };
  return { waiting: true };
}
