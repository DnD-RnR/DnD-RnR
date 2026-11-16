// SRD 5.2 pp. 106, 179: different spells combine; strongest/latest same spell wins.
export const timedSpellDefinitions = {
  'color-spray': { seconds: 6, endPhase: 'end', dismissible: false, targets: 50, save: 'con', condition: 'blinded' },
  'blindness-deafness': { seconds: 60, targets: 1, targetsPerLevel: 1, save: 'con', conditionOptions: ['blinded', 'deafened'], repeatSave: 'con' },
  'hold-monster': { seconds: 60, concentration: true, targets: 1, targetsPerLevel: 1, save: 'wis', condition: 'paralyzed', repeatSave: 'wis' },
  'hold-person': { seconds: 60, concentration: true, targets: 1, targetsPerLevel: 1, save: 'wis', condition: 'paralyzed', repeatSave: 'wis', humanoid: true },
  'power-word-stun': { seconds: null, hostile: true, dismissible: false, targets: 1, condition: 'stunned', repeatSave: 'con', hpThreshold: 150 },
  bless: { seconds: 60, concentration: true, targets: 3, targetsPerLevel: 1, attackDie: 4, saveDie: 4 },
  bane: { seconds: 60, concentration: true, targets: 3, targetsPerLevel: 1, save: 'cha', attackPenaltyDie: 4, savePenaltyDie: 4 },
  'shield-of-faith': { seconds: 600, concentration: true, targets: 1, acBonus: 2 },
  longstrider: { seconds: 3600, targets: 1, targetsPerLevel: 1, speedBonus: 10 },
  stoneskin: { seconds: 3600, concentration: true, targets: 1, resistances: ['obuchowe', 'kłute', 'cięte'] },
  barkskin: { seconds: 3600, targets: 1, minimumAc: 17 },
  'mage-armor': { seconds: 28800, targets: 1, mageArmor: true },
  aid: { seconds: 28800, targets: 3, hpBonus: 5, hpPerLevel: 5 },
};
export function strongestEffects(effects = []) {
  const result = new Map();
  for (const effect of effects) {
    const previous = result.get(effect.spellId);
    if (!previous || (effect.potency ?? 0) > (previous.potency ?? 0) || (effect.potency ?? 0) === (previous.potency ?? 0) && effect.createdAt >= previous.createdAt) result.set(effect.spellId, effect);
  }
  return [...result.values()];
}
export const timedHpBonus = effects => strongestEffects(effects).reduce((n, e) => n + (e.modifiers.hpBonus ?? 0), 0);
export function timedAc(fighter) {
  if (fighter.ac == null) return null;
  const effects = strongestEffects(fighter.timedEffects);
  let base = fighter.ac;
  if (!fighter.wearingArmor && fighter.dexModifier != null && effects.some(e => e.modifiers.mageArmor)) base = Math.max(base, 13 + fighter.dexModifier + (fighter.equipmentShieldBonus ?? 0) + (fighter.shieldAC ?? 0));
  base += effects.reduce((n, e) => n + (e.modifiers.acBonus ?? 0), 0);
  return Math.max(base, ...effects.map(e => e.modifiers.minimumAc ?? 0));
}
export const timedSpeedBonus = fighter => strongestEffects(fighter.timedEffects).reduce((n, e) => n + (e.modifiers.speedBonus ?? 0), 0);
export const timedResistance = (fighter, type) => strongestEffects(fighter.timedEffects).some(e => e.modifiers.resistances?.includes(type));
export function timedRollModifier(fighter, body) {
  let modifier = 0;
  const effects = strongestEffects(fighter.timedEffects);
  for (const [spellId, key, sign] of [['bless', 'blessRoll', 1], ['bane', 'baneRoll', -1]]) {
    if (!effects.some(e => e.spellId === spellId)) continue;
    const roll = body[key];
    if (!Number.isInteger(roll) || roll < 1 || roll > 4) throw new Error(`${spellId === 'bless' ? 'Bless' : 'Bane'}: podaj k4.`);
    modifier += sign * roll;
  }
  return modifier;
}
