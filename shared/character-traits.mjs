import data from './trait-data.json' with { type: 'json' };
import options from './trait-options.json' with { type: 'json' };
import definitions from './statistics.json' with { type: 'json' };

export const emptyTraitSelection = () => ({});
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
  const toolGroup = (id, label, limit, names) => group(id, label, limit, namedOptions(names.filter(name => !tools.has(name))), 'tool');
  group('languages', 'Dwa języki początkowe', 2, options.languages.filter(language => language.standard && !languages.has(language.id)), 'language');
  if (species === 'Człowiek (Human)') {
    skillGroup('humanSkill', 'Human — Skillful', 1);
    group('humanFeat', 'Human — Versatile: atut pochodzenia', 1, namedOptions(options.originFeats.filter(name => name !== bg?.Feat || name === 'Skilled')), 'feat');
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
  const skilledCount = (bg?.Feat === 'Skilled' ? 1 : 0) + ((chosen.humanFeat ?? []).includes('Skilled') && species === 'Człowiek (Human)' ? 1 : 0);
  if (skilledCount) group('skilled', 'Skilled — umiejętności lub narzędzia', 3 * skilledCount, [
    ...skillOptions.filter(skill => !skills[skill.id]).map(skill => ({ ...skill, id: `skill:${skill.id}` })),
    ...namedOptions([...options.artisanTools, ...options.instruments, ...options.gamingSets, ...options.otherTools].filter(name => !tools.has(name))).map(tool => ({ id: `tool:${tool.id}`, label: tool.label })),
  ], 'mixed');
  if (feats.has('Crafter')) toolGroup('crafter', 'Crafter — trzy narzędzia rzemieślnicze', 3, options.artisanTools);
  if (feats.has('Musician')) toolGroup('musician', 'Musician — trzy instrumenty', 3, options.instruments);
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
  const features = [...new Map([...classFeatures, ...subclassFeatures, ...lineageFeatures].map(feature => [`${feature.source}:${feature.name}`, feature])).values()];
  const darkvision = species === 'Krasnolud (Dwarf)' || species === 'Ork (Orc)' ? 120 : ['Aasimar', 'Smokowiec (Dragonborn)', 'Elf', 'Gnom (Gnome)', 'Diabelstwo (Tiefling)'].includes(species) ? 60 : 0;
  const senses = darkvision ? [`Widzenie w ciemności: ${darkvision} stóp (gatunek)`] : [];
  if (classId === 'ranger' && level >= 18) senses.push('Ślepowidzenie: 30 stóp (Feral Senses)');
  const defenses = [];
  if (species === 'Krasnolud (Dwarf)') defenses.push('Odporność na truciznę; ułatwienie rzutów przeciw zatruciu.');
  if (species === 'Aasimar') defenses.push('Odporność na obrażenia nekrotyczne i od światłości.');
  if (species === 'Elf') defenses.push('Ułatwienie rzutów przeciw zauroczeniu; magia nie usypia postaci.');
  if (species === 'Gnom (Gnome)') defenses.push('Ułatwienie rzutów obronnych z Inteligencji, Mądrości i Charyzmy.');
  const die = Number(cls?.core['Hit Point Die']?.match(/D(\d+)/i)?.[1]) || null;
  const hpBonus = (species === 'Krasnolud (Dwarf)' ? level : 0) + (feats.has('Tough') ? 2 * level : 0);
  const con = abilityMod(stats, 'con');
  const resources = (cls?.resources ?? []).map(resource => ({ name: resource.name, value: resource.levels.find(entry => entry.level === level)?.value ?? '—' }));
  if (classId === 'paladin') resources.push({ name: 'Lay On Hands — pula leczenia', value: String(5 * level) });
  if (classId === 'bard') resources.push({ name: 'Bardic Inspiration — użycia', value: abilityMod(stats, 'cha') === null ? '—' : String(Math.max(1, abilityMod(stats, 'cha'))) });
  return {
    classId, source: cls?.url ?? data.source, groups, skills, effectiveSkills: allSkills,
    savingThrows: [...new Set(savingThrows)], effectiveSavingThrows: [...new Set([...savingThrows, ...(stats.savingThrows ?? [])])],
    skillSources: sourceLabels, skillBonuses, languages: options.languages.filter(language => languages.has(language.id)),
    tools: [...tools], armor: armor.filter(Boolean), weapons: weapons.filter(Boolean), feats: [...feats], features,
    hitDie: die, hitDiceTotal: level, size: species === 'Gnom (Gnome)' ? 'Small' : null,
    baseSpeed: species === 'Goliat (Goliath)' ? 35 : species ? 30 : null,
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
    if (stats.requireCompleteTraits && character.species === 'Gnom (Gnome)' && ['gnomeLineage', 'gnomeSpellAbility'].includes(group.id) && values.length !== group.limit) return `${group.label}: wybierz jedną opcję.`;
  }
  return null;
}
