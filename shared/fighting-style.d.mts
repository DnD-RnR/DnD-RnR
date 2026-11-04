export type FightingStyle = { id: string; name: string; description: string };
export const fightingStyles: FightingStyle[];
export function fightingStyleCount(character: { class: string }): number;
export function fightingStyleChoicesValid(character: { class: string }, value: unknown): boolean;
