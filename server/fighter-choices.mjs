import { resourceState } from './spell-resources.mjs';

// Progression metadata is server-owned and survives full statistics updates.
export function fighterChoiceUpdate(db, character, previous, choices) {
  if (!character.class?.includes('Fighter') && character.class !== 'Paladyn (Paladin)') return { history: previous?.fighterChoices };
  const old = previous?.choices ?? {};
  const prior = previous?.fighterChoices ?? {};
  const style = choices.fightingStyle ?? '';
  if (character.class === 'Paladyn (Paladin)' && style && previous?.spells?.choices?.style === 'magic') return { error: 'Blessed Warrior zast?puje Fighting Style.' };
  const before = old.weaponMastery ?? [];
  const after = choices.weaponMastery ?? [];
  const history = { ...prior };
  if (old.fightingStyle && style !== old.fightingStyle
    && (character.class === 'Paladyn (Paladin)' || character.level <= (prior.styleLevel ?? character.level))) {
    return { error: 'Fighting Style można zmienić dopiero po awansie Fightera.' };
  }
  if (style !== (old.fightingStyle ?? '')) history.styleLevel = character.level;
  else history.styleLevel ??= character.level;
  const removed = before.filter(id => !after.includes(id));
  const added = after.filter(id => !before.includes(id));
  if (removed.length) {
    const lastLongRest = resourceState(db, character.id).lastLongRest;
    if ((character.class !== 'Paladyn (Paladin)' && (removed.length !== 1 || added.length !== 1)) || !lastLongRest || lastLongRest <= (prior.masteryRest ?? 0)) {
      return { error: 'Po długim odpoczynku możesz wymienić jedną broń Weapon Mastery.' };
    }
    history.masteryRest = lastLongRest;
  }
  return { history };
}
