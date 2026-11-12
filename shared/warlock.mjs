export function fiendProfile(character, charisma) {
  const enabled = Boolean(character?.class?.includes('(Warlock)') && character.subclass === 'Fiend Patron' && character.level >= 3);
  return { enabled, temporaryHitPoints: enabled && Number.isFinite(charisma) ? Math.max(1, character.level + Math.floor((charisma - 10) / 2)) : null, nearbyFeet: 10 };
}
