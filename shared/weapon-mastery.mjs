import data from './trait-data.json' with { type: 'json' };
import weapons from './weapon-catalog.json' with { type: 'json' };

export const masteryProperties = {
  Cleave: 'Po trafieniu atakiem wręcz możesz wykonać atak przeciwko drugiej istocie w zasięgu.',
  Graze: 'Przy chybieniu zadajesz obrażenia równe modyfikatorowi cechy użytej do ataku.',
  Nick: 'Dodatkowy atak bronią lekką może być częścią akcji Atak zamiast akcji bonusowej.',
  Push: 'Po trafieniu możesz odepchnąć istotę do 10 stóp.',
  Sap: 'Po trafieniu istota ma utrudnienie do następnego rzutu na atak.',
  Slow: 'Po zadaniu obrażeń zmniejszasz szybkość istoty o 10 stóp.',
  Topple: 'Po trafieniu możesz zmusić istotę do rzutu obronnego na Kondycję; przy porażce pada.',
  Vex: 'Po zadaniu obrażeń masz ułatwienie do następnego rzutu na atak przeciwko tej istocie.',
};

const classEntry = character => Object.values(data.classes).find(entry => entry.name === character.class);

export function weaponMasteryCount(character) {
  const resource = classEntry(character)?.resources?.find(entry => entry.name === 'Weapon Mastery');
  return Number(resource?.levels.find(entry => entry.level === character.level)?.value ?? 0);
}

export function weaponMasteryChoicesValid(character, values) {
  const count = weaponMasteryCount(character);
  return Array.isArray(values) && values.length <= count && new Set(values).size === values.length &&
    values.every(id => weapons.some(weapon => weapon.id === id));
}

export function weaponById(id) {
  return weapons.find(weapon => weapon.id === id);
}

export { weapons };
