import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySpellSelection, spellcastingProfile, validateSpellSelection } from '../shared/spellcasting.mjs';
import classes from '../shared/character-options.json' with { type: 'json' };

const character = (className, level, subclass = '') => ({ class: className, level, subclass });
const selection = (selections, choices = {}) => ({ choices, selections });
const group = (profile, id) => profile.groups.find(group => group.id === id);

test('spellcasting profiles cover every supported class, subclass and level without granting unavailable spell levels', () => {
  for (const entry of classes.classes) for (const subclass of ['', ...entry.subclasses]) for (let level = subclass ? 3 : 1; level <= 20; level++) {
    const hero = character(entry.name, level, subclass);
    const profile = spellcastingProfile(hero);
    assert.equal(validateSpellSelection(hero, emptySpellSelection()), null);
    for (const choice of profile.groups) {
      assert.equal(new Set(choice.options.map(spell => spell.id)).size, choice.options.length);
      if (choice.id === 'prepared') for (const spell of choice.options) {
        const max = profile.pactSlotLevel || profile.slots.reduce((highest, count, index) => count ? index + 1 : highest, 0);
        assert.ok(spell.level >= 1 && spell.level <= max);
      }
    }
  }
});

test('2024 class limits distinguish cantrips, prepared spells and slots', () => {
  const fixtures = [
    ['Bard', 1, 2, 4], ['Bard', 20, 4, 22],
    ['Kleryk (Cleric)', 1, 3, 4], ['Kleryk (Cleric)', 20, 5, 22],
    ['Druid', 1, 2, 4], ['Druid', 20, 4, 22],
    ['Paladyn (Paladin)', 1, 0, 2], ['Paladyn (Paladin)', 20, 0, 15],
    ['Łowca (Ranger)', 1, 0, 2], ['Łowca (Ranger)', 20, 0, 15],
    ['Zaklinacz (Sorcerer)', 1, 4, 2], ['Zaklinacz (Sorcerer)', 20, 6, 22],
    ['Czarnoksiężnik (Warlock)', 1, 2, 2], ['Czarnoksiężnik (Warlock)', 20, 4, 15],
    ['Czarodziej (Wizard)', 1, 3, 4], ['Czarodziej (Wizard)', 20, 5, 25],
  ];
  for (const [name, level, cantrips, prepared] of fixtures) {
    const profile = spellcastingProfile(character(name, level));
    assert.equal(group(profile, 'cantrips')?.limit ?? 0, cantrips);
    assert.equal(group(profile, 'prepared').limit, prepared);
  }
  const bard = character('Bard', 1);
  assert.equal(validateSpellSelection(bard, selection({ cantrips: ['light', 'vicious-mockery'], prepared: ['cure-wounds', 'healing-word', 'sleep', 'detect-magic'] })), null);
  assert.match(validateSpellSelection(bard, selection({ cantrips: ['light', 'vicious-mockery', 'mage-hand'] })), /limit/);
  assert.ok(validateSpellSelection(bard, selection({ prepared: ['fireball'] })));
  assert.ok(validateSpellSelection(bard, selection({ prepared: ['shield'] })));
  assert.ok(validateSpellSelection(bard, selection({ prepared: ['sleep', 'sleep'] })));
  assert.equal(spellcastingProfile(bard).slots[0], 2);
});

test('noncasters, third casters and optional magical class choices use their own limits', () => {
  assert.equal(spellcastingProfile(character('Wojownik (Fighter)', 20, 'Champion')).groups.length, 0);
  assert.ok(validateSpellSelection(character('Wojownik (Fighter)', 20, 'Champion'), selection({ prepared: ['shield'] })));
  const knight = spellcastingProfile(character('Wojownik (Fighter)', 3, 'Eldritch Knight'));
  assert.equal(group(knight, 'cantrips').limit, 2);
  assert.equal(group(knight, 'prepared').limit, 3);
  assert.equal(spellcastingProfile(character('Wojownik (Fighter)', 2, 'Eldritch Knight')).groups.length, 0);
  const trickster = spellcastingProfile(character('Łotrzyk (Rogue)', 3, 'Arcane Trickster'));
  assert.ok(trickster.automatic.some(spell => spell.id === 'mage-hand'));
  assert.equal(group(trickster, 'cantrips').limit, 2);
  assert.ok(!group(trickster, 'cantrips').options.some(spell => spell.id === 'mage-hand'));
  assert.equal(group(spellcastingProfile(character('Kleryk (Cleric)', 1), selection({}, { order: 'magic' })), 'cantrips').limit, 4);
  const ranger = character('Łowca (Ranger)', 2);
  assert.equal(validateSpellSelection(ranger, selection({ styleCantrips: ['guidance', 'druidcraft'] }, { style: 'magic' })), null);
  assert.ok(validateSpellSelection(ranger, selection({ styleCantrips: ['guidance', 'druidcraft'] })));
});

test('six level-two prepared spells are legal with four level-one slots and two level-two slots', () => {
  const bard = character('Bard', 3);
  const profile = spellcastingProfile(bard);
  assert.deepEqual(profile.slots.slice(0, 2), [4, 2]);
  const levelTwoSpells = group(profile, 'prepared').options.filter(spell => spell.level === 2).slice(0, 7).map(spell => spell.id);
  assert.equal(levelTwoSpells.length, 7);
  assert.equal(validateSpellSelection(bard, selection({ prepared: levelTwoSpells.slice(0, 6) })), null);
  assert.match(validateSpellSelection(bard, selection({ prepared: levelTwoSpells })), /limit wynosi 6/);
});

