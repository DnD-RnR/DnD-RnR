import { strongestEffects } from './timed-effects.mjs';

// SRD 5.2, Rules Glossary. Spatial and sensory exceptions are confirmed by the GM.
export const conditionDefinitions = {
  charmed: { label: 'Charmed — Zauroczony', description: 'Nie może atakować sprawcy ani obejmować go szkodliwymi zdolnościami i magią. Sprawca ma ułatwienie społecznych testów wobec celu.' },
  frightened: { label: 'Frightened — Przerażony', description: 'Utrudnienie ataków i testów cech, gdy źródło strachu jest w linii widzenia. Nie może dobrowolnie się do niego zbliżyć.' },
  grappled: { label: 'Grappled — Pochwycony', description: 'Szybkość 0. Utrudnienie ataków na cele inne niż chwytający. Ucieczka akcją: Athletics lub Acrobatics przeciw ST chwytu. MG ustala zasięg i przeciąganie.' },
  invisible: { label: 'Invisible — Niewidzialny', description: 'Ułatwienie inicjatywy. Ułatwienie własnych ataków, utrudnienie ataków przeciw niemu oraz ochrona przed efektami wymagającymi widzenia; wyjątki dla stworzeń, które go widzą.' },
  exhaustion: { label: 'Exhaustion — Wyczerpanie', description: 'Za poziom: −2 do testów d20 i −5 stóp szybkości. Poziom 6 oznacza śmierć. Długi odpoczynek usuwa jeden poziom.' },
  blinded: { label: 'Blinded — Oślepiony', description: 'Brak widzenia. Utrudnienie ataków, ułatwienie ataków przeciw celowi; test wymagający widzenia automatycznie nieudany.' },
  deafened: { label: 'Deafened — Ogłuchły', description: 'Brak słuchu; test wymagający słyszenia automatycznie nieudany.' },
  incapacitated: { label: 'Incapacitated — Obezwładniony', description: 'Brak akcji, akcji bonusowych, reakcji, mowy i koncentracji. Sam ten stan nie zeruje szybkości.' },
  paralyzed: { label: 'Paralyzed — Sparaliżowany', description: 'Incapacitated, szybkość 0, automatyczna porażka STR/DEX. Ataki przeciw celowi mają ułatwienie; trafienie z 5 stóp jest krytyczne.' },
  petrified: { label: 'Petrified — Skamieniały', description: 'Incapacitated, szybkość 0, automatyczna porażka STR/DEX. Ataki przeciw celowi mają ułatwienie. Odporność na wszystkie obrażenia i niewrażliwość na Poisoned. Waga ×10, brak starzenia.' },
  poisoned: { label: 'Poisoned — Zatruty', description: 'Utrudnienie ataków i testów cech.' },
  prone: { label: 'Prone — Powalony', description: 'Tylko czołganie lub wstanie za połowę szybkości. Utrudnienie własnych ataków; ataki przeciw celowi: ułatwienie do 5 stóp, poza nimi utrudnienie.' },
  restrained: { label: 'Restrained — Unieruchomiony', description: 'Szybkość 0. Utrudnienie ataków i rzutów DEX, ułatwienie ataków przeciw celowi.' },
  stunned: { label: 'Stunned — Ogłuszony', description: 'Incapacitated, automatyczna porażka STR/DEX, ułatwienie ataków przeciw celowi. Stan sam w sobie nie zeruje szybkości.' },
  unconscious: { label: 'Unconscious — Nieprzytomny', description: 'Incapacitated i Prone, szybkość 0, automatyczna porażka STR/DEX. Ataki przeciw celowi mają ułatwienie; trafienie z 5 stóp jest krytyczne. Po odzyskaniu przytomności pozostaje Prone; upuszczone przedmioty ustala MG.' },
};
export function conditionsOf(fighter) {
  if (!fighter) return new Set();
  const result = new Set(fighter.manualConditions ?? []);
  for (const id of fighter.visibleConditions ?? []) result.add(id);
  for (const e of fighter.conditionSources ?? []) result.add(e.kind);
  for (const e of fighter.zoneConditions ?? []) result.add(e.kind);
  if (fighter.exhaustion > 0) result.add('exhaustion');
  for (const name of Object.keys(conditionDefinitions)) if (fighter[name] === true) result.add(name);
  for (const e of fighter.spellConditions ?? []) if (conditionDefinitions[e.kind]) result.add(e.kind);
  for (const e of strongestEffects(fighter.timedEffects)) if (e.modifiers.condition) result.add(e.modifiers.condition);
  if (fighter.hp === 0 && !fighter.relentlessRagePending) result.add('unconscious');
  if (result.has('unconscious')) result.add('prone');
  if (['paralyzed', 'petrified', 'stunned', 'unconscious'].some(c => result.has(c))) result.add('incapacitated');
  if (fighter.rage && fighter.rageProfile?.berserker && fighter.level >= 6) { result.delete('charmed'); result.delete('frightened'); }
  if (result.has('petrified') || fighter.poisonConditionImmune) result.delete('poisoned');
  return result;
}
export const hasCondition = (fighter, kind) => conditionsOf(fighter).has(kind);
export const isIncapacitated = fighter => hasCondition(fighter, 'incapacitated');
export const conditionSpeedZero = fighter => Boolean(fighter?.branchHold) || ['paralyzed', 'petrified', 'unconscious', 'restrained', 'grappled'].some(c => hasCondition(fighter, c)) || strongestEffects(fighter.timedEffects).some(e => e.modifiers.speedZero);
export const exhaustionPenalty = fighter => 2 * Math.min(6, Math.max(0, fighter?.exhaustion ?? 0));
export function conditionSourcesOf(fighter, kind) {
  if (fighter?.rage && fighter.rageProfile?.berserker && fighter.level >= 6 && ['charmed', 'frightened'].includes(kind)) return [];
  return [...(fighter?.conditionSources ?? []).filter(e => e.kind === kind), ...strongestEffects(fighter?.timedEffects).filter(e => e.modifiers.condition === kind).map(e => ({ kind, sourceId: e.sourceFighterId, visible: true }))];
}
export const cannotHarm = (actor, target) => conditionSourcesOf(actor, 'charmed').some(e => e.sourceId === target?.id);
export const socialAdvantage = (actor, target) => conditionSourcesOf(target, 'charmed').some(e => e.sourceId === actor?.id);
export const invisibleBenefits = fighter => hasCondition(fighter, 'invisible') && !fighter?.spellConditions?.some(e => e.kind === 'starry-wisp');
export const canSeeConditionTarget = (viewer, target) => viewer?.seenInvisibleIds?.includes(target?.id) || !hasCondition(viewer, 'blinded') && !invisibleBenefits(target);
export const automaticSaveFailure = (fighter, ability) => ['str', 'dex'].includes(ability) && ['paralyzed', 'petrified', 'stunned', 'unconscious'].some(c => hasCondition(fighter, c));
export const conditionSaveDisadvantage = (fighter, ability) => ability === 'dex' && hasCondition(fighter, 'restrained') || ability === 'str' && strongestEffects(fighter?.timedEffects).some(e => e.modifiers.strDisadvantage);
export const conditionSaveAdvantage = (fighter, ability) => ability === 'dex' && strongestEffects(fighter?.timedEffects).some(e => e.modifiers.dexAdvantage) || ability === 'str' && strongestEffects(fighter?.timedEffects).some(e => e.modifiers.strAdvantage);
export const conditionCheckAdvantage = (fighter, ability) => ability === 'str' && strongestEffects(fighter?.timedEffects).some(e => e.modifiers.strAdvantage);
export const automaticCheckFailure = (fighter, context = {}) => Boolean(context.requiresSight && hasCondition(fighter, 'blinded') || context.requiresHearing && hasCondition(fighter, 'deafened'));
export const conditionCheckDisadvantage = (fighter, ability) => Boolean(hasCondition(fighter, 'poisoned') || ability === 'str' && strongestEffects(fighter?.timedEffects).some(e => e.modifiers.strDisadvantage) || conditionSourcesOf(fighter, 'frightened').some(e => e.visible !== false) || fighter?.spellConditions?.some(e => e.kind === 'heated-metal'));
export function conditionAttackModifiers(attacker, target, context = {}) {
  const attacking = conditionsOf(attacker), defending = conditionsOf(target);
  return {
    advantage: ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'].some(c => defending.has(c)) || !target?.proneFighting && defending.has('prone') && context.within5Feet === true || invisibleBenefits(attacker) && !canSeeConditionTarget(target, attacker),
    disadvantage: ['blinded', 'poisoned', 'restrained'].some(c => attacking.has(c)) || !attacker?.proneFighting && attacking.has('prone') || conditionSourcesOf(attacker, 'frightened').some(e => e.visible !== false) || conditionSourcesOf(attacker, 'grappled').some(e => e.sourceId !== target?.id) || invisibleBenefits(target) && !canSeeConditionTarget(attacker, target) || attacker?.spellConditions?.some(e => e.kind === 'heated-metal') || !target?.proneFighting && defending.has('prone') && context.within5Feet !== true,
    criticalOnHit: context.within5Feet === true && (defending.has('paralyzed') || defending.has('unconscious')),
  };
}
