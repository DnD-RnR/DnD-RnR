export const elvenLineages: { id: string; label: string; spells: string[] }[];
export function speciesSaveAdvantage(f: { species?: string }, ability?: string, condition?: string): boolean;
export function speciesD20(f: { species?: string }, roll: number, reroll?: number): number;
export function speciesResistances(species: string): string[];
export const speciesNotes: Record<string, [string, string][]>;