test('always-prepared subclass spells do not consume or duplicate ordinary prepared choices', () => {
  const cleric = character('Kleryk (Cleric)', 5, 'Light Domain');
  const profile = spellcastingProfile(cleric);
  assert.ok(profile.automatic.some(spell => spell.id === 'fireball'));
  assert.equal(group(profile, 'prepared').limit, 9);
  assert.ok(!group(profile, 'prepared').options.some(spell => spell.id === 'fireball'));
  assert.ok(validateSpellSelection(cleric, selection({ prepared: ['fireball'] })));
  const land = spellcastingProfile(character('Druid', 3, 'Circle of the Land'), selection({}, { land: 'arid' }));
  assert.ok(land.automatic.some(spell => spell.id === 'fire-bolt'));
  assert.ok(!land.automatic.some(spell => spell.id === 'fireball'));
  assert.ok(spellcastingProfile(character('Mnich (Monk)', 3, 'Warrior of Shadow')).automatic.some(spell => spell.id === 'darkness'));
  assert.ok(spellcastingProfile(character('Barbarzyńca (Barbarian)', 10, 'Path of the Wild Heart')).automatic.some(spell => spell.id === 'commune-with-nature'));
});

test('Tiefling Fiendish Legacy grants the selected spells and spellcasting ability', () => {
  const tiefling = { ...character('Bard', 5), species: 'Diabelstwo (Tiefling)' };
  const profile = spellcastingProfile(tiefling, emptySpellSelection(), { tieflingLegacy: ['infernal'], tieflingSpellAbility: ['cha'] });
  assert.equal(profile.ability, 'cha');
  assert.deepEqual(profile.automatic.map(spell => spell.id).sort(), ['darkness', 'fire-bolt', 'hellish-rebuke', 'thaumaturgy'].sort());
  assert.ok(!group(profile, 'cantrips').options.some(spell => spell.id === 'fire-bolt'));
});

test('Wizard spellbook can grow by copying while prepared spells must belong to it', () => {
  const wizard = character('Czarodziej (Wizard)', 1);
  const book = ['alarm', 'burning-hands', 'charm-person', 'color-spray', 'comprehend-languages', 'detect-magic', 'disguise-self'];
  assert.equal(validateSpellSelection(wizard, selection({ book, prepared: book.slice(0, 4) })), null);
  assert.ok(validateSpellSelection(wizard, selection({ book, prepared: book.slice(0, 5) })));
  assert.ok(validateSpellSelection(wizard, selection({ book, prepared: ['shield'] })));
  assert.ok(validateSpellSelection(wizard, selection({ book: ['fireball'] })));
  const master = character('Czarodziej (Wizard)', 20);
  assert.equal(validateSpellSelection(master, selection({ book: ['magic-missile', 'mirror-image', 'fireball', 'fly'], mastery1: ['magic-missile'], mastery2: ['mirror-image'], signature: ['fireball', 'fly'] })), null);
  assert.ok(validateSpellSelection(master, selection({ book: ['shield'], mastery1: ['shield'] })));
});

test('Warlock Mystic Arcanum is separate from pact spells and unlocks at the right levels', () => {
  const warlock = character('Czarnoksiężnik (Warlock)', 11);
  const profile = spellcastingProfile(warlock);
  assert.equal(profile.pactSlotLevel, 5);
  assert.equal(group(profile, 'prepared').limit, 11);
  assert.equal(group(profile, 'arcanum6').limit, 1);
  assert.equal(group(profile, 'arcanum7'), undefined);
  const arcanum = group(profile, 'arcanum6').options[0].id;
  assert.equal(validateSpellSelection(warlock, selection({ arcanum6: [arcanum] })), null);
  assert.ok(validateSpellSelection(warlock, selection({ prepared: [arcanum] })));
  assert.ok(validateSpellSelection(character('Czarnoksiężnik (Warlock)', 10), selection({ arcanum6: [arcanum] })));
  assert.ok(group(spellcastingProfile(character('Czarnoksiężnik (Warlock)', 17)), 'arcanum9'));
});

test('Magical Secrets and Magical Discoveries unlock additional class lists at their thresholds', () => {
  assert.ok(!group(spellcastingProfile(character('Bard', 9)), 'prepared').options.some(spell => spell.id === 'fireball'));
  assert.ok(group(spellcastingProfile(character('Bard', 10)), 'prepared').options.some(spell => spell.id === 'fireball'));
  const lore = character('Bard', 6, 'College of Lore');
  assert.equal(validateSpellSelection(lore, selection({ lore: ['fireball', 'guidance'] })), null);
  assert.ok(validateSpellSelection(character('Bard', 5, 'College of Lore'), selection({ lore: ['fireball'] })));
});

test('malformed and invented spell selection categories are rejected safely', () => {
  for (const invalid of [null, [], {}, { choices: {}, selections: { prepared: 'sleep' } }, { choices: {}, selections: { prepared: [null] } }, selection({ injected: [] }), selection({}, { injected: 'magic' })]) {
    assert.ok(validateSpellSelection(character('Bard', 1), invalid));
  }
});
