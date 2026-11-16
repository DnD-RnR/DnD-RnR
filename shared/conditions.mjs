import { strongestEffects } from './timed-effects.mjs';

// SRD 5.2, Rules Glossary. Spatial and sensory exceptions are confirmed by the GM.
export const conditionDefinitions = {
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
  for (const name of Object.keys(conditionDefinitions)) if (fighter[name] === true) result.add(name);
  for (const e of fighter.spellConditions ?? []) if (conditionDefinitions[e.kind]) result.add(e.kind);
  for (const e of strongestEffects(fighter.timedEffects)) if (e.modifiers.condition) result.add(e.modifiers.condition);
  if (fighter.hp === 0 && !fighter.relentlessRagePending) result.add('unconscious');
  if (result.has('unconscious')) result.add('prone');
  if (['paralyzed', 'petrified', 'stunned', 'unconscious'].some(c => result.has(c))) result.add('incapacitated');
  if (result.has('petrified')) result.delete('poisoned');
  return result;
}
export const hasCondition = (fighter, kind) => conditionsOf(fighter).has(kind);
export const isIncapacitated = fighter => hasCondition(fighter, 'incapacitated');
export const conditionSpeedZero = fighter => ['paralyzed', 'petrified', 'unconscious', 'restrained'].some(c => hasCondition(fighter, c)) || strongestEffects(fighter.timedEffects).some(e => e.modifiers.speedZero);
export const automaticSaveFailure = (fighter, ability) => ['str', 'dex'].includes(ability) && ['paralyzed', 'petrified', 'stunned', 'unconscious'].some(c => hasCondition(fighter, c));
export const conditionSaveDisadvantage = (fighter, ability) => ability === 'dex' && hasCondition(fighter, 'restrained');
export const automaticCheckFailure = (fighter, context = {}) => Boolean(context.requiresSight && hasCondition(fighter, 'blinded') || context.requiresHearing && hasCondition(fighter, 'deafened'));
export const conditionCheckDisadvantage = fighter => hasCondition(fighter, 'poisoned');
export function conditionAttackModifiers(attacker, target, context = {}) {
  const attacking = conditionsOf(attacker), defending = conditionsOf(target);
  return {
    advantage: ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'].some(c => defending.has(c)) || defending.has('prone') && context.within5Feet === true,
    disadvantage: ['blinded', 'poisoned', 'prone', 'restrained'].some(c => attacking.has(c)) || defending.has('prone') && context.within5Feet !== true,
    criticalOnHit: context.within5Feet === true && (defending.has('paralyzed') || defending.has('unconscious')),
  };
}
