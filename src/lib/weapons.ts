import type { InventoryItem } from '../api';

export function weaponDamage(item: InventoryItem): string | undefined {
  if (!item.weapon) return undefined;
  if (item.grip === 'two') {
    return item.weapon.properties.find(property => property.startsWith('wszechstronna ('))?.match(/\(([^)]+)\)/)?.[1] ?? item.weapon.damage;
  }
  return item.weapon.damage;
}
