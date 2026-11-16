import { randomUUID } from 'node:crypto';

// Instantaneous spell aftermath is independent of concentration and its caster.
// The battle record persists this queue across refreshes and server restarts.
export function scheduleSpellDamage(b, source, target, pending) {
  const delayed = pending.spec.delayed;
  if (!delayed || pending.missed || pending.targets.find(t => t.id === target.id)?.saved) return;
  b.delayedSpellDamage ??= [];
  b.delayedSpellDamage.push({
    id: randomUUID(), sourceId: source.id, sourceName: source.name,
    targetId: target.id, spellId: pending.spellId, spellName: pending.spellName,
    dice: delayed.dice + (pending.castingLevel - pending.spellLevel) * (delayed.perLevel ?? 0),
    sides: delayed.sides, type: pending.spec.type,
    round: b.round + (b.fighters.indexOf(target) <= b.turn ? 1 : 0),
  });
}

export function dueSpellDamage(b, fighter) {
  return (b.delayedSpellDamage ?? []).filter(e => e.targetId === fighter.id && e.round <= b.round);
}

export function beginDelayedSpellDamage(b, fighter, effectId) {
  if (b.pending || b.suspendedAction) throw new Error('Najpierw rozstrzygnij rozpoczęte działanie.');
  const effect = dueSpellDamage(b, fighter).find(e => !effectId || e.id === effectId);
  if (!effect) return false;
  fighter.spellTurnEnded = b.round;
  b.pending = {
    kind: 'spell', actorId: fighter.id, sourceId: effect.sourceId,
    delayedDamageId: effect.id, spellId: effect.spellId, spellName: effect.spellName,
    stage: 'effect', spec: { mode: 'save', dice: effect.dice, sides: effect.sides, type: effect.type, bonus: 0 },
    targets: [{ id: fighter.id }],
  };
  return true;
}

export function syncDelayedSpellDamage(b) {
  b.delayedSpellDamage = (b.delayedSpellDamage ?? []).filter(e => b.fighters.some(f => f.id === e.targetId && f.deathFailures < 3 && (f.characterId || f.hp > 0)));
}
