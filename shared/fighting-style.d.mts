export type FightingStyle = { id: string; name: string; description: string };
export type FightingStyleCantrip = { id: string; name: string; level: number; classes: string[]; castingTime: string; url: string; description?: string };
export const fightingStyles: FightingStyle[];
export const wizardCantrips: FightingStyleCantrip[];
export function fightingStyleCount(character: { class: string }): number;
export function fightingStyleChoicesValid(character: { class: string }, value: unknown): boolean;
export function fightingStyleAttackBonus(fightingStyle: string, weapon: { type: string; properties?: readonly string[] } | null | undefined): number;
export function fightingStyleDamageBonus(fightingStyle: string, weapon: { type: string; slot?: string; grip?: string; properties?: readonly string[] } | null | undefined, equippedWeapons?: readonly { slot?: string }[], abilityModifier?: number): number;
export function unarmedStrikeProfile(fightingStyle: string, equippedWeapons?: readonly { slot?: string }[], hasShield?: boolean, abilityModifier?: number): { dice: number; sides: number; damageBonus: number };
