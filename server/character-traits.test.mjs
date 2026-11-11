import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterTraits, validateTraitSelection } from '../shared/character-traits.mjs';
import { emptyStatistics } from './statistics.mjs';
import options from '../shared/character-options.json' with { type: 'json' };

const hero = (className, level = 1, background = '', species = '', subclass = '') => ({ class: className, level, background, species, subclass });
const group = (profile, id) => profile.groups.find(group => group.id === id);

test('core proficiencies, class hit dice and selected background skills are automatic for all classes', () => {
  const fixtures = [
    ['Barbarzyńca (Barbarian)', ['str', 'con'], 12, 2], ['Bard', ['dex', 'cha'], 8, 3],
    ['Kleryk (Cleric)', ['wis', 'cha'], 8, 2], ['Druid', ['int', 'wis'], 8, 2],
    ['Wojownik (Fighter)', ['str', 'con'], 10, 2], ['Mnich (Monk)', ['str', 'dex'], 8, 2],
    ['Paladyn (Paladin)', ['wis', 'cha'], 10, 2], ['Łowca (Ranger)', ['str', 'dex'], 10, 3],
    ['Łotrzyk (Rogue)', ['dex', 'int'], 8, 4], ['Zaklinacz (Sorcerer)', ['con', 'cha'], 6, 2],
    ['Czarnoksiężnik (Warlock)', ['wis', 'cha'], 8, 2], ['Czarodziej (Wizard)', ['int', 'wis'], 6, 2],
  ];
  for (const [name, saves, die, count] of fixtures) {
    const stats = emptyStatistics();
    const profile = characterTraits(hero(name, 1, 'Mędrzec (Sage)'), stats);
    assert.deepEqual(new Set(profile.savingThrows), new Set(saves));
    assert.equal(profile.hitDie, die);
    assert.equal(group(profile, 'classSkills').limit, count);
    assert.equal(profile.skills.arcana, 1);
    assert.equal(profile.skills.history, 1);
    assert.ok(profile.tools.includes("Calligrapher's Supplies"));
    assert.ok(profile.feats.includes('Magic Initiate (Wizard)'));
    assert.ok(profile.features.length > 0);
    assert.equal(stats.skills.arcana, 0, 'automatic grants must not overwrite manual data');
  }
});

test('languages follow 2024 origins rather than inferring an Elvish language from the Elf species', () => {
  const stats = emptyStatistics();
  const elf = hero('Łotrzyk (Rogue)', 1, '', 'Elf');
  let profile = characterTraits(elf, stats);
  assert.deepEqual(profile.languages.map(language => language.id), ['common', 'thieves-cant']);
  assert.equal(group(profile, 'languages').limit, 2);
  assert.equal(group(profile, 'classLanguages').limit, 1);
  stats.traits = { languages: ['elvish', 'dwarvish'], classLanguages: ['sylvan'], elfSkill: ['perception'] };
  assert.equal(validateTraitSelection(elf, stats), null);
  profile = characterTraits(elf, stats);
  assert.equal(profile.languages.length, 5);
  assert.equal(profile.skills.perception, 1);
  assert.ok(characterTraits(hero('Druid'), emptyStatistics()).languages.some(language => language.id === 'druidic'));
  assert.equal(group(characterTraits(hero('Łowca (Ranger)', 2), emptyStatistics()), 'classLanguages').limit, 2);
});

test('Orc has the species features, Medium size, and darkvision', () => {
  const profile = characterTraits(hero('Wojownik (Fighter)', 5, '', 'Ork (Orc)'), emptyStatistics());
  assert.equal(profile.size, 'Medium');
  assert.ok(profile.senses.includes('Widzenie w ciemności: 120 stóp (gatunek)'));
  assert.deepEqual(profile.features.filter(feature => feature.source === 'Ork (Orc)').map(feature => feature.name), [
    'Adrenaline Rush — Zryw jako akcja bonusowa; tymczasowe PW równe premii z biegłości',
    'Relentless Endurance — pozostajesz na 1 PW zamiast spaść do 0 PW',
  ]);
});

