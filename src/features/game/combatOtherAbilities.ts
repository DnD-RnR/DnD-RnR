import type { Character, CharacterStatistics } from '../../api';
import { characterTraits } from '../../../shared/character-traits.mjs';
import { rageProfile, recklessAttackDescription, barbarianLevel3Features } from '../../../shared/barbarian.mjs';

type Entry = readonly [string, string];

// Explicit classification: never infer an action cost from words inside a description.
const otherFeats = new Set(['alert', 'arcane-artist', 'arcane-eloquence', 'arcane-overload', 'familiar-friend', 'lucky', 'portal-jumper', 'savage-attacker', 'sharp-eye']);
const reactionFeats = new Set(['arcane-omens', 'transmuted-anatomy']);
const otherInvocations = new Set(['eldritch-smite', 'lifedrinker', 'repelling-blast', 'expendable-minions']);
const otherFeatures = new Set(['Psychic Spells', "Dark One’s Own Luck", "Dark One's Own Luck"]);

export function combatOtherAbilities(character: Character, statistics: CharacterStatistics | null) {
  const other: Entry[] = [];
  const reaction: Entry[] = [];
  if (character.class.includes('Fighter') && character.level >= 2) other.push(['Action Surge — bez akcji', 'We własnej turze możesz wykonać jedną dodatkową akcję, z wyjątkiem akcji Magia. Po użyciu odzyskujesz tę zdolność po krótkim lub długim odpoczynku. Od 17. poziomu masz dwa użycia między odpoczynkami, ale nadal tylko jedno na turę.']);
  const rage = rageProfile(character);
  if (rage.recklessAttack) other.push(['Reckless Attack — bez akcji', recklessAttackDescription]);
  if (rage.berserker) other.push(['Frenzy — przy trafieniu', barbarianLevel3Features.berserker.description]);
  if (rage.relentless) other.push(['Relentless Rage — bez akcji', `Gdy w Szale spadasz do 0 PW i nie giniesz natychmiast, możesz wykonać rzut obronny na Kondycję (ST 10). Sukces pozostawia cię na ${2 * character.level} PW. Każde kolejne użycie zwiększa ST o 5; krótki lub długi odpoczynek przywraca ST 10.`]);
  if (character.species === 'Ork (Orc)') other.push(['Relentless Endurance — bez akcji', 'Gdy spadasz do 0 PW i nie giniesz natychmiast, możesz pozostać na 1 PW. Raz na długi odpoczynek.']);
  if (!statistics) return { other, reaction };
  const traits = characterTraits(character, statistics);
  for (const feat of traits.originFeatEntries) {
    const description = [feat.description, ...feat.details].join(' ');
    if (otherFeats.has(feat.id)) other.push([feat.name, description]);
    if (reactionFeats.has(feat.id)) reaction.push([feat.name, description]);
    if (feat.id === 'survivor') {
      other.push(['Survivor — inicjatywa', 'Przy inicjatywie możesz przerzucić k20 z wynikiem 9 lub niższym; musisz użyć nowego wyniku.']);
      reaction.push(['Survivor — rzut obronny', 'Po nieudanym rzucie przeciw Charmed lub Frightened możesz reakcją dodać premię biegłości; raz na długi odpoczynek.']);
    }
    if (feat.id === 'healer') other.push(['Healing Rerolls — bez akcji', traits.originFeatDescriptions['Healing Rerolls (Przerzuty leczenia)']]);
  }
  for (const feature of traits.features) {
    if (otherFeatures.has(feature.name) && feature.description) other.push([feature.name, feature.description]);
    if (feature.name === 'Clairvoyant Combatant') other.push(['Odnowienie Clairvoyant Combatant — bez akcji', 'Wydaj miejsce Pact Magic, aby odzyskać użycie Clairvoyant Combatant.']);
  }
  for (const invocation of traits.invocationEntries) {
    if (otherInvocations.has(invocation.id.split(':')[0])) other.push([invocation.name, [invocation.description, ...invocation.details].join(' ')]);
    if (['investment-of-the-chain-master', 'call-of-the-void'].includes(invocation.id)) reaction.push([`${invocation.name} — ochrona chowańca`, invocation.id === 'call-of-the-void' ? 'Reakcją nadajesz Voidwalkerowi odporność na otrzymywane obrażenia.' : 'Reakcją nadajesz chowańcowi odporność na otrzymywane obrażenia.']);
  }
  const ancestry = traits.goliathAncestry;
  if (ancestry && ['fire', 'frost', 'hill'].includes(ancestry.id)) other.push([ancestry.label.split(' — ')[0], `${ancestry.label}. Efekt przy trafieniu; liczba użyć równa premii biegłości na długi odpoczynek.`]);
  if (ancestry && ['stone', 'storm'].includes(ancestry.id)) reaction.push([ancestry.label.split(' — ')[0], `${ancestry.label}. Wymaga reakcji; liczba użyć równa premii biegłości na długi odpoczynek.`]);
  return { other, reaction };
}
