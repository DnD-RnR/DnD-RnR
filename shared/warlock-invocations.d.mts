type Character = { class: string; level: number };
type Statistics = { traits?: Record<string, string[]>; spells?: { selections?: Record<string, string[]> } };
export const invocationSource: string;
export const invocations: { id: string; name: string; level: number; requires: string; target: string; source: string }[];
export function invocationCount(character: Character): number;
export function invocationOptions(character: Character, stats: Statistics): { id: string; label: string }[];
export function tomeOptions(character: Character & { subclass?: string }, stats: Statistics): import('./spellcasting.mjs').Spell[];
