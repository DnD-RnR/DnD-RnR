export function armorClassFromEquipment(stats, equipment = [], character = {}) {
  const armor = equipment.find(item => item.armorCategory && item.armorCategory !== 'shield' && item.equipped);
  const shield = equipment.find(item => item.armorCategory === 'shield' && item.equipped);
  const dex = stats.values.dex == null ? null : Math.floor((stats.values.dex - 10) / 2);
  if ((!armor || armor.armorCategory !== 'heavy') && dex === null) return null;
  let ac = armor ? Number.parseInt(armor.armorClass, 10) : 10;
  if (!armor) {
    ac += dex;
    // Alternative base calculations replace the standard base; they never stack.
    if (stats.armorClassBase !== 'standard') {
      const ability = character.class?.includes('Barbarian') ? 'con'
        : character.class?.includes('Monk') && !shield ? 'wis' : null;
      if (ability) {
        if (stats.values[ability] == null) return null;
        ac += Math.floor((stats.values[ability] - 10) / 2);
      }
    }
  } else if (armor.armorCategory !== 'heavy') {
    ac += armor.armorCategory === 'medium' ? Math.min(dex, 2) : dex;
  }
  if (shield && shield.trained !== false) ac += Number.parseInt(shield.armorClass, 10) || 0;
  if (armor && stats.choices?.fightingStyle === 'defense' && ['light', 'medium', 'heavy'].includes(armor.armorCategory)) ac += 1;
  return ac;
}

export function armorSpeedPenalty(stats, equipment = []) {
  const armor = equipment.find(item => item.armorCategory && item.armorCategory !== 'shield' && item.equipped);
  const strength = armor?.strength ?? null;
  return strength !== null && (stats.values.str === null || stats.values.str < strength) ? 10 : 0;
}

export function speedFromEquipment(stats, equipment, baseSpeed) {
  return baseSpeed === null ? null : Math.max(0, baseSpeed - armorSpeedPenalty(stats, equipment));
}

export function hasStealthDisadvantage(equipment = []) {
  return equipment.some(item => item.equipped && item.stealthDisadvantage);
}

export function hasArmorTraining(traits, category) {
  const training = traits.armor.join(' ').toLowerCase();
  return category === 'shield' ? training.includes('shield') : training.includes(category);
}

export function armorTrainingEffects(traits, equipment = []) {
  const armor = equipment.find(item => item.equipped && item.armorCategory && item.armorCategory !== 'shield');
  const shield = equipment.find(item => item.equipped && item.armorCategory === 'shield');
  const untrainedArmor = Boolean(armor && !hasArmorTraining(traits, armor.armorCategory));
  const untrainedShield = Boolean(shield && !hasArmorTraining(traits, 'shield'));
  return {
    untrainedArmor,
    untrainedShield,
    d20StrengthDexDisadvantage: untrainedArmor,
    spellcastingBlocked: untrainedArmor,
  };
}
