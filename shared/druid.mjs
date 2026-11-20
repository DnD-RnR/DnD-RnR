import { damageTypeName } from './warlock.mjs';
import subclassSpells from './subclass-spells.json' with { type: 'json' };

// 2024 Beast stat blocks: https://www.aidedd.org/monster/{id}
export const druidForms = [
  { id: 'rat', name: 'Rat', cr: 0, size: 'tiny', ac: 10, speed: 20, climb: 20, darkvision: 30, str: 2, dex: 11, con: 9, skills: { perception: 1 }, attack: { name: 'Bite', bonus: 2, dice: 0, sides: 0, damageBonus: 1, type: 'kłute' }, notes: 'Agile: ruch poza zasięg wroga nie prowokuje Opportunity Attack.' },
  { id: 'riding-horse', name: 'Riding Horse', cr: 0.25, size: 'large', ac: 11, speed: 60, str: 16, dex: 13, con: 12, attack: { name: 'Hooves', bonus: 5, dice: 1, sides: 8, damageBonus: 3, type: 'obuchowe' } },
  { id: 'spider', name: 'Spider', cr: 0, size: 'tiny', ac: 12, speed: 20, climb: 20, darkvision: 30, str: 2, dex: 14, con: 8, skills: { stealth: 1 }, attack: { name: 'Bite', bonus: 4, dice: 0, sides: 0, damageBonus: 1, type: 'kłute' }, notes: 'Spider Climb; Web Walker. Bite zadaje dodatkowo 1k4 trucizny (rozstrzyga GM).' },
  { id: 'wolf', name: 'Wolf', cr: 0.25, size: 'medium', ac: 12, speed: 40, darkvision: 60, str: 14, dex: 15, con: 12, skills: { perception: 2, stealth: 1 }, attack: { name: 'Bite', bonus: 4, dice: 1, sides: 6, damageBonus: 2, type: 'kłute' }, notes: 'Pack Tactics: ułatwienie z sojusznikiem przy celu. Bite powala cel Medium lub mniejszy (rozstrzyga GM).' },
  { id: 'cat', name: 'Cat', cr: 0, size: 'tiny', ac: 12, speed: 40, climb: 40, darkvision: 60, str: 3, dex: 15, con: 10, saves: ['dex'], skills: { perception: 1, stealth: 1 }, attack: { name: 'Scratch', bonus: 4, dice: 0, sides: 0, damageBonus: 1, type: 'cięte' }, notes: 'Jumper: skoki używają Zręczności.' },
];
druidForms.push({ id: 'dire-wolf', name: 'Dire Wolf', cr: 1, size: 'large', ac: 14, speed: 50, darkvision: 60, str: 17, dex: 15, con: 15, skills: { perception: 2, stealth: 1 }, attack: { name: 'Bite', bonus: 5, dice: 1, sides: 10, damageBonus: 3, type: 'kłute' }, notes: 'Pack Tactics; Bite powala cel Large lub mniejszy (rozstrzyga GM).' });
// Additional beast statistics from SRD 5.2.1, Animals.
druidForms.push(
  { id: 'crocodile', name: 'Crocodile', cr: 0.5, size: 'large', ac: 12, speed: 20, swim: 30, str: 15, dex: 10, con: 13, saves: ['con'], skills: { stealth: 1 }, attack: { name: 'Bite', bonus: 4, dice: 1, sides: 8, damageBonus: 2, type: 'kłute', ability: 'str' }, notes: 'Bite: chwyt i Restrained dla celu Medium lub mniejszego, ST ucieczki 12 (rozlicza MG).' },
  { id: 'deer', name: 'Deer', cr: 0, size: 'medium', ac: 13, speed: 50, darkvision: 60, str: 11, dex: 16, con: 11, skills: { perception: 1 }, attack: { name: 'Ram', bonus: 2, dice: 1, sides: 4, damageBonus: 0, type: 'obuchowe', ability: 'str' }, notes: 'Agile: opuszczenie zasięgu wroga nie prowokuje ataku okazyjnego.' },
  { id: 'eagle', name: 'Eagle', cr: 0, size: 'small', ac: 12, speed: 10, fly: 60, str: 6, dex: 15, con: 12, skills: { perception: 2 }, attack: { name: 'Talons', bonus: 4, dice: 1, sides: 4, damageBonus: 2, type: 'cięte' } },
  { id: 'giant-bat', name: 'Giant Bat', cr: 0.25, size: 'large', ac: 13, speed: 10, fly: 60, str: 15, dex: 16, con: 11, attack: { name: 'Bite', bonus: 5, dice: 1, sides: 6, damageBonus: 3, type: 'kłute' }, notes: 'Blindsight 120 stóp.' },
  { id: 'giant-boar', name: 'Giant Boar', cr: 2, size: 'large', ac: 13, speed: 40, str: 17, dex: 10, con: 16, saves: ['str'], attack: { name: 'Gore', bonus: 5, dice: 2, sides: 6, damageBonus: 3, type: 'kłute', ability: 'str' }, notes: 'Bloodied Fury i szarżę rozlicza MG.' },
);

export const isDruid = character => character?.class === 'Druid';
export const isMoonDruid = character => isDruid(character) && character.level >= 3 && character.subclass === 'Circle of the Moon';
export const moonSpells = character => isMoonDruid(character) ? subclassSpells['Circle of the Moon'].variants[0].flatMap(entry => character.level >= entry.level ? entry.spells : []) : [];
export const druidProfile = character => {
  const enabled = isDruid(character), level = character?.level ?? 0;
  return { enabled, max: enabled && level >= 2 ? level >= 17 ? 4 : level >= 6 ? 3 : 2 : 0,
    knownForms: enabled && level >= 2 ? level >= 8 ? 8 : level >= 4 ? 6 : 4 : 0,
    maxCR: isMoonDruid(character) ? Math.floor(level / 3) : level >= 8 ? 1 : level >= 4 ? 0.5 : 0.25, flying: enabled && level >= 8, durationHours: level / 2,
    circleOfTheMoon: isMoonDruid(character), temporaryHitPoints: enabled && level >= 2 ? level * (isMoonDruid(character) ? 3 : 1) : 0,
    beastSpells: enabled && level >= 18, archdruid: enabled && level >= 20,
    wildShapeSpells: moonSpells(character) };
};
export function eligibleDruidForms(character) {
  const profile = druidProfile(character);
  return druidForms.filter(form => profile.max && form.cr <= profile.maxCR && (!form.fly || profile.flying));
}

export function canCastInWildShape(character, spell) {
  if (!spell || !isDruid(character)) return false;
  if (moonSpells(character).includes(spell.id)) return true;
  return character.level >= 18 && !/\bM\s*\(.*(?:\b(?:GP|SP|CP|PP|EP)\b|consum)/i.test(spell.components);
}

export function druidCantripRange(character, spell, choices) {
  if (!isDruid(character) || character.level < 15 || choices?.elementalFury !== 'potent' || spell.level !== 0 ) return spell.range;
  const match = /^(\d+) feet\b/i.exec(spell.range);
  return match && Number(match[1]) >= 10 ? spell.range.replace(match[0], `${Number(match[1]) + 300} feet`) : spell.range;
}

export const isLandDruid = character => isDruid(character) && character.subclass === 'Circle of the Land';

export function landWard(character, choices) {
  if (!isLandDruid(character) || character.level < 10) return null;
  const type = ({ arid: 'Fire', polar: 'Cold', temperate: 'Lightning', tropical: 'Poison' })[choices?.land];
  return { resistance: type ? damageTypeName(type) : null };
}
