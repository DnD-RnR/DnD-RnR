type PsiCharacter = { class: string; subclass?: string; level: number };
type PsiState = { psiUses?: number; telekineticMovementAvailable?: boolean };
export type PsiResources = { psiMax: number; psiSides: number; psiUses: number; telekineticMovementAvailable: boolean };
export function psiWarrior(character: PsiCharacter): boolean;
export function psiResources(character: PsiCharacter, state: PsiState): PsiResources;
export function restPsi(character: PsiCharacter, state: PsiState, rest: string): void;