test('Dragonborn requires an ancestry and grants matching resistance and features', () => {
  const dragonborn = hero('Wojownik (Fighter)', 5, '', 'Smokowiec (Dragonborn)');
  const stats = emptyStatistics();
  let profile = characterTraits(dragonborn, stats);
  assert.equal(profile.size, 'Medium');
  assert.equal(profile.ancestry, null);
  assert.equal(validateTraitSelection(dragonborn, { ...stats, requireCompleteTraits: true }), 'Draconic Ancestry — przodek: wybierz 1 opcji.');
  stats.traits = { dragonbornAncestry: ['fire'] };
  profile = characterTraits(dragonborn, stats);
  assert.equal(profile.ancestry.damageType, 'ogień');
  assert.ok(profile.defenses.includes('Odporność na obrażenia: ogień.'));
  assert.ok(profile.features.some(feature => feature.name.includes('Breath Weapon')));
  assert.ok(profile.features.some(feature => feature.name.includes('Draconic Flight')));
  assert.equal(validateTraitSelection(dragonborn, { ...stats, requireCompleteTraits: true }), null);
});

test('Tiefling requires legacy, spellcasting ability, and size choices', () => {
  const tiefling = hero('Bard', 5, '', 'Diabelstwo (Tiefling)');
  const stats = emptyStatistics();
  assert.equal(characterTraits(tiefling, stats).size, 'Medium');
  assert.equal(validateTraitSelection(tiefling, { ...stats, requireCompleteTraits: true }).includes('Fiendish Legacy'), true);
  stats.traits = { tieflingLegacy: ['infernal'], tieflingSpellAbility: ['cha'], tieflingSize: ['small'] };
  const profile = characterTraits(tiefling, stats);
  assert.equal(profile.size, 'Small');
  assert.equal(profile.fiendishLegacy.damageType, 'ogień');
  assert.ok(profile.defenses.includes('Odporność na obrażenia: ogień.'));
  assert.ok(profile.features.some(feature => feature.name.includes('Otherworldly Presence')));
  assert.equal(validateTraitSelection(tiefling, { ...stats, requireCompleteTraits: true }), null);
});

test('Human grants the three species traits and requires the chosen size', () => {
  const human = hero('Wojownik (Fighter)', 1, '', 'Człowiek (Human)');
  const stats = emptyStatistics();
  assert.equal(characterTraits(human, stats).size, 'Medium');
  assert.match(validateTraitSelection(human, { ...stats, requireCompleteTraits: true }), /Human.*Skillful/);
  stats.traits = { humanSkill: ['perception'], humanFeat: ['Skilled'], humanSize: ['small'], skilled: ['skill:acrobatics', 'skill:athletics', 'tool:Dice'] };
  const profile = characterTraits(human, stats);
  assert.equal(profile.size, 'Small');
  assert.equal(profile.effectiveSkills.perception, 1);
  assert.equal(profile.effectiveSkills.acrobatics, 1);
  assert.ok(profile.tools.includes('Dice'));
  assert.deepEqual(profile.features.filter(feature => feature.source === 'Człowiek (Human)').map(feature => feature.name), [
    'Resourceful — Heroic Inspiration po długim odpoczynku',
    'Skillful — biegłość w jednej umiejętności',
    'Versatile — atut pochodzenia',
  ]);
  assert.equal(validateTraitSelection(human, { ...stats, requireCompleteTraits: true }), null);
});

test('limited choices reject invalid options, duplicates, extra picks and choices from other classes', () => {
  const fighter = hero('Wojownik (Fighter)', 1, 'Żołnierz (Soldier)');
  const stats = emptyStatistics();
  for (const traits of [{ languages: ['common'] }, { languages: ['elvish', 'elvish'] }, { languages: ['elvish', 'dwarvish', 'orc'] }, { classSkills: ['arcana'] }, { classSkills: ['athletics'] }, { classSkills: ['perception', 'insight', 'survival'] }, { expertise: ['perception'] }, { injected: [] }, null, [], { languages: 'elvish' }]) {
    assert.ok(validateTraitSelection(fighter, { ...stats, traits }));
  }
  stats.traits = { classSkills: ['perception', 'insight'], backgroundTool: ['Dice'] };
  assert.equal(validateTraitSelection(fighter, stats), null);
  assert.equal(characterTraits(fighter, stats).skills.athletics, 1);
});

