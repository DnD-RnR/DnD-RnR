import { characterTraits } from './character-traits.mjs';
import { eligibleOriginFeats } from './origin-feats.mjs';

export const advancementSource = 'https://www.dndbeyond.com/sources/dnd/br-2024/creating-a-character#LevelAdvancement';
export function hasLevelFeat(character) {
  return [4, 8, 12, 16, 19].includes(character.level)
    || character.class.includes('Fighter') && [6, 14].includes(character.level)
    || character.class.includes('Rogue') && character.level === 10;
}
export function levelFeatOptions(character, statistics) {
  const owned = new Set(characterTraits(character, statistics).feats);
  return eligibleOriginFeats(character).filter(feat => !owned.has(feat.name) && !feat.list && !(feat.spells?.length) && !feat.cantrips?.length);
}
export function advancementPreview(character, statistics, draft) {
  const next = { ...character, level: character.level + 1, subclass: character.level === 2 ? draft.subclass || '' : character.subclass };
  const stats = structuredClone(statistics);
  const before = characterTraits(character, statistics);
  const increases = draft.increases ?? {};
  if (hasLevelFeat(next) && draft.featMode !== 'feat') {
    for (const id of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      if (Number.isInteger(stats.values[id])) stats.values[id] += Number(increases[id]) || 0;
    }
  }
  if (hasLevelFeat(next) && draft.featMode === 'feat' && draft.feat) {
    stats.levelFeats = [...(stats.levelFeats ?? []), { name: draft.feat, level: next.level }];
  }
  if (next.level === 20) {
    const ids = next.class.includes('Barbarian') ? ['str', 'con'] : next.class.includes('Monk') ? ['dex', 'wis'] : [];
    for (const id of ids) if (Number.isInteger(stats.values[id])) stats.values[id] = Math.min(25, stats.values[id] + 4);
  }
  stats.traits = draft.traits ?? stats.traits;
  stats.spells = draft.spells ?? stats.spells;
  stats.choices = draft.choices ?? stats.choices;
  const after = characterTraits(next, stats);
  const oldCon = Number.isInteger(statistics.values.con) ? Math.floor((statistics.values.con - 10) / 2) : null;
  const newCon = Number.isInteger(stats.values.con) ? Math.floor((stats.values.con - 10) / 2) : null;
  const die = before.hitDie;
  const roll = draft.hpMode === 'roll' ? draft.hpRoll : die ? die / 2 + 1 : null;
  const hpGain = oldCon === null || newCon === null || !Number.isInteger(roll) ? null
    : Math.max(1, roll + oldCon) + next.level * (newCon - oldCon) + after.hpBonus - before.hpBonus;
  if (Number.isInteger(statistics.values.maxHp) && hpGain !== null) stats.values.maxHp += hpGain;
  // Advancing never heals or replenishes spent resources.
  stats.proficiency = 2 + Math.floor((next.level - 1) / 4);
  const known = new Set(before.features.map(f => `${f.source}:${f.name}`));
  return { character: next, statistics: stats, hpGain, hitDie: die, features: after.features.filter(f => !known.has(`${f.source}:${f.name}`)) };
}
