export type RageProfile = { berserker: boolean; wildHeart: boolean; max: number; damage: number; dangerSense: boolean; recklessAttack: boolean; primalKnowledge: boolean; instinctivePounce: boolean; relentless: boolean; persistent: boolean };
type BarbarianFighter = { rage?: unknown; rageProfile?: Partial<RageProfile>; incapacitated?: boolean; unconscious?: boolean; hp: number; recklessActive?: boolean };
export function barbarianSaveAdvantage(fighter: BarbarianFighter, ability: string | undefined): boolean;
export function barbarianAttackAdvantage(actor: Pick<BarbarianFighter, 'recklessActive'>, target: Pick<BarbarianFighter, 'recklessActive'> | undefined, ability?: string): boolean;
export const dangerSenseDescription: string;
export const recklessAttackDescription: string;
export function rageProfile(character: { class: string; level: number; subclass?: string }): RageProfile;
export function rageDescription(character: { class: string; level: number; subclass?: string }): string;
export const primalSkills: string[];
export const rageDamageTypes: string[];

export const wildHeartAnimals: string[];
export function barbarianResistance(fighter: { rage?: { animal?: string } | null }, type?: string): boolean;
export function wolfAttackAdvantage(battle: any, actor: any, target: any): boolean;
export function frenzyDice(battle: any, actor: any, ability?: string): number;

export const barbarianLevel3Features: { primalKnowledge: { level: number; skillChoices: string[]; strengthSkills: string[] }; berserker: { level: number; name: string; description: string }; wildHeart: { level: number; name: string; options: { id: string; description: string }[]; rituals: string[]; spellcastingAbility: string } };
