import { PDFDocument, PDFTextField, layoutMultilineText } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Character, CharacterStatistics, InventoryItem } from '../../api';
import { characterTraits } from '../../../shared/character-traits.mjs';
import { spellcastingProfile, spellById } from '../../../shared/spellcasting.mjs';
import definitions from '../../../shared/statistics.json' with { type: 'json' };

const signed = (value: number | null) => value === null ? '' : `${value >= 0 ? '+' : ''}${value}`;
// Order on the Polish template differs from the order in statistics.json.
const skills = ['acrobatics', 'athletics', 'history', 'insight', 'medicine', 'animalHandling', 'deception', 'perception', 'persuasion', 'nature', 'religion', 'stealth', 'survival', 'investigation', 'arcana', 'performance', 'intimidation', 'sleightOfHand'];
const spellRows = [0, 8, 21, 34, 47, 60, 69, 78, 87, 94, 101];

export async function createCharacterPdf(character: Character, stats: CharacterStatistics, items: InventoryItem[], template: ArrayBuffer | Uint8Array, fontBytes: ArrayBuffer | Uint8Array) {
  const pdf = await PDFDocument.load(template);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const form = pdf.getForm();
  const traits = characterTraits(character, stats);
  const magic = spellcastingProfile(character, stats.spells, stats.traits);
  const proficiency = 2 + Math.floor((character.level - 1) / 4);
  const mod = (id: string) => stats.values[id] == null ? null : Math.floor((stats.values[id]! - 10) / 2);
  const bonus = (id: string, rank: number) => mod(id) === null ? null : mod(id)! + rank * proficiency;
  const skillBonus = (id: string) => {
    const ability = definitions.skills.find(skill => skill.id === id)!.ability;
    const base = bonus(ability, traits.effectiveSkills[id] ?? 0);
    return base === null || traits.skillBonuses[id] === null ? null : base + (traits.skillBonuses[id] ?? 0);
  };
  const text = (name: string, value: unknown) => {
    const field = form.getTextField(name);
    field.disableReadOnly();
    field.setText(value === null || value === undefined ? '' : String(value));
    // Auto sizing keeps single-line fields inside their boxes.
    if (!field.acroField.getDefaultAppearance()) field.acroField.setDefaultAppearance('0 g\n/Helvetica 0 Tf');
    field.setFontSize(0);
    if (field.isMultiline()) {
      const rect = field.acroField.getWidgets()[0].getRectangle();
      const layout = layoutMultilineText(field.getText() ?? '', {
        font, alignment: field.getAlignment(),
        bounds: { x: 0, y: 0, width: rect.width - 4, height: rect.height - 4 },
      });
      field.setFontSize(Math.min(9, layout.fontSize));
    }
  };
  const check = (name: string, value: boolean) => {
    const field = form.getCheckBox(name);
    if (value) field.check(); else field.uncheck();
  };
  const lines = (...values: (string | undefined)[]) => values.filter(Boolean).join('\n');
  text('Imię postaci', character.name);
  text('Imię postaci 2', character.name);
  text('kip', `${character.class} ${character.level}`);
  text('poch', character.background);
  text('rasa', character.species);
  text('pd', stats.values.xp);
  text('pr z b', signed(proficiency));
  text('ins', stats.values.inspiration == null ? '' : stats.values.inspiration ? 'Tak' : 'Nie');
  text('kp', stats.values.ac);
  text('ini', signed(mod('dex') === null ? null : mod('dex')! + traits.initiativeBonus));
  text('szyb', stats.values.speed ?? traits.baseSpeed);
  text('max PW', stats.values.maxHp ?? traits.firstLevelMaxHp);
  text('akt PW', stats.values.hp);
  text('Tymcz PW', stats.values.tempHp);
  text('Łącznie', traits.hitDie ? `${character.level}k${traits.hitDie}` : '');
  text('Kosc W', stats.values.hitDice == null || !traits.hitDie ? '' : `${stats.values.hitDice}k${traits.hitDie}`);
  const perception = skillBonus('perception');
  text('Pasywna Madrosc', perception === null ? null : 10 + perception);
  definitions.abilities.forEach((ability, index) => {
    text(`Pole tekstowe ${29 + index * 2}`, stats.values[ability.id]);
    text(`Pole tekstowe ${30 + index * 2}`, signed(mod(ability.id)));
    const trained = traits.effectiveSavingThrows.includes(ability.id);
    text(['S', 'Zr', 'K', 'int', 'M', 'Ch'][index], signed(bonus(ability.id, trained ? 1 : 0)));
    check(`Pole wyboru ${index === 0 ? 31 : 35 + index}`, trained);
  });
  skills.forEach((id, index) => {
    text(index === 17 ? 'zwinne dlonie 150' : `Pole tekstowe ${133 + index}`, signed(skillBonus(id)));
    check(`Pole wyboru ${41 + index}`, (traits.effectiveSkills[id] ?? 0) > 0);
  });
  for (let index = 0; index < 3; index++) {
    check(`Pole wyboru ${59 + index}`, index < (stats.values.deathSuccesses ?? 0));
    check(`Pole wyboru ${62 + index}`, index < (stats.values.deathFailures ?? 0));
  }
  text('pozost biegl', lines(traits.languages.map(language => language.label).join(', '), [...traits.armor, ...traits.weapons, ...traits.tools].join(', '), stats.notes.languages, stats.notes.proficiencies));
  text('korzysci i zdolnosci', lines(character.subclass, traits.features.map(feature => feature.name).join('\n'), traits.feats.join(', '), stats.notes.features));
  text('pozost korz', lines([...traits.senses, ...traits.defenses].join('\n'), traits.resources.map(resource => `${resource.name}: ${resource.value}`).join('\n'), stats.notes.defenses, stats.notes.senses, stats.notes.conditions, stats.notes.resources, stats.values.exhaustion == null ? '' : `Wyczerpanie: ${stats.values.exhaustion}`));
  text('ataki i magia', stats.notes.attacks);
  text('wyposazenie.0.0', items.map(item => `${item.name} ×${item.quantity}${item.equipped ? ' (założone)' : ''}`).join('\n'));
  const ability = magic.ability || stats.spellAbility;
  const spellMod = ability ? mod(ability) : null;
  if (ability) {
    text('Imię postaci 3', character.class);
    text('CB', definitions.abilities.find(entry => entry.id === ability)?.label);
    text('ST', spellMod === null ? null : 8 + proficiency + spellMod + (stats.values.spellDcBonus ?? 0));
    text('PR', signed(spellMod === null ? null : proficiency + spellMod + (stats.values.spellBonus ?? 0)));
  }
  const selected = new Set(magic.automatic.map(spell => spell.id));
  const prepared = new Set([...selected, ...(stats.spells.selections.prepared ?? [])]);
  // Only active profile groups: stale choices from a previous class must not leak.
  for (const group of magic.groups) {
    for (const id of stats.spells.selections[group.id] ?? []) if (group.options.some(spell => spell.id === id)) selected.add(id);
  }
  const overflow: string[] = [];
  for (let level = 0; level <= 9; level++) {
    const spells = [...selected].map(id => spellById.get(id)).filter(spell => spell?.level === level);
    const capacity = spellRows[level + 1] - spellRows[level];
    spells.forEach((spell, index) => {
      if (index >= capacity) { overflow.push(`${level}: ${spell!.name}`); return; }
      const row = spellRows[level] + index;
      text(row === 0 ? 'czar' : `czar ${row}`, spell!.name);
      if (level > 0) {
        const mark = row - 8;
        check(mark === 0 ? 'kropka' : `kropka ${mark}`, prepared.has(spell!.id));
      }
    });
    const slots = magic.pactSlotLevel ? (level === magic.pactSlotLevel ? magic.slots[0] : undefined) : magic.slots[level - 1];
    if (level > 0 && slots !== undefined) {
      if (level === 1) {
        // The original template has no form field over the level-one slot total.
        const field = form.createTextField('export.slots.1');
        field.addToPage(pdf.getPage(2), { x: 43.5, y: 450, width: 40.4, height: 25, borderWidth: 0, font });
        text('export.slots.1', slots);
      } else text(`K ${level - 1}`, slots);
    }
  }
  text('pozost korz2', lines(stats.notes.spells, overflow.length ? `Pozostałe czary:\n${overflow.join('\n')}` : ''));
  // Keep AcroForm fields editable. Embed a full font for later Polish input.
  for (const field of form.getFields()) if (field instanceof PDFTextField) field.updateAppearances(font);
  pdf.setTitle(`Karta postaci – ${character.name}`);
  return pdf.save();
}

export async function downloadCharacterPdf(character: Character, stats: CharacterStatistics, items: InventoryItem[]) {
  const fetchAsset = async (path: string) => {
    const response = await fetch(`/${path}`);
    if (!response.ok) throw new Error('Nie udało się wczytać szablonu lub czcionki PDF.');
    return response.arrayBuffer();
  };
  const [template, font] = await Promise.all([fetchAsset('character-sheet-pl.pdf'), fetchAsset('fonts/NotoSans.ttf')]);
  const bytes = await createCharacterPdf(character, stats, items, template, font);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${character.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'postac'}-karta.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
