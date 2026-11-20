export type FightingStyle = { id: string; name: string; description: string };
export type FightingStyleCantrip = { id: string; name: string; level: number; classes: string[]; castingTime: string; url: string; description?: string };
export const fightingStyles: FightingStyle[];
export const wizardCantrips: FightingStyleCantrip[];
export function fightingStyleCount(character: { class: string; level?: number; subclass?: string }): number;
export function fightingStyleChoicesValid(character: { class: string; level?: number; subclass?: string }, value: unknown): boolean;
export function fightingStyleAttackBonus(fightingStyle: string | string[], weapon: { type: string; properties?: readonly string[] } | null | undefined): number;
export function fightingStyleDamageBonus(fightingStyle: string | string[], weapon: { type: string; slot?: string; grip?: string; properties?: readonly string[] } | null | undefined, equippedWeapons?: readonly { slot?: string }[], abilityModifier?: number): number;
export function unarmedStrikeProfile(fightingStyle: string | string[], equippedWeapons?: readonly { slot?: string }[], hasShield?: boolean, abilityModifier?: number, tavernBrawler?: boolean): { dice: number; sides: number; damageBonus: number };

export function selectedFightingStyles(choices?: { fightingStyle?: string; additionalFightingStyle?: string }): string[];
export function additionalFightingStyleValid(character: { class: string; level?: number; subclass?: string }, primary: string, additional?: unknown): boolean;
