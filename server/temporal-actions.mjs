import { hasTimedModifier } from '../shared/timed-effects.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };

export function prepareHasteAction(b, body, canControl) {
  if (!body.useHaste) return null;
  const f = b.fighters[b.turn];
  check(canControl(f) && hasTimedModifier(f, 'haste') && !hasTimedModifier(f, 'slow') && !f.hasteActionUsed && !b.pending && !body.useActionSurge, 'Dodatkowa akcja Haste jest niedostępna.');
  check(body.slot === 'action' && (['attack', 'dash', 'disengage', 'skip'].includes(body.kind) || body.kind === 'request' && ['hide', 'utilize'].includes(body.hasteAction)), 'Haste pozwala tylko na jeden atak, Dash, Disengage, Hide lub Utilize.');
  const original = { action: f.action, attacksLeft: f.attacksLeft, maxAttacks: f.maxAttacks };
  f.action = ''; f.attacksLeft = 0; f.maxAttacks = 1;
  return original;
}
export function finishHasteAction(f, original) {
  if (!original) return;
  f.hasteActionUsed = true;
  Object.assign(f, original);
}
export function temporalSnapshot(b) {
  return new Map(b.fighters.map(f => [f.id, { action: f.action, bonus: f.bonus, reaction: f.reaction }]));
}
export function validateSlowActions(b, before, body) {
  const spent = value => Boolean(value && value !== 'Pominięto');
  for (const f of b.fighters) {
    if (!hasTimedModifier(f, 'slow')) continue;
    const old = before.get(f.id);
    if (!old) continue;
    check(!(f.reaction && f.reaction !== old.reaction && !(body.kind === 'skip' && body.slot === 'reaction')), 'Slow uniemożliwia reakcje.');
    check(!((f.action !== old.action || f.bonus !== old.bonus) && spent(f.action) && spent(f.bonus) && !(body.kind === 'skip')), 'Slow pozwala na akcję albo akcję bonusową, nie obie.');
  }
}
