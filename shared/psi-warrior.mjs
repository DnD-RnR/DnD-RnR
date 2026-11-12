export const psiWarrior = c => c?.class?.includes('Fighter') && c.subclass === 'Psi Warrior' && c.level >= 3;
export function psiResources(c, state) {
  // Only the level-three feature is implemented; its resource table still scales.
  const max = !psiWarrior(c) ? 0 : c.level >= 17 ? 12 : c.level >= 13 ? 10 : c.level >= 9 ? 8 : c.level >= 5 ? 6 : 4;
  return { psiMax: max, psiSides: c.level >= 17 ? 12 : c.level >= 11 ? 10 : c.level >= 5 ? 8 : 6,
    psiUses: Math.max(0, Math.min(max, state.psiUses ?? max)), telekineticMovementAvailable: max > 0 && state.telekineticMovementAvailable !== false };
}
export function restPsi(c, state, rest) {
  const p = psiResources(c, state);
  if (!p.psiMax) return;
  state.psiUses = rest === 'long' ? p.psiMax : Math.min(p.psiMax, p.psiUses + 1);
  state.telekineticMovementAvailable = true;
}
