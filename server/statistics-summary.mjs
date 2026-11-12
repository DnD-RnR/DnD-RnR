import definitions from '../shared/statistics.json' with { type: 'json' };
import { characterTraits } from '../shared/character-traits.mjs';
import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { emptyStatistics } from './statistics.mjs';
import { armorClassFromEquipment, armorTrainingEffects, hasArmorTraining, hasStealthDisadvantage, speedFromEquipment } from './armor-class.mjs';

export function statisticsSummary(character, stored, equipment = []) {
  const defaults = emptyStatistics();
  const stats = { ...defaults, ...stored, values: { ...defaults.values, ...stored?.values }, skills: { ...defaults.skills, ...stored?.skills } };
  stats.spells ??= defaults.spells;
  stats.traits ??= defaults.traits;
  const traits = characterTraits(character, stats);
  const trainingEquipment = equipment.map(item => ({ ...item, trained: hasArmorTraining(traits, item.armorCategory) }));
  const trainingEffects = armorTrainingEffects(traits, equipment);
  const proficiency = 2 + Math.floor((character.level - 1) / 4);
  const modifier = id => stats.values[id] == null ? null : Math.floor((stats.values[id] - 10) / 2);
  const skills = Object.fromEntries(definitions.skills.map(skill => {
    const mod = modifier(skill.ability);
    const extra = traits.skillBonuses[skill.id];
    return [skill.id, mod === null || extra === null ? null : mod + proficiency * traits.effectiveSkills[skill.id] + extra];
  }));
  const spellAbility = spellcastingProfile(character, stats.spells, stats.traits).ability || stats.spellAbility;
  const spellMod = spellAbility ? modifier(spellAbility) : null;
  const dex = modifier('dex');
  return {
    hp: stats.values.hp, maxHp: stats.values.maxHp ?? traits.firstLevelMaxHp, tempHp: stats.values.tempHp,
    ac: armorClassFromEquipment(stats, trainingEquipment, character), speed: speedFromEquipment(stats, equipment, stats.values.speed ?? traits.baseSpeed), stealthDisadvantage: hasStealthDisadvantage(equipment), ...trainingEffects, proficiency,
    initiative: dex === null ? null : dex + traits.initiativeBonus,
    passivePerception: skills.perception === null ? null : 10 + skills.perception,
    deathSuccesses: stats.values.deathSuccesses, deathFailures: stats.values.deathFailures,
    exhaustion: stats.values.exhaustion, inspiration: stats.values.inspiration,
    spellAttack: spellMod === null ? null : spellMod + proficiency + (stats.values.spellBonus ?? 0),
    spellDc: spellMod === null ? null : 8 + proficiency + spellMod + (stats.values.spellDcBonus ?? 0),
    abilities: Object.fromEntries(definitions.abilities.map(a => [a.id, { score: stats.values[a.id], modifier: modifier(a.id) }])),
    savingThrows: Object.fromEntries(definitions.abilities.map(a => {
      const mod = modifier(a.id);
      return [a.id, mod === null ? null : mod + (traits.effectiveSavingThrows.includes(a.id) ? proficiency : 0)];
    })),
    skills,
  };
}
