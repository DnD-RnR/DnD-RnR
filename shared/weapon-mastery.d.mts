export type WeaponMasteryWeapon = {
  id: string;
  name: string;
  category: 'simple' | 'martial';
  type: 'wręczna' | 'dystansowa';
  damage: string;
  damageType: string;
  range: string;
  weight: number | null;
  cost: string;
  properties: string[];
  mastery: string;
};
export const masteryProperties: Record<string, string>;
export function weaponMasteryCount(character: { class: string; level: number }): number;
export function weaponMasteryChoicesValid(character: { class: string; level: number }, values: unknown): boolean;
export function weaponById(id: string): WeaponMasteryWeapon | undefined;
export const weapons: WeaponMasteryWeapon[];
