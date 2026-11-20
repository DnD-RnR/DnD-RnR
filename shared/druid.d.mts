export const druidForms: { id: string; name: string; cr: number; size: string; ac: number; speed: number; climb?: number; swim?: number; fly?: number; darkvision?: number; str: number; dex: number; con: number; skills?: Record<string, number>; saves?: string[]; attack: { name: string; bonus: number; dice: number; sides: number; damageBonus: number; type: string; ability?: string }; notes?: string }[];
export function isDruid(character: { class?: string }): boolean;
export function druidProfile(character: { class?: string; level: number; subclass?: string }): { enabled: boolean; max: number; knownForms: number; maxCR: number; flying: boolean; durationHours: number; circleOfTheMoon: boolean; temporaryHitPoints: number; wildShapeSpells: string[]; beastSpells: boolean; archdruid: boolean };

export function isMoonDruid(character: { class?: string; level: number; subclass?: string }): boolean;
export function moonSpells(character: { class?: string; level: number; subclass?: string }): string[];
export function eligibleDruidForms(character: { class?: string; level: number; subclass?: string }): typeof druidForms;
export function landWard(character: { class?: string; level: number; subclass?: string }, choices?: Record<string, string>): { resistance: string | null } | null;
