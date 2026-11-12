import { resourceState, saveResources } from './spell-resources.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };
import { psiResources } from '../shared/psi-warrior.mjs';
export { psiResources, restPsi } from '../shared/psi-warrior.mjs';
export function spendPsi(db, f, roll) {
  check(f.psiMax > 0 && f.psiUses > 0, 'Brak kości Psionic Energy.');
  if (roll !== undefined) check(Number.isInteger(roll) && roll >= 1 && roll <= f.psiSides, 'Podaj poprawny wynik kości Psionic Energy.');
  const state = resourceState(db, f.characterId);
  state.psiUses = --f.psiUses;
  saveResources(db, f.characterId, state);
}
export function psionicStrike(db, b, actor, body, amount, damage, target, log) {
  if (body.psiRoll == null) return;
  check(actor.psiMax > 0 && !actor.psiStrikeUsed && b.fighters[b.turn].id === actor.id && amount > 0 && target.lastDamage?.amount > 0
    && b.pending.attack.id !== 'unarmed' && actor.attacks.some(a => a.id === b.pending.attack.id)
    && body.psiConfirmed === true && actor.psiInt !== null, 'Psionic Strike wymaga obrażeń bronią w swojej turze i celu w 30 stopach.');
  spendPsi(db, actor, body.psiRoll);
  actor.psiStrikeUsed = true;
  const extra = Math.max(0, body.psiRoll + actor.psiInt);
  damage(db, target, extra, false, 'moc');
  log(b, `${actor.name}: Psionic Strike → ${target.name}: ${extra} obrażeń mocy.`);
}
export function handlePsi({ db, b, body, canControl, activeMember, log }) {
  if (!['protective-field', 'telekinetic-movement', 'restore-telekinetic-movement'].includes(body.kind)) return false;
  const f = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(f && canControl(f) && activeMember(db, b.sessionId, f) && f.characterId && f.psiMax > 0
    && f.hp > 0 && !f.incapacitated && !f.unconscious && f.deathFailures < 3, 'Psi Warrior nie może teraz działać.');
  check(!b.fighters.some(f => f.concentrationDC || f.relentlessRagePending), 'Najpierw rozstrzygnij rozpoczęte działanie.');
  if (body.kind === 'protective-field') {
    const p = b.pending;
    const target = b.fighters.find(t => t.id === body.targetId);
    check(!f.reaction && !f.reactionDeferred && f.psiInt !== null && body.psiConfirmed === true && target
      && (p?.kind === 'damage' && p.targetId === target.id || p?.kind === 'spell' && p.stage === 'effect' && ['attack', 'save'].includes(p.spec.mode) && p.targets.some(t => t.id === target.id)),
      'Protective Field wymaga reakcji i widocznego celu obrażeń w 30 stopach.');
    check(!target.psiReduction, 'Protective Field już chroni ten cel.');
    check(Number.isInteger(body.roll), "Podaj wynik kości Psionic Energy.");
    spendPsi(db, f, body.roll);
    target.psiReduction = Math.max(1, body.roll + f.psiInt);
    f.reaction = 'Protective Field';
    log(b, `${f.name}: Protective Field → ${target.name}, redukcja ${target.psiReduction}.`);
  } else {
    check(!b.pending && f.id === b.fighters[b.turn].id, 'Wymagana własna tura bez rozpoczętego działania.');
    const state = resourceState(db, f.characterId);
    if (body.kind === 'restore-telekinetic-movement') {
      check(!f.telekineticMovementAvailable, 'Telekinetic Movement jest już dostępne.');
      spendPsi(db, f);
      const updated = resourceState(db, f.characterId);
      updated.telekineticMovementAvailable = f.telekineticMovementAvailable = true;
      saveResources(db, f.characterId, updated);
    } else {
      check(!f.action && f.telekineticMovementAvailable && body.psiConfirmed === true
        && typeof body.description === 'string' && body.description.trim() && body.description.length <= 1000,
        'Wymagana akcja Magic, dostępne użycie i opis prawidłowego celu oraz miejsca.');
      f.action = 'Magic: Telekinetic Movement';
      state.telekineticMovementAvailable = f.telekineticMovementAvailable = false;
      saveResources(db, f.characterId, state);
      b.pending = { kind: 'request', actorId: f.id, slot: 'action', description: `Telekinetic Movement: ${body.description}` };
      log(b, `${f.name}: Telekinetic Movement — ${body.description}`);
    }
  }
  return true;
}
