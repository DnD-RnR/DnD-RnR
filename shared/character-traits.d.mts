import type { CharacterStatistics, Character } from '../src/api';
export type TraitSelection = Record<string, string[]>;
export type TraitGroup = { id: string; label: string; limit: number; options: { id: string; label: string }[]; kind: string };
export type TraitProfile = {
  classId: string; source: string; groups: TraitGroup[]; skills: Record<string, number>; effectiveSkills: Record<string, number>;
  savingThrows: string[]; effectiveSavingThrows: string[]; skillSources: Record<string, string>; skillBonuses: Record<string, number | null>;
  languages: { id: string; label: string; standard: boolean }[]; tools: string[]; armor: string[]; weapons: string[]; feats: string[];
  features: { level: number; name: string; url: string; source: string }[];
  hitDie: number | null; hitDiceTotal: number; baseSpeed: number | null; senses: string[]; defenses: string[];
  resources: { name: string; value: string }[]; hpBonus: number; firstLevelMaxHp: number | null; initiativeBonus: number;
};
export function emptyTraitSelection(): TraitSelection;
export function characterTraits(character: Pick<Character, 'class' | 'subclass' | 'level' | 'species' | 'background'>, statistics: CharacterStatistics): TraitProfile;
export function validateTraitSelection(character: Pick<Character, 'class' | 'subclass' | 'level' | 'species' | 'background'>, statistics: CharacterStatistics): string | null;