test('expertise requires proficiency and unlocks with the right class and level', () => {
  const stats = emptyStatistics();
  stats.traits = { classSkills: ['perception', 'insight', 'stealth', 'sleightOfHand'], expertise: ['perception', 'stealth'] };
  assert.equal(validateTraitSelection(hero('Łotrzyk (Rogue)'), stats), null);
  assert.equal(characterTraits(hero('Łotrzyk (Rogue)'), stats).effectiveSkills.perception, 2);
  assert.ok(validateTraitSelection(hero('Łotrzyk (Rogue)'), { ...stats, traits: { ...stats.traits, expertise: ['arcana'] } }));
  assert.equal(group(characterTraits(hero('Łotrzyk (Rogue)', 6), stats), 'expertise').limit, 4);
  assert.equal(group(characterTraits(hero('Bard', 1), emptyStatistics()), 'expertise'), undefined);
  assert.equal(group(characterTraits(hero('Bard', 9), emptyStatistics()), 'expertise').limit, 4);
  const wizardStats = emptyStatistics();
  wizardStats.traits = { classSkills: ['arcana', 'insight'], expertise: ['insight'] };
  assert.ok(validateTraitSelection(hero('Czarodziej (Wizard)', 2), wizardStats));
  wizardStats.traits.expertise = ['arcana'];
  assert.equal(validateTraitSelection(hero('Czarodziej (Wizard)', 2), wizardStats), null);
});

test('later class features grant saving throws without persisting them as manual overrides', () => {
  const stats = emptyStatistics();
  assert.equal(characterTraits(hero('Mnich (Monk)', 14), stats).savingThrows.length, 6);
  assert.equal(characterTraits(hero('Łotrzyk (Rogue)', 15), stats).savingThrows.length, 4);
  assert.equal(characterTraits(hero('Łotrzyk (Rogue)', 14), stats).savingThrows.length, 2);
  assert.equal(stats.savingThrows.length, 0);
});

test('class check bonuses are calculated once and respond to chosen proficiencies and magical order', () => {
  const stats = emptyStatistics();
  let profile = characterTraits(hero('Bard', 5), stats);
  assert.equal(profile.skillBonuses.athletics, 1);
  stats.traits = { classSkills: ['athletics'] };
  profile = characterTraits(hero('Bard', 5), stats);
  assert.equal(profile.skillBonuses.athletics, 0);
  stats.traits = {}; stats.values.wis = 16; stats.spells.choices.order = 'magic';
  assert.equal(characterTraits(hero('Kleryk (Cleric)'), stats).skillBonuses.religion, 3);
  stats.values.wis = null;
  assert.equal(characterTraits(hero('Kleryk (Cleric)'), stats).skillBonuses.religion, null);
  stats.spells.choices.order = 'martial';
  assert.ok(characterTraits(hero('Kleryk (Cleric)'), stats).armor.includes('Heavy armor (Protector)'));
  assert.ok(characterTraits(hero('Druid'), stats).weapons.includes('Martial weapons'));
});

test('origin feats, species and tool selections combine without overwriting notes or manual ranks', () => {
  const stats = emptyStatistics(); stats.values.con = 14;
  stats.notes.languages = 'A language agreed with the GM'; stats.skills.perception = 2;
  let profile = characterTraits(hero('Wojownik (Fighter)', 1, 'Rolnik (Farmer)', 'Krasnolud (Dwarf)'), stats);
  assert.equal(profile.firstLevelMaxHp, 15);
  assert.equal(profile.effectiveSkills.perception, 2);
  assert.equal(profile.hpBonus, 3);
  assert.ok(profile.senses[0].includes('120'));
  stats.traits = { humanFeat: ['Skilled'] };
  profile = characterTraits(hero('Bard', 1, 'Szlachcic (Noble)', 'Człowiek (Human)'), stats);
  assert.equal(group(profile, 'skilled').limit, 6);
  assert.match(validateTraitSelection(hero('Bard', 1, 'Skryba (Scribe)'), { ...stats, traits: {}, requireCompleteTraits: true }), /Skilled.*3/);
  stats.traits = { skilled: ['skill:acrobatics', 'tool:Dice', 'skill:athletics'] };
  assert.equal(validateTraitSelection(hero('Bard', 1, 'Skryba (Scribe)'), { ...stats, requireCompleteTraits: true }), null);
  assert.equal(characterTraits(hero('Bard', 1, 'Skryba (Scribe)'), stats).effectiveSkills.acrobatics, 1);
  assert.ok(characterTraits(hero('Bard', 1, 'Skryba (Scribe)'), stats).tools.includes('Dice'));
  assert.equal(stats.notes.languages, 'A language agreed with the GM');
  assert.equal(group(characterTraits(hero('Bard', 1, 'Artysta (Entertainer)'), emptyStatistics()), 'musician').limit, 3);
});

