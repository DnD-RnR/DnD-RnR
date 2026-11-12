import { warlockDescriptions } from './warlock.mjs';
import { eligibleDruidForms } from './druid.mjs';
import data from './trait-data.json' with { type: 'json' };
import options from './trait-options.json' with { type: 'json' };
import definitions from './statistics.json' with { type: 'json' };
import { crafterDescription, crafterTools } from './crafter.mjs';
import { invocationCount, invocationOptions, tomeOptions } from './warlock-invocations.mjs';
import { invocationSheet } from './warlock-invocation-effects.mjs';
import { eligibleOriginFeats, originFeats, originFeatSheet } from './origin-feats.mjs';
import spellCatalog from './spell-catalog.json' with { type: 'json' };

export const emptyTraitSelection = () => ({});
export const dragonbornAncestries = [
  { id: 'acid', label: 'Kwas — odporność na kwas' },
  { id: 'cold', label: 'Zimno — odporność na zimno' },
  { id: 'fire', label: 'Ogień — odporność na ogień' },
  { id: 'lightning', label: 'Błyskawice — odporność na błyskawice' },
  { id: 'poison', label: 'Trucizna — odporność na truciznę' },
];
const dragonbornDamageTypes = Object.fromEntries(dragonbornAncestries.map(entry => [entry.id, entry.label.split(' — ')[0].toLowerCase()]));
export const dragonbornAncestryProfile = ancestry => {
  const entry = dragonbornAncestries.find(value => value.id === ancestry);
  return entry ? { id: entry.id, label: entry.label, damageType: dragonbornDamageTypes[entry.id] } : null;
};
export const tieflingLegacies = [
  { id: 'abyssal', label: 'Abyssal — odporność na truciznę', damageType: 'trucizna', spells: ['poison-spray', 'ray-of-sickness', 'hold-person'] },
  { id: 'chthonic', label: 'Chthonic — odporność na nekrotyczne', damageType: 'nekrotyczne', spells: ['chill-touch', 'false-life', 'ray-of-enfeeblement'] },
  { id: 'infernal', label: 'Infernal — odporność na ogień', damageType: 'ogień', spells: ['fire-bolt', 'hellish-rebuke', 'darkness'] },
];
export const tieflingLegacyProfile = legacy => tieflingLegacies.find(value => value.id === legacy) ?? null;
export const goliathAncestries = [
  { id: 'cloud', label: "Cloud's Jaunt — teleportacja do 30 stóp" },
  { id: 'fire', label: "Fire's Burn — dodatkowe 1k10 obrażeń od ognia" },
  { id: 'frost', label: "Frost's Chill — dodatkowe 1k6 obrażeń od zimna i -10 stóp szybkości" },
  { id: 'hill', label: "Hill's Tumble — powalenie dużej lub mniejszej istoty" },
  { id: 'stone', label: "Stone's Endurance — redukcja obrażeń o 1k12 + modyfikator Kondycji" },
  { id: 'storm', label: "Storm's Thunder — 1k8 obrażeń od gromu jako reakcja" },
];
export const goliathAncestryProfile = ancestry => goliathAncestries.find(value => value.id === ancestry) ?? null;
const skillOptions = definitions.skills.map(skill => ({ id: skill.id, label: skill.label }));
const namedOptions = names => names.map(name => ({ id: name, label: name }));
const matchingSkills = text => Object.entries(options.skillNames).filter(([name]) => text?.includes(name)).map(([, id]) => id);
const abilityMod = (stats, id) => stats.values?.[id] == null ? null : Math.floor((stats.values[id] - 10) / 2);

