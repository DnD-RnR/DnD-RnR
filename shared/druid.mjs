// 2024 Beast stat blocks: https://www.aidedd.org/monster/{id}
export const druidForms = [
  { id: 'rat', name: 'Rat', cr: 0, size: 'tiny', ac: 10, speed: 20, climb: 20, darkvision: 30, str: 2, dex: 11, con: 9, skills: { perception: 1 }, attack: { name: 'Bite', bonus: 2, dice: 0, sides: 0, damageBonus: 1, type: 'kłute' }, notes: 'Agile: ruch poza zasięg wroga nie prowokuje Opportunity Attack.' },
  { id: 'riding-horse', name: 'Riding Horse', cr: 0.25, size: 'large', ac: 11, speed: 60, str: 16, dex: 13, con: 12, attack: { name: 'Hooves', bonus: 5, dice: 1, sides: 8, damageBonus: 3, type: 'obuchowe' } },
  { id: 'spider', name: 'Spider', cr: 0, size: 'tiny', ac: 12, speed: 20, climb: 20, darkvision: 30, str: 2, dex: 14, con: 8, skills: { stealth: 1 }, attack: { name: 'Bite', bonus: 4, dice: 0, sides: 0, damageBonus: 1, type: 'kłute' }, notes: 'Spider Climb; Web Walker. Bite zadaje dodatkowo 1k4 trucizny (rozstrzyga GM).' },
  { id: 'wolf', name: 'Wolf', cr: 0.25, size: 'medium', ac: 12, speed: 40, darkvision: 60, str: 14, dex: 15, con: 12, skills: { perception: 2, stealth: 1 }, attack: { name: 'Bite', bonus: 4, dice: 1, sides: 6, damageBonus: 2, type: 'kłute' }, notes: 'Pack Tactics: ułatwienie z sojusznikiem przy celu. Bite powala cel Medium lub mniejszy (rozstrzyga GM).' },
  { id: 'cat', name: 'Cat', cr: 0, size: 'tiny', ac: 12, speed: 40, climb: 40, darkvision: 60, str: 3, dex: 15, con: 10, saves: ['dex'], skills: { perception: 1, stealth: 1 }, attack: { name: 'Scratch', bonus: 4, dice: 0, sides: 0, damageBonus: 1, type: 'cięte' }, notes: 'Jumper: skoki używają Zręczności.' },
];
druidForms.push({ id: 'dire-wolf', name: 'Dire Wolf', cr: 1, size: 'large', ac: 14, speed: 50, darkvision: 60, str: 17, dex: 15, con: 15, skills: { perception: 2, stealth: 1 }, attack: { name: 'Bite', bonus: 5, dice: 1, sides: 10, damageBonus: 3, type: 'kłute' }, notes: 'Pack Tactics; Bite powala cel Large lub mniejszy (rozstrzyga GM).' });
export const isDruid = character => character?.class === 'Druid';
export const isMoonDruid = character => isDruid(character) && character.level >= 3 && character.subclass === 'Circle of the Moon';
export const moonSpells = character => isMoonDruid(character) ? ['cure-wounds', 'moonbeam', 'starry-wisp'] : [];
export const druidProfile = character => {
  const enabled = isDruid(character), level = character?.level ?? 0;
  return { enabled, max: enabled && level >= 2 ? 2 : 0, knownForms: enabled && level >= 2 ? 4 : 0,
    maxCR: isMoonDruid(character) ? Math.floor(level / 3) : 0.25, flying: false, durationHours: level / 2,
    circleOfTheMoon: isMoonDruid(character), temporaryHitPoints: enabled && level >= 2 ? level * (isMoonDruid(character) ? 3 : 1) : 0,
    wildShapeSpells: moonSpells(character) };
};
export const eligibleDruidForms = character => druidForms.filter(form => druidProfile(character).max && form.cr <= druidProfile(character).maxCR && !form.fly);