test('Tavern Brawler exposes its origin proficiency description', () => {
  const profile = characterTraits(hero('Wojownik (Fighter)', 1, 'Żeglarz (Sailor)'), emptyStatistics());
  assert.ok(profile.feats.includes('Tavern Brawler'));
  assert.equal(profile.originFeatDescriptions['Biegłość w broni improwizowanej'], 'Zyskujesz biegłość w broni improwizowanej.');
});

test('Healer exposes its healing rerolls origin ability', () => {
  const profile = characterTraits(hero('Wojownik (Fighter)', 1, 'Pustelnik (Hermit)'), emptyStatistics());
  assert.ok(profile.feats.includes('Healer'));
  assert.match(profile.originFeatDescriptions['Healing Rerolls (Przerzuty leczenia)'], /przerzucić kość/);
});

test('gnome lineage requires a lineage and spellcasting ability and applies gnome size', () => {
  const gnome = hero('Bard', 1, 'Mędrzec (Sage)', 'Gnom (Gnome)');
  const stats = emptyStatistics();
  let profile = characterTraits(gnome, stats);
  assert.equal(profile.size, 'Small');
  assert.equal(profile.baseSpeed, 30);
  assert.ok(profile.senses.some(sense => sense.includes('60')));
  assert.ok(profile.defenses.some(defense => defense.includes('Inteligencji')));
  assert.equal(validateTraitSelection(gnome, stats), null);
  assert.match(validateTraitSelection(gnome, { ...stats, requireCompleteTraits: true }), /Gnomish Lineage/);
  assert.equal(group(profile, 'gnomeLineage').limit, 1);
  assert.equal(group(profile, 'gnomeSpellAbility').limit, 1);
  stats.traits = { gnomeLineage: ['forest'], gnomeSpellAbility: ['wis'] };
  assert.equal(validateTraitSelection(gnome, stats), null);
  profile = characterTraits(gnome, stats);
  assert.ok(profile.features.some(feature => feature.name.includes('Minor Illusion')));
  assert.ok(profile.features.some(feature => feature.name.includes('Mądrość')));
  stats.traits.gnomeLineage = ['rock'];
  assert.ok(characterTraits(gnome, stats).features.some(feature => feature.name.includes('clockwork devices')));
});

test('gnome validation allows an incomplete draft but requires both choices for saving', () => {
  const gnome = hero('Wojownik (Fighter)', 1, 'Żołnierz (Soldier)', 'Gnom (Gnome)');
  const stats = emptyStatistics();
  stats.traits = { gnomeLineage: ['rock'] };
  assert.equal(validateTraitSelection(gnome, stats), null);
  assert.match(validateTraitSelection(gnome, { ...stats, requireCompleteTraits: true }), /cecha czarowania/);
});

test('Goliath requires giant ancestry and gains Powerful Build and Large Form at level 5', () => {
  const goliath = hero('Wojownik (Fighter)', 5, 'Żołnierz (Soldier)', 'Goliat (Goliath)');
  const stats = emptyStatistics();
  const draft = characterTraits(goliath, stats);
  assert.equal(draft.baseSpeed, 35);
  assert.equal(draft.size, 'Medium');
  assert.equal(group(draft, 'giantAncestry').limit, 1);
  assert.match(validateTraitSelection(goliath, { ...stats, requireCompleteTraits: true }), /Giant Ancestry/);
  stats.traits = { giantAncestry: ['stone'] };
  const profile = characterTraits(goliath, stats);
  assert.equal(profile.goliathAncestry.id, 'stone');
  assert.ok(profile.features.some(feature => feature.name.startsWith('Powerful Build')));
  assert.ok(profile.features.some(feature => feature.name.startsWith('Large Form')));
  assert.equal(validateTraitSelection(goliath, { ...stats, requireCompleteTraits: true }), null);
});

test('all supported backgrounds and subclass levels have valid trait metadata', () => {
  for (const background of options.backgrounds) {
    const profile = characterTraits(hero('Bard', 1, background), emptyStatistics());
    assert.ok(Object.values(profile.skills).filter(rank => rank === 1).length === 2);
    assert.equal(profile.feats.length, 1);
  }
  for (const entry of options.classes) for (const subclass of entry.subclasses) for (let level = 3; level <= 20; level++) {
    const character = hero(entry.name, level, '', '', subclass);
    assert.equal(validateTraitSelection(character, emptyStatistics()), null);
    assert.ok(characterTraits(character, emptyStatistics()).features.every(feature => feature.level <= level));
  }
});