export function characterTraits(character, stats) {
  const chosen = stats.traits ?? {};
  const level = character.level;
  const classEntry = Object.entries(data.classes).find(([, entry]) => entry.name === character.class);
  const classId = classEntry?.[0] ?? '';
  const cls = classEntry?.[1];
  const bg = Object.values(data.backgrounds).find(entry => entry.name === character.background);
  const species = character.species ?? '';
  const backgroundSkills = matchingSkills(bg?.['Skill Proficiencies']);
  const skills = Object.fromEntries(definitions.skills.map(skill => [skill.id, backgroundSkills.includes(skill.id) ? 1 : 0]));
  const savingThrows = Object.entries(options.abilityNames).filter(([name]) => cls?.core['Saving Throw Proficiencies']?.includes(name)).map(([, id]) => id);
  const languages = new Set(['common']);
  const tools = new Set();
  const feats = new Set(bg ? [bg.Feat] : []);
  const invocationEntries = invocationSheet(character, stats);
  const invocationIds = new Set(invocationEntries.map(i => i.id));
  const invocationFeats = invocationEntries.filter(i => i.id.startsWith('lessons-of-the-first-ones:')).map(i => i.id.split(':')[1]);
  invocationFeats.forEach(feat => feats.add(feat));
  const groups = [];
  const sourceLabels = Object.fromEntries(backgroundSkills.map(id => [id, `Pochodzenie: ${bg.name}`]));
  if (classId === 'druid') languages.add('druidic');
  if (classId === 'rogue') languages.add('thieves-cant');
  if (classId === 'rogue' && level >= 15) savingThrows.push('wis', 'cha');
  if (classId === 'monk' && level >= 14) savingThrows.push(...definitions.abilities.map(ability => ability.id));
  for (const name of [...options.artisanTools, ...options.otherTools]) {
    if (cls?.core['Tool Proficiencies'] === name || bg?.['Tool Proficiency'] === name) tools.add(name);
  }
  const group = (id, label, limit, choices, kind) => {
    groups.push({ id, label, limit, options: choices, kind });
    for (const value of chosen[id] ?? []) {
      if (!choices.some(choice => choice.id === value)) continue;
      if (kind === 'skill' || kind === 'expertise') { skills[value] = kind === 'expertise' ? 2 : Math.max(skills[value], 1); sourceLabels[value] = label; }
      if (kind === 'language') languages.add(value);
      if (kind === 'tool') tools.add(value);
      if (kind === 'feat') feats.add(value);
      if (kind === 'mixed') {
        if (value.startsWith('skill:')) { skills[value.slice(6)] = Math.max(skills[value.slice(6)], 1); sourceLabels[value.slice(6)] = label; }
        if (value.startsWith('tool:')) tools.add(value.slice(5));
      }
    }
  };
  const skillGroup = (id, label, limit, ids = definitions.skills.map(skill => skill.id)) => group(id, label, limit, skillOptions.filter(skill => ids.includes(skill.id) && !skills[skill.id]), 'skill');
  if (classId === 'druid' && level >= 2) group('druidForms', 'Wild Shape — znane formy', 4, eligibleDruidForms(character).map(f => ({ id: f.id, label: f.name })), 'form');
  if (classId === 'warlock') group('invocations', 'Eldritch Invocations', invocationCount(character), invocationOptions(character, stats), 'invocation');
  if (invocationIds.has('pact-of-the-tome')) {
    const spells = tomeOptions(character, stats);
    group('tomeCantrips', 'Pact of the Tome — sztuczki w księdze', 3, spells.filter(s => s.level === 0).map(s => ({ id: s.id, label: s.name })), 'spell');
    group('tomeRituals', 'Pact of the Tome — rytuały 1. kręgu', 2, spells.filter(s => s.level === 1).map(s => ({ id: s.id, label: s.name })), 'spell');
  }
  const toolGroup = (id, label, limit, names) => group(id, label, limit, namedOptions(names.filter(name => !tools.has(name))), 'tool');
  group('languages', 'Dwa języki początkowe', 2, options.languages.filter(language => language.standard && !languages.has(language.id)), 'language');
  if (species === 'Człowiek (Human)') {
    skillGroup('humanSkill', 'Human — Skillful', 1);
    group('humanFeat', 'Human — Versatile: atut pochodzenia', 1, namedOptions(eligibleOriginFeats(character).map(f => f.name).filter(name => name !== bg?.Feat || name === 'Skilled')), 'feat');
    group('humanSize', 'Human — rozmiar', 1, [{ id: 'medium', label: 'Średni (Medium)' }, { id: 'small', label: 'Mały (Small)' }], 'size');
  }
  if (species === 'Elf') skillGroup('elfSkill', 'Elf — Keen Senses', 1, ['insight', 'perception', 'survival']);
  if (species === 'Gnom (Gnome)') {
    group('gnomeLineage', 'Gnomish Lineage — linia', 1, [
      { id: 'forest', label: 'Forest Gnome (Leśny gnom)' },
      { id: 'rock', label: 'Rock Gnome (Skalny gnom)' },
    ], 'lineage');
    group('gnomeSpellAbility', 'Gnomish Lineage — cecha czarowania', 1, [
      { id: 'int', label: 'Inteligencja' },
      { id: 'wis', label: 'Mądrość' },
      { id: 'cha', label: 'Charyzma' },
    ], 'ability');
  }
  if (species === 'Smokowiec (Dragonborn)') group('dragonbornAncestry', 'Draconic Ancestry — przodek', 1, dragonbornAncestries, 'ancestry');
  if (species === 'Diabelstwo (Tiefling)') {
    group('tieflingLegacy', 'Fiendish Legacy — dziedzictwo', 1, tieflingLegacies.map(({ id, label }) => ({ id, label })), 'lineage');
    group('tieflingSpellAbility', 'Fiendish Legacy — cecha czarowania', 1, [
      { id: 'int', label: 'Inteligencja' }, { id: 'wis', label: 'Mądrość' }, { id: 'cha', label: 'Charyzma' },
    ], 'ability');
    group('tieflingSize', 'Tiefling — rozmiar', 1, [{ id: 'medium', label: 'Średni (Medium)' }, { id: 'small', label: 'Mały (Small)' }], 'size');
  }
  if (species === 'Goliat (Goliath)') group('giantAncestry', 'Giant Ancestry — dziedzictwo giganta', 1, goliathAncestries, 'ancestry');
  if (cls) {
    const text = cls.core['Skill Proficiencies'];
    const count = Number(text?.match(/Choose\s+(?:any\s+)?(\d+)/i)?.[1]) || 0;
    if (count) skillGroup('classSkills', `Umiejętności klasy: ${cls.name}`, count, /any/i.test(text) ? undefined : matchingSkills(text));
    if (classId === 'bard') toolGroup('classTools', 'Bard — instrumenty muzyczne', 3, options.instruments);
    if (classId === 'monk') toolGroup('classTools', 'Mnich — narzędzia lub instrument', 1, [...options.artisanTools, ...options.instruments]);
    if (classId === 'barbarian' && level >= 3) skillGroup('primalSkill', 'Primal Knowledge — dodatkowa umiejętność', 1, matchingSkills(text));
  }
  const backgroundTool = bg?.['Tool Proficiency'] ?? '';
  if (/Choose/i.test(backgroundTool)) {
    const names = /Gaming Set/i.test(backgroundTool) ? options.gamingSets : /Musical Instrument/i.test(backgroundTool) ? options.instruments : options.artisanTools;
    toolGroup('backgroundTool', `Narzędzie pochodzenia: ${bg.name}`, 1, names);
  }
  if (classId === 'rogue' || classId === 'ranger' && level >= 2) group('classLanguages', classId === 'rogue' ? 'Thieves’ Cant — dodatkowy język' : 'Deft Explorer — dwa języki', classId === 'rogue' ? 1 : 2, options.languages.filter(language => !languages.has(language.id)), 'language');
  if (character.subclass === 'College of Lore' && level >= 3) skillGroup('loreSkills', 'College of Lore — Bonus Proficiencies', 3);
  if (character.subclass === 'Fey Wanderer' && level >= 3) skillGroup('feySkill', 'Fey Wanderer — Otherworldly Glamour', 1, ['deception', 'performance', 'persuasion']);
  if (character.subclass === 'Assassin' && level >= 3) { tools.add('Disguise Kit'); tools.add("Poisoner's Kit"); }
  const skilledCount = (bg?.Feat === 'Skilled' ? 1 : 0) + ((chosen.humanFeat ?? []).includes('Skilled') && species === 'Człowiek (Human)' ? 1 : 0) + (invocationFeats.includes('Skilled') ? 1 : 0);
  if (skilledCount) group('skilled', 'Skilled — umiejętności lub narzędzia', 3 * skilledCount, [
    ...skillOptions.filter(skill => !skills[skill.id]).map(skill => ({ ...skill, id: `skill:${skill.id}` })),
    ...namedOptions([...options.artisanTools, ...options.instruments, ...options.gamingSets, ...options.otherTools].filter(name => !tools.has(name))).map(tool => ({ id: `tool:${tool.id}`, label: tool.label })),
  ], 'mixed');
  if (feats.has('Crafter')) toolGroup('crafter', 'Crafter — trzy narzędzia rzemieślnicze', 3, crafterTools);
  if (feats.has('Musician')) toolGroup('musician', 'Musician — trzy instrumenty', 3, options.instruments);
  if (feats.has('Harper Agent')) {
    languages.add('thieves-cant');
    toolGroup('harperInstrument', 'Harper Agent — instrument', 1, options.instruments);
  }
  if (feats.has('Cult of the Dragon Initiate')) {
    if (languages.has('draconic')) group('dragonCultLanguage', 'Cult of the Dragon — dodatkowy język', 1, options.languages.filter(l => !languages.has(l.id)), 'language');
    else languages.add('draconic');
  }
  if (feats.has('Purple Dragon Rook')) skillGroup('purpleDragonSkill', 'Purple Dragon Rook — umiejętność', 1, ['insight', 'performance', 'persuasion']);
  if (feats.has('Portal Jumper')) group('portalResistance', 'Portal Jumper — odporność', 1, namedOptions(['Necrotic', 'Psychic', 'Radiant']), 'resistance');
  for (const f of originFeats.filter(f => feats.has(f.name))) {
    const key = `origin:${f.name}`;
    if (f.spellAbility) group(`${key}:ability`, `${f.name} — cecha czarowania`, 1, [{ id: 'int', label: 'Inteligencja' }, { id: 'wis', label: 'Mądrość' }, { id: 'cha', label: 'Charyzma' }], 'ability');
    const spellOptions = spellCatalog.spells.filter(s => f.list ? s.classes.includes(f.list) : f.cantrips?.includes(s.id));
    if (f.list || f.cantrips) group(`${key}:cantrips`, `${f.name} — sztuczki`, f.list ? 2 : 1, spellOptions.filter(s => s.level === 0).map(s => ({ id: s.id, label: s.name })), 'spell');
    if (f.list) group(`${key}:spell`, `${f.name} — czar 1. kręgu`, 1, spellOptions.filter(s => s.level === 1).map(s => ({ id: s.id, label: s.name })), 'spell');
  }
  let expertise = classId === 'rogue' ? level >= 6 ? 4 : 2 : classId === 'bard' && level >= 2 ? level >= 9 ? 4 : 2 : classId === 'ranger' && level >= 2 ? level >= 9 ? 3 : 1 : 0;
  if (classId === 'wizard' && level >= 2) expertise = 1;
  if (expertise) {
    const scholar = ['arcana', 'history', 'investigation', 'medicine', 'nature', 'religion'];
    group('expertise', classId === 'wizard' ? 'Scholar — ekspertyza' : 'Ekspertyza klasy', expertise, skillOptions.filter(skill => (skills[skill.id] || stats.skills?.[skill.id]) && (classId !== 'wizard' || scholar.includes(skill.id))), 'expertise');
  }
  const allSkills = Object.fromEntries(definitions.skills.map(skill => [skill.id, Math.max(skills[skill.id], stats.skills?.[skill.id] ?? 0)]));
  const proficiency = 2 + Math.floor((level - 1) / 4);
  const skillBonuses = Object.fromEntries(definitions.skills.map(skill => [skill.id, classId === 'bard' && level >= 2 && !allSkills[skill.id] ? Math.floor(proficiency / 2) : 0]));
  const wisdom = abilityMod(stats, 'wis');
  if (stats.spells?.choices?.order === 'magic' && ['cleric', 'druid'].includes(classId)) for (const skill of classId === 'cleric' ? ['arcana', 'religion'] : ['arcana', 'nature']) skillBonuses[skill] = wisdom === null ? null : skillBonuses[skill] + Math.max(1, wisdom);
  if (character.subclass === 'Fey Wanderer' && level >= 3) for (const skill of definitions.skills.filter(skill => skill.ability === 'cha')) skillBonuses[skill.id] = wisdom === null ? null : skillBonuses[skill.id] + Math.max(1, wisdom);
  const armor = [cls?.core['Armor Training'] ?? ''];
  const weapons = [cls?.core['Weapon Proficiencies'] ?? ''];
  if (stats.spells?.choices?.order === 'martial' && ['cleric', 'druid'].includes(classId)) {
    armor.push(classId === 'cleric' ? 'Heavy armor (Protector)' : 'Medium armor (Warden)');
    weapons.push('Martial weapons');
  }
  const classFeatures = (cls?.features ?? []).filter(feature => feature.level <= level).map(feature => ({ ...feature, source: character.class }));
  const subclassFeatures = (data.subclasses[character.subclass]?.features ?? []).filter(feature => feature.level <= level).map(feature => ({ ...feature, source: character.subclass }));
  const lineage = chosen.gnomeLineage?.[0];
  const spellAbility = chosen.gnomeSpellAbility?.[0];
  const ancestry = dragonbornAncestryProfile(chosen.dragonbornAncestry?.[0]);
  const fiendishLegacy = tieflingLegacyProfile(chosen.tieflingLegacy?.[0]);
  const goliathAncestry = goliathAncestryProfile(chosen.giantAncestry?.[0]);
  const tieflingSpellAbility = chosen.tieflingSpellAbility?.[0];
  const lineageFeatures = [];
  if (species === 'Gnom (Gnome)' && lineage === 'forest') {
    lineageFeatures.push(
      { level: 1, name: 'Gnomish Lineage — Minor Illusion; Speak with Animals', url: 'https://dnd2024.wikidot.com/species:gnome#Gnomish-Lineage', source: 'Gnom (Gnome)' },
    );
  }
  if (species === 'Gnom (Gnome)' && lineage === 'rock') {
    lineageFeatures.push(
      { level: 1, name: 'Gnomish Lineage — Mending; Prestidigitation; clockwork devices', url: 'https://dnd2024.wikidot.com/species:gnome#Gnomish-Lineage', source: 'Gnom (Gnome)' },
    );
  }
  if (species === 'Gnom (Gnome)' && spellAbility) {
    lineageFeatures.push(
      { level: 1, name: `Gnomish Lineage — cecha czarowania: ${spellAbility === 'int' ? 'Inteligencja' : spellAbility === 'wis' ? 'Mądrość' : 'Charyzma'}`, url: 'https://dnd2024.wikidot.com/species:gnome#Gnomish-Lineage', source: 'Gnom (Gnome)' },
    );
  }
  if (species === 'Ork (Orc)') {
    lineageFeatures.push(
      { level: 1, name: 'Adrenaline Rush — Zryw jako akcja bonusowa; tymczasowe PW równe premii z biegłości', url: 'https://dnd2024.wikidot.com/species:orc#Adrenaline-Rush', source: 'Ork (Orc)' },
      { level: 1, name: 'Relentless Endurance — pozostajesz na 1 PW zamiast spaść do 0 PW', url: 'https://dnd2024.wikidot.com/species:orc#Relentless-Endurance', source: 'Ork (Orc)' },
    );
  }
  if (species === 'Smokowiec (Dragonborn)' && ancestry) {
    lineageFeatures.push(
      { level: 1, name: `Draconic Ancestry — ${ancestry.label}`, url: 'https://dnd2024.wikidot.com/species:dragonborn#Draconic-Ancestry', source: 'Smokowiec (Dragonborn)' },
      { level: 1, name: 'Breath Weapon — Broń Oddechowa', url: 'https://dnd2024.wikidot.com/species:dragonborn#Breath-Weapon', source: 'Smokowiec (Dragonborn)' },
      ...(level >= 5 ? [{ level: 5, name: 'Draconic Flight — Lot Smoka', url: 'https://dnd2024.wikidot.com/species:dragonborn#Draconic-Flight', source: 'Smokowiec (Dragonborn)' }] : []),
    );
  }
  if (species === 'Diabelstwo (Tiefling)' && fiendishLegacy) {
    lineageFeatures.push(
      { level: 1, name: `Fiendish Legacy — ${fiendishLegacy.label}`, url: 'https://dnd2024.wikidot.com/species:tiefling#Fiendish-Legacy', source: 'Diabelstwo (Tiefling)' },
      { level: 1, name: 'Otherworldly Presence — Thaumaturgy', url: 'https://dnd2024.wikidot.com/spell:thaumaturgy', source: 'Diabelstwo (Tiefling)' },
      { level: 3, name: `Fiendish Legacy — ${fiendishLegacy.spells[1]}`, url: 'https://dnd2024.wikidot.com/species:tiefling#Fiendish-Legacies', source: 'Diabelstwo (Tiefling)' },
      { level: 5, name: `Fiendish Legacy — ${fiendishLegacy.spells[2]}`, url: 'https://dnd2024.wikidot.com/species:tiefling#Fiendish-Legacies', source: 'Diabelstwo (Tiefling)' },
    );
    if (tieflingSpellAbility) lineageFeatures.push({ level: 1, name: `Fiendish Legacy — cecha czarowania: ${tieflingSpellAbility === 'int' ? 'Inteligencja' : tieflingSpellAbility === 'wis' ? 'Mądrość' : 'Charyzma'}`, url: 'https://dnd2024.wikidot.com/species:tiefling#Fiendish-Legacy', source: 'Diabelstwo (Tiefling)' });
  }
  if (species === 'Człowiek (Human)') {
    lineageFeatures.push(
      { level: 1, name: 'Resourceful — Heroic Inspiration po długim odpoczynku', url: 'https://dnd2024.wikidot.com/species:human#Resourceful', source: 'Człowiek (Human)' },
      { level: 1, name: 'Skillful — biegłość w jednej umiejętności', url: 'https://dnd2024.wikidot.com/species:human#Skillful', source: 'Człowiek (Human)' },
      { level: 1, name: 'Versatile — atut pochodzenia', url: 'https://dnd2024.wikidot.com/species:human#Versatile', source: 'Człowiek (Human)' },
    );
  }
  if (species === 'Goliat (Goliath)') {
    lineageFeatures.push(
      ...(goliathAncestry ? [{ level: 1, name: `Giant Ancestry — ${goliathAncestry.label}`, url: 'https://dnd2024.wikidot.com/species:goliath#Giant-Ancestry', source: 'Goliat (Goliath)' }] : []),
      { level: 1, name: 'Powerful Build — ułatwienie zakończenia stanu Grappled; udźwig jak dla większej kategorii rozmiaru', url: 'https://dnd2024.wikidot.com/species:goliath#Powerful-Build', source: 'Goliat (Goliath)' },
      ...(level >= 5 ? [{ level: 5, name: 'Large Form — rozmiar Large, ułatwienie testów Siły i +10 stóp szybkości', url: 'https://dnd2024.wikidot.com/species:goliath#Large-Form', source: 'Goliat (Goliath)' }] : []),
    );
  }
  const features = [...new Map([...classFeatures, ...subclassFeatures, ...lineageFeatures].map(feature => [`${feature.source}:${feature.name}`, feature])).values()];
  if (classId === 'warlock') for (let i = 0; i < features.length; i++) {
    const description = warlockDescriptions[features[i].name];
    if (description) features[i] = { ...features[i], description };
  }
  const originFeatDescriptions = {};
  for (const f of originFeats.filter(f => feats.has(f.name))) originFeatDescriptions[f.name] = f.description;
  if (feats.has('Crafter')) Object.assign(originFeatDescriptions, {
    'Biegłość w narzędziach': crafterDescription.toolProficiency,
    Rabat: crafterDescription.discount,
    'Szybkie wytwarzanie': crafterDescription.fastCrafting,
  });
  if (feats.has('Tavern Brawler')) Object.assign(originFeatDescriptions, {
    'Biegłość w broni improwizowanej': 'Zyskujesz biegłość w broni improwizowanej.',
  });
  if (feats.has('Healer')) Object.assign(originFeatDescriptions, {
    'Healing Rerolls (Przerzuty leczenia)': 'Za każdym razem, gdy wykonujesz rzut kością, aby określić liczbę Punktów Wytrzymałości odzyskanych dzięki czarowi lub atutowi Healer — Medycyna bitewna, możesz przerzucić kość, jeśli wypadnie na niej 1. Musisz użyć nowego wyniku.',
  });
  const darkvision = species === 'Krasnolud (Dwarf)' || species === 'Ork (Orc)' ? 120 : ['Aasimar', 'Smokowiec (Dragonborn)', 'Elf', 'Gnom (Gnome)', 'Diabelstwo (Tiefling)'].includes(species) ? 60 : 0;
  const senses = darkvision ? [`Widzenie w ciemności: ${darkvision} stóp (gatunek)`] : [];
  if (invocationIds.has('devils-sight')) senses.push('Devil’s Sight: normalne widzenie w słabym świetle i ciemności (także magicznej), 120 stóp');
  if (invocationIds.has('witch-sight')) senses.push('Witch Sight: Truesight, 30 stóp');
  if (classId === 'ranger' && level >= 18) senses.push('Ślepowidzenie: 30 stóp (Feral Senses)');
  const defenses = [];
  if (feats.has('Portal Jumper') && ['Necrotic', 'Psychic', 'Radiant'].includes(chosen.portalResistance?.[0])) defenses.push(`Portal Jumper: odporność na ${chosen.portalResistance[0]}.`);
  if (feats.has('Arathi Heritage')) defenses.push('Arathi Heritage: ułatwienie przeciw Charmed.');
  if (feats.has('Transmuted Anatomy')) defenses.push('Transmuted Anatomy: ułatwienie przeciw wymuszonej przemianie.');
  if (feats.has('Child of the Sun')) defenses.push('Child of the Sun: ułatwienie przeciw Blinded dla ciebie i sojuszników do 10 stóp.');
  if (invocationIds.has('eldritch-mind')) defenses.push('Eldritch Mind: ułatwienie rzutów na Kondycję w celu utrzymania koncentracji.');
  if (species === 'Krasnolud (Dwarf)') defenses.push('Odporność na truciznę; ułatwienie rzutów przeciw zatruciu.');
  if (species === 'Aasimar') defenses.push('Odporność na obrażenia nekrotyczne i od światłości.');
  if (species === 'Elf') defenses.push('Ułatwienie rzutów przeciw zauroczeniu; magia nie usypia postaci.');
  if (species === 'Gnom (Gnome)') defenses.push('Ułatwienie rzutów obronnych z Inteligencji, Mądrości i Charyzmy.');
  if (classId === 'barbarian' && level >= 2) defenses.push('Danger Sense: ułatwienie rzutów obronnych na Zręczność, chyba że jesteś Obezwładniony. Nie wymaga Szału.');
  if (species === 'Smokowiec (Dragonborn)' && ancestry) defenses.push(`Odporność na obrażenia: ${ancestry.damageType}.`);
  if (species === 'Diabelstwo (Tiefling)' && fiendishLegacy) defenses.push(`Odporność na obrażenia: ${fiendishLegacy.damageType}.`);
  const die = Number(cls?.core['Hit Point Die']?.match(/D(\d+)/i)?.[1]) || null;
  const hpBonus = (species === 'Krasnolud (Dwarf)' ? level : 0) + (feats.has('Tough') ? 2 * level : 0);
  const con = abilityMod(stats, 'con');
  const resources = (cls?.resources ?? []).map(resource => ({ name: resource.name, value: resource.levels.find(entry => entry.level === level)?.value ?? '—' }));
  if (classId === 'paladin') resources.push({ name: 'Lay On Hands — pula leczenia', value: String(5 * level) });
  if (classId === 'bard') resources.push({ name: 'Bardic Inspiration — użycia', value: abilityMod(stats, 'cha') === null ? '—' : String(Math.max(1, abilityMod(stats, 'cha'))) });
  return {
    originFeatEntries: originFeatSheet([...feats], character, stats),
    invocationEntries, swimSpeed: invocationIds.has('gift-of-the-depths') || feats.has('Child of the Sea') ? (stats.values?.speed ?? (species === 'Goliat (Goliath)' ? 35 : species ? 30 : null)) + (feats.has('Transmuted Anatomy') ? 5 : 0) : null,
    classId, source: cls?.url ?? data.source, groups, skills, effectiveSkills: allSkills,
    savingThrows: [...new Set(savingThrows)], effectiveSavingThrows: [...new Set([...savingThrows, ...(stats.savingThrows ?? [])])],
    skillSources: sourceLabels, skillBonuses, languages: options.languages.filter(language => languages.has(language.id)),
    tools: [...tools], armor: armor.filter(Boolean), weapons: weapons.filter(Boolean), feats: [...feats], originFeatDescriptions, features,
    hitDie: die, hitDiceTotal: level,
    size: ['Diabelstwo (Tiefling)', 'Człowiek (Human)'].includes(species)
      ? (chosen[species === 'Człowiek (Human)' ? 'humanSize' : 'tieflingSize']?.[0] === 'small' ? 'Small' : 'Medium')
      : ['Gnom (Gnome)', 'Niziołek (Halfling)'].includes(species) ? 'Small' : species ? 'Medium' : null,
    ancestry, fiendishLegacy,
    goliathAncestry, giantAncestry: goliathAncestry,
    baseSpeed: species ? (species === 'Goliat (Goliath)' ? 35 : 30) + (feats.has('Transmuted Anatomy') ? 5 : 0) : null,
    senses, defenses, resources, hpBonus, firstLevelMaxHp: level === 1 && die && con !== null ? Math.max(1, die + con) + hpBonus : null,
    initiativeBonus: feats.has('Alert') ? proficiency : 0,
  };
}

