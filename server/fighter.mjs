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
    && f.hp > 0 && !f.incapacitated && !f.unconscious && f.deathFailures < 3,
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
