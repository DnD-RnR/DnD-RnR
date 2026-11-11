export type Spell = { id: string; name: string; level: number; classes: string[]; castingTime: string; url: string; description?: string };
export type SpellSelection = { choices: Record<string, string>; selections: Record<string, string[]> };
export type SpellGroup = { id: string; label: string; limit: number | null; options: Spell[]; fromBook: boolean; hint: string };
export type SpellcastingProfile = {
  ability: string; source: string; groups: SpellGroup[]; automatic: (Spell & { reason: string })[];
  choices: { id: string; label: string; options: { id: string; label: string }[] }[];
  slots: number[]; pactSlotLevel: number;
};
type Character = { class: string; level: number; subclass: string };
export function emptySpellSelection(): SpellSelection;
export const spellById: Map<string, Spell>;
export function spellcastingProfile(character: Character, selection?: SpellSelection, traits?: Record<string, string[]>): SpellcastingProfile;
export function validateSpellSelection(character: Character, selection: SpellSelection): string | null;
