import catalog from './spell-catalog.json' with { type: 'json' };
import progression from './spell-progression.json' with { type: 'json' };
import subclassSpells from './subclass-spells.json' with { type: 'json' };
import { tieflingLegacyProfile } from './character-traits.mjs';
import { selectedOriginFeats, originSpellGrants } from './origin-feats.mjs';

export const emptySpellSelection = () => ({ choices: {}, selections: {} });
export const spellById = new Map(catalog.spells.map(spell => [spell.id, spell]));
const abilities = { bard: 'cha', cleric: 'wis', druid: 'wis', paladin: 'cha', ranger: 'wis', sorcerer: 'cha', warlock: 'cha', wizard: 'int', 'Eldritch Knight': 'int', 'Arcane Trickster': 'int' };

export function spellcastingProfile(character, selection = emptySpellSelection(), traits = {}) {
  const level = character.level;
  const classId = Object.entries(progression).find(([id, value]) => !id.includes(' ') && value.name === character.class)?.[0] ?? '';
  const thirdCaster = character.class === 'Wojownik (Fighter)' && character.subclass === 'Eldritch Knight' || character.class === 'Łotrzyk (Rogue)' && character.subclass === 'Arcane Trickster';
  const caster = thirdCaster ? character.subclass : classId;
  const row = progression[caster]?.levels.find(entry => entry.level === level);
  const profile = { ability: abilities[caster] ?? '', source: progression[caster]?.url ?? catalog.source, groups: [], automatic: [], choices: [], slots: row?.slots ?? [], pactSlotLevel: row?.slotLevel ?? 0 };
  const chosen = selection?.selections ?? {};
  const choices = selection?.choices ?? {};
  const automatic = new Map();
  const grant = (ids, reason) => { for (const id of ids) { const spell = spellById.get(id); if (!spell) throw new Error(`Unknown granted spell: ${id}`); automatic.set(id, { ...spell, reason }); } };
  for (const entry of originSpellGrants(selectedOriginFeats(character, traits), traits)) grant([entry.id], entry.reason);
  const legacy = character.species === 'Diabelstwo (Tiefling)' ? tieflingLegacyProfile(traits.tieflingLegacy?.[0]) : null;
  if (legacy) {
    grant(['thaumaturgy', legacy.spells[0]], 'Fiendish Legacy — poziom 1');
    if (level >= 3) grant([legacy.spells[1]], 'Fiendish Legacy — poziom 3');
    if (level >= 5) grant([legacy.spells[2]], 'Fiendish Legacy — poziom 5');
    profile.ability = traits.tieflingSpellAbility?.[0] ?? profile.ability;
  }
  const choice = (id, label, options) => profile.choices.push({ id, label, options });
  const maxLevel = row ? caster === 'warlock' ? row.slotLevel : row.slots.reduce((max, count, index) => count ? index + 1 : max, 0) : 0;
  const fromLists = (lists, min, max) => catalog.spells.filter(spell => spell.level >= min && spell.level <= max && spell.classes.some(id => lists.includes(id)));
  const group = (id, label, limit, options, fromBook = false, hint = '') => profile.groups.push({ id, label, limit, options, fromBook, hint });
  if (!row) {
    const subclass = character.subclass;
    if (character.class?.includes('Barbarian') && level >= 3 && subclass === 'Path of the Wild Heart') {
      grant(['beast-sense', 'speak-with-animals'], 'Animal Speaker — tylko rytuały');
      if (level >= 10) grant(['commune-with-nature'], 'Nature Speaker — tylko rytuał');
      for (const id of ['beast-sense', 'speak-with-animals', ...(level >= 10 ? ['commune-with-nature'] : [])]) {
        automatic.set(id, { ...automatic.get(id), ritualOnly: true, spellcastingAbility: 'wis' });
      }
      profile.ability = 'wis';
    }
    if (level >= 3 && subclass === 'Warrior of Shadow') {
      grant(['darkness'], 'Shadow Arts — 1 punkt skupienia');
      grant(['minor-illusion'], 'Shadowy Figments'); profile.ability = 'wis';
    }
    if (level >= 3 && subclass === 'Warrior of the Elements') {
      grant(['elementalism'], 'Manipulate Elements'); profile.ability = 'wis';
    }
    if (level >= 18 && subclass === 'Psi Warrior') {
      grant(['telekinesis'], 'Telekinetic Master'); profile.ability = 'int';
    }
    profile.source = subclassSpells[subclass]?.url ?? profile.source;
    profile.automatic = [...automatic.values()];
    return profile;
  }
  const list = ['Eldritch Knight', 'Arcane Trickster'].includes(caster) ? 'wizard' : classId;
  let cantrips = row.cantrips;
  if (classId === 'cleric' || classId === 'druid') {
    const isCleric = classId === 'cleric';
    choice('order', isCleric ? 'Boski porządek' : 'Pierwotny porządek', [{ id: '', label: 'Nie wybrano' }, { id: 'martial', label: isCleric ? 'Protector' : 'Warden' }, { id: 'magic', label: isCleric ? 'Thaumaturge (+1 sztuczka)' : 'Magician (+1 sztuczka)' }]);
    if (choices.order === 'magic') cantrips++;
  }
  if (['paladin', 'ranger'].includes(classId) && level >= 2) {
    choice('style', 'Styl walki', [{ id: '', label: 'Inny styl / nie wybrano' }, { id: 'magic', label: classId === 'paladin' ? 'Blessed Warrior (2 sztuczki kleryka)' : 'Druidic Warrior (2 sztuczki druida)' }]);
    if (choices.style === 'magic') group('styleCantrips', 'Sztuczki ze stylu walki', 2, fromLists([classId === 'paladin' ? 'cleric' : 'druid'], 0, 0));
  }
  if (caster === 'Arcane Trickster') grant(['mage-hand'], 'Arcane Trickster');
  if (classId === 'druid') grant(['speak-with-animals'], 'Druidic');
  if (classId === 'ranger') grant(['hunter-s-mark'], 'Favored Enemy');
  if (classId === 'paladin' && level >= 2) grant(['divine-smite'], 'Paladin’s Smite');
  if (classId === 'warlock' && character.subclass === 'Great Old One Patron' && level >= 10) grant(['hex'], 'Eldritch Hex');
  if (classId === 'warlock' && level >= 9) grant(['contact-other-plane'], 'Contact Patron');
  if (classId === 'bard' && level >= 20) grant(['power-word-heal', 'power-word-kill'], 'Words of Creation');
  const subclass = subclassSpells[character.subclass];
  if (subclass && level >= 3) {
    let variant = 0;
    if (character.subclass === 'Circle of the Land') {
      choice('land', 'Kraina po długim odpoczynku', [{ id: '', label: 'Wybierz krainę' }, { id: 'arid', label: 'Arid — sucha' }, { id: 'polar', label: 'Polar — polarna' }, { id: 'temperate', label: 'Temperate — umiarkowana' }, { id: 'tropical', label: 'Tropical — tropikalna' }]);
      variant = ['arid', 'polar', 'temperate', 'tropical'].indexOf(choices.land);
    }
    for (const entry of subclass.variants[variant] ?? []) if (level >= entry.level) grant(entry.spells, character.subclass);
  }
  if (character.subclass === 'College of Glamour') {
    if (level >= 3) grant(['charm-person', 'mirror-image'], 'Beguiling Magic');
    if (level >= 6) grant(['command'], 'Mantle of Majesty');
  }
  if (character.subclass === 'Circle of the Stars' && level >= 3) grant(['guidance', 'guiding-bolt'], 'Star Map');
  if (character.subclass === 'Illusionist' && level >= 3) grant(['minor-illusion'], 'Improved Illusions');
  if (character.subclass === 'Illusionist' && level >= 6) grant(['summon-beast', 'summon-fey'], 'Phantasmal Creatures');
  if (classId === 'wizard') {
    group('book', 'Księga czarów', null, fromLists(['wizard'], 1, maxLevel), false, 'Na 1. poziomie: 6 czarów; następnie 2 za każdy poziom. Kopiowanie znalezionych czarów nie ma limitu liczby wpisów.');
    if (level >= 18) {
      group('mastery1', 'Spell Mastery — czar 1. kręgu', 1, fromLists(['wizard'], 1, 1).filter(spell => spell.castingTime === 'Action'), true);
      group('mastery2', 'Spell Mastery — czar 2. kręgu', 1, fromLists(['wizard'], 2, 2).filter(spell => spell.castingTime === 'Action'), true);
    }
    if (level >= 20) group('signature', 'Signature Spells — czary 3. kręgu', 2, fromLists(['wizard'], 3, 3), true);
    for (const id of ['mastery1', 'mastery2', 'signature']) grant((chosen[id] ?? []).filter(spellId => spellById.has(spellId)), 'Zawsze przygotowane — Wizard');
  }
  if (cantrips) group('cantrips', 'Sztuczki klasowe', cantrips, fromLists([list], 0, 0));
  if (character.subclass === 'College of Lore' && level >= 6) group('lore', 'Magical Discoveries — dodatkowe czary', 2, fromLists(['cleric', 'druid', 'wizard'], 0, maxLevel));
  const preparedLists = classId === 'bard' && level >= 10 ? ['bard', 'cleric', 'druid', 'wizard'] : [list];
  group('prepared', 'Czary przygotowane', row.prepared, fromLists(preparedLists, 1, maxLevel), classId === 'wizard', classId === 'wizard' ? 'Wybieraj spośród czarów zapisanych w księdze.' : 'Limit pochodzi z tabeli klasy, nie z liczby komórek czarów.');
  if (classId === 'warlock') for (const [requiredLevel, spellLevel] of [[11, 6], [13, 7], [15, 8], [17, 9]]) {
    if (level >= requiredLevel) group(`arcanum${spellLevel}`, `Mystic Arcanum — ${spellLevel}. krąg`, 1, fromLists(['warlock'], spellLevel, spellLevel));
  }
  for (const entry of profile.groups) if (entry.id !== 'book' && !['mastery1', 'mastery2', 'signature'].includes(entry.id)) entry.options = entry.options.filter(spell => !automatic.has(spell.id));
  profile.automatic = [...automatic.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return profile;
}

export function validateSpellSelection(character, selection) {
  if (!selection || typeof selection !== 'object' || !selection.choices || typeof selection.choices !== 'object' || Array.isArray(selection.choices) || !selection.selections || typeof selection.selections !== 'object' || Array.isArray(selection.selections)) return 'Niepoprawny wybór czarów.';
  // Validate shape before building a profile that inspects selected spell IDs.
  for (const ids of Object.values(selection.selections)) if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length || ids.length > catalog.spells.length) return 'Lista czarów zawiera niepoprawne lub powtórzone pozycje.';
  const profile = spellcastingProfile(character, selection);
  for (const [id, value] of Object.entries(selection.choices)) if (!profile.choices.some(choice => choice.id === id && choice.options.some(option => option.id === value))) return 'Wybór zdolności magicznej nie pasuje do klasy i poziomu.';
  for (const id of Object.keys(selection.selections)) if (!profile.groups.some(group => group.id === id)) return 'Ta postać nie ma dostępu do wybranej kategorii czarów.';
  const used = new Set();
  for (const group of profile.groups) {
    const ids = selection.selections[group.id] ?? [];
    if (group.limit !== null && ids.length > group.limit) return `${group.label}: limit wynosi ${group.limit}.`;
    const options = new Set(group.options.map(spell => spell.id));
    for (const id of ids) {
      if (!options.has(id)) return `${group.label}: czar nie pasuje do klasy, poziomu lub jest już przyznany przez zdolność.`;
      if (group.fromBook && !(selection.selections.book ?? []).includes(id)) return 'Przygotowany czar musi znajdować się w księdze czarów.';
      if (group.id !== 'book') {
        if (used.has(id)) return 'Ten sam czar został wybrany w kilku kategoriach.';
        used.add(id);
      }
    }
  }
  return null;
}
