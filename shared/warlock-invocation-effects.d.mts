import type { Spell } from './spellcasting.mjs';
export const invocationDescriptions: Record<string, string>;
export type InvocationSheetEntry = { id: string; name: string; source: string; url: string; description: string; details: string[]; spells: Spell[] };
export function invocationSheet(character: { class: string; level: number }, stats: { traits?: Record<string, string[]>; spells?: { selections?: Record<string, string[]> }; values?: Record<string, number | null> }): InvocationSheetEntry[];
