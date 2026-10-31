// Explicit mechanics; prose is never parsed into rules at runtime.
export const spellEffects = {
  'shield': { mode: 'shield' },
  'fire-bolt': { mode: 'attack', dice: 1, sides: 10, cantrip: true, type: 'Fire' },
  'sacred-flame': { mode: 'save', save: 'dex', dice: 1, sides: 8, cantrip: true, type: 'Radiant' },
  'acid-splash': { mode: 'save', save: 'dex', dice: 1, sides: 6, cantrip: true, area: true, type: 'Acid' },
  'thunderclap': { mode: 'save', save: 'con', dice: 1, sides: 6, cantrip: true, area: true, type: 'Thunder' },
  'poison-spray': { mode: 'attack', dice: 1, sides: 12, cantrip: true, type: 'Poison' },
  'toll-the-dead': { mode: 'save', save: 'wis', dice: 1, sides: 8, cantrip: true, woundedSides: 12, type: 'Necrotic' },
  'vicious-mockery': { mode: 'save', save: 'wis', dice: 1, sides: 6, cantrip: true, type: 'Psychic', rider: 'mockery' },
  'dissonant-whispers': { mode: 'save', save: 'wis', dice: 3, sides: 6, perLevel: 1, half: true, type: 'Psychic', rider: 'flee' },
  'cure-wounds': { mode: 'heal', dice: 2, sides: 8, perLevel: 2, ability: true },
  'healing-word': { mode: 'heal', dice: 2, sides: 4, perLevel: 2, ability: true },
  'burning-hands': { mode: 'save', save: 'dex', dice: 3, sides: 6, perLevel: 1, area: true, half: true, type: 'Fire' },
  'thunderwave': { mode: 'save', save: 'con', dice: 2, sides: 8, perLevel: 1, area: true, half: true, type: 'Thunder', rider: 'push' },
  'inflict-wounds': { mode: 'save', save: 'con', dice: 2, sides: 10, perLevel: 1, half: true, type: 'Necrotic' },
  'fireball': { mode: 'save', save: 'dex', dice: 8, sides: 6, perLevel: 1, area: true, half: true, type: 'Fire' },
  'lightning-bolt': { mode: 'save', save: 'dex', dice: 8, sides: 6, perLevel: 1, area: true, half: true, type: 'Lightning' },
  'shatter': { mode: 'save', save: 'con', dice: 3, sides: 8, perLevel: 1, area: true, half: true, type: 'Thunder' },
  'cone-of-cold': { mode: 'save', save: 'con', dice: 8, sides: 8, perLevel: 1, area: true, half: true, type: 'Cold' },
};
export const spellAction = s => s.castingTime.startsWith('Bonus Action') ? 'bonus' : s.castingTime.startsWith('Reaction') ? 'reaction' : s.castingTime === 'Action' ? 'action' : null;
