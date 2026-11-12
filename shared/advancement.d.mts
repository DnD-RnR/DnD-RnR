import type { Character, CharacterStatistics } from '../src/api';
export type AdvancementDraft = { subclass?: string; hpMode?: 'fixed' | 'roll'; hpRoll?: number | null; featMode?: 'asi' | 'feat'; feat?: string; increases?: Record<string, number>; spells?: CharacterStatistics['spells']; traits?: CharacterStatistics['traits']; choices?: CharacterStatistics['choices'] };
export const advancementSource: string;
export function hasLevelFeat(character: Character): boolean;
export function levelFeatOptions(character: Character, statistics: CharacterStatistics): import('./origin-feats.mjs').OriginFeat[];
export function advancementPreview(character: Character, statistics: CharacterStatistics, draft: AdvancementDraft): { character: Character; statistics: CharacterStatistics; hpGain: number | null; hitDie: number | null; features: import('./character-traits.mjs').TraitProfile['features'] };