export function validateTraitSelection(character, stats) {
  const selection = stats.traits;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return 'Niepoprawny wybór biegłości i języków.';
  for (const values of Object.values(selection)) if (!Array.isArray(values) || values.some(value => typeof value !== 'string') || new Set(values).size !== values.length || values.length > 30) return 'Wybory biegłości nie mogą zawierać powtórzeń ani niepoprawnych pozycji.';
  const profile = characterTraits(character, stats);
  for (const id of Object.keys(selection)) if (!profile.groups.some(group => group.id === id)) return 'Wybór biegłości nie pasuje do obecnej klasy, gatunku lub pochodzenia.';
  for (const group of profile.groups) {
    const values = selection[group.id] ?? [];
    if (values.length > group.limit) return `${group.label}: limit wynosi ${group.limit}.`;
    if (values.some(id => !group.options.some(option => option.id === id))) return `${group.label}: wybierz dostępną, niepowtarzającą się pozycję.`;
    if (stats.requireCompleteTraits && values.length !== group.limit
      && (group.id === 'skilled' || character.species === 'Człowiek (Human)' && ['humanSkill', 'humanFeat', 'humanSize'].includes(group.id)
        || character.species === 'Gnom (Gnome)' && ['gnomeLineage', 'gnomeSpellAbility'].includes(group.id)
        || character.species === 'Smokowiec (Dragonborn)' && group.id === 'dragonbornAncestry'
        || character.species === 'Diabelstwo (Tiefling)' && ['tieflingLegacy', 'tieflingSpellAbility', 'tieflingSize'].includes(group.id)
        || character.species === 'Goliat (Goliath)' && group.id === 'giantAncestry')) {
      return `${group.label}: wybierz ${group.limit} opcji.`;
    }
  }
  return null;
}
