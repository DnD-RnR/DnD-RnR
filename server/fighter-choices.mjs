import { additionalFightingStyleValid } from '../shared/fighting-style.mjs';
import { resourceState } from './spell-resources.mjs';

// Progression metadata is server-owned and survives full statistics updates.
export function fighterChoiceUpdate(db, character, previous, choices) {
  const old = previous?.choices ?? {};
  const prior = previous?.fighterChoices ?? {};
  const style = choices.fightingStyle ?? '';
  const additional = choices.additionalFightingStyle ?? '';
  if (!additionalFightingStyleValid(character, style, additional)) return { error: 'Choose a distinct Fighting Style for Champion level 7.' };
  if (!character.class?.includes('Fighter') && character.class !== 'Paladyn (Paladin)') return { history: previous?.fighterChoices };
  if (character.class === 'Paladyn (Paladin)' && style && previous?.spells?.choices?.style === 'magic') return { error: 'Blessed Warrior zast?puje Fighting Style.' };
  const before = old.weaponMastery ?? [];
  const after = choices.weaponMastery ?? [];
  const history = { ...prior };
  const changed = style !== (old.fightingStyle ?? '');
  const changedAdditional = additional !== (old.additionalFightingStyle ?? '');
  const replacements = Number(Boolean(old.fightingStyle && changed)) + Number(Boolean(old.additionalFightingStyle && changedAdditional));
  if (replacements && (replacements > 1 || character.class === 'Paladyn (Paladin)' || character.level <= (prior.styleLevel ?? character.level))) {
    return { error: 'Fighting Style can be replaced once when gaining a Fighter level.' };
  }
  if (changed || changedAdditional) history.styleLevel = character.level;
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
