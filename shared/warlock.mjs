export function fiendProfile(character, charisma) {
  const enabled = Boolean(character?.class?.includes('(Warlock)') && character.subclass === 'Fiend Patron' && character.level >= 3);
  return { enabled, temporaryHitPoints: enabled && Number.isFinite(charisma) ? Math.max(1, character.level + Math.floor((charisma - 10) / 2)) : null, nearbyFeet: 10 };
}

export const resilienceTypes = ['obuchowe', 'kłute', 'cięte', 'kwas', 'zimno', 'ogień', 'błyskawice', 'trucizna', 'nekrotyczne', 'promieniste', 'psychiczne', 'grom'];
export function warlockProfile(character, charisma, state = {}) {
  const enabled = Boolean(character?.class?.includes('(Warlock)'));
  const level = enabled ? character.level : 0;
  const modifier = Number.isFinite(charisma) ? Math.floor((charisma - 10) / 2) : null;
  const fiend = fiendProfile(character, charisma);
  const greatOldOne = enabled && character.subclass === 'Great Old One Patron' && level >= 3;
  const luckMax = fiend.enabled && level >= 6 && modifier !== null ? Math.max(1, modifier) : 0;
  return { enabled, level, fiend, greatOldOne,
    cunningAvailable: level >= 2 && !state.magicalCunningUsed,
    contactPatronAvailable: level >= 9 && !state.contactPatronUsed,
    luckMax, luckRemaining: Math.max(0, luckMax - (state.darkLuckSpent ?? 0)),
    resilience: fiend.enabled && level >= 10, resistance: fiend.enabled && level >= 10 ? state.fiendResistance ?? null : null,
    resilienceChoiceAvailable: fiend.enabled && level >= 10 && state.fiendResilienceChosenAt !== (state.fiendResilienceEpoch ?? 0),
    telepathyMiles: greatOldOne && modifier !== null ? Math.max(1, modifier) : null,
    telepathyMinutes: greatOldOne ? level : 0,
    awakenedMind: greatOldOne && state.awakenedMind?.expiresAt > Date.now() ? state.awakenedMind : null,
    clairvoyantCombatant: greatOldOne && level >= 6,
    clairvoyantAvailable: greatOldOne && level >= 6 && !state.clairvoyantUsed,
    eldritchHex: greatOldOne && level >= 10, thoughtShield: greatOldOne && level >= 10,
  };
}
export const warlockDescriptions = {
  'Magical Cunning': 'Minutowy obrzęd: odnów połowę miejsc Pact Magic (w górę). Raz na długi odpoczynek.',
  'Contact Patron': 'Contact Other Plane zawsze przygotowany. Raz na długi odpoczynek kontakt z patronem bez miejsca i z automatycznym sukcesem rzutu obronnego.',
  'Awakened Mind': 'Akcja dodatkowa: więź z widoczną istotą do 30 stóp. Czas: poziom minut. Zasięg: modyfikator CHA mil (minimum 1). Potrzebny wspólny język. Nowa więź kończy poprzednią.',
  'Psychic Spells': 'Możesz zmienić obrażenia czarów Warlocka na psychiczne. Enchantment i Illusion bez V i S; M nadal wymagane.',
  'Clairvoyant Combatant': 'Przy tworzeniu Awakened Mind wymuś WIS przeciw ST czarów. Porażka: twoje ataki przeciw celowi z ułatwieniem, jego przeciw tobie z utrudnieniem przez czas więzi. Odnowienie po krótkim/długim odpoczynku albo za miejsce Pact Magic bez akcji.',
  'Eldritch Hex': 'Hex zawsze przygotowany. Cel ma również utrudnienie rzutów obronnych wybranej cechy przez czas klątwy.',
  'Thought Shield': 'Odczyt myśli wymaga twojej zgody. Odporność na psychiczne; sprawca otrzymuje tyle obrażeń psychicznych, ile otrzymasz ty.',
  "Dark One’s Own Luck": 'Po zobaczeniu testu lub rzutu obronnego, przed skutkami, dodaj 1k10. Raz na rzut, modyfikator CHA użyć (minimum 1) na długi odpoczynek.',
  "Dark One's Own Luck": 'Po zobaczeniu testu lub rzutu obronnego, przed skutkami, dodaj 1k10. Raz na rzut, modyfikator CHA użyć (minimum 1) na długi odpoczynek.',
  'Fiendish Resilience': 'Po krótkim lub długim odpoczynku wybierz odporność na jeden typ obrażeń poza Force. Działa do kolejnego wyboru.',
};
export function bondAdvantage(actor, target) {
  return Boolean(actor?.warlockBond?.combat && actor.warlockBond.targetId === target?.id && actor.warlockBond.expiresAt > Date.now());
}
export function hexDisadvantage(b, target, ability, saving = true) {
  return b.fighters.some(f => f.hex?.targetId === target.id && f.hex.ability === ability && (!saving || f.hex.eldritch) && f.hex.expiresAt > Date.now() && f.concentration === f.hex.name);
}
export const damageTypeName = type => ({ Acid: 'kwas', Cold: 'zimno', Fire: 'ogień', Lightning: 'błyskawice', Poison: 'trucizna', Necrotic: 'nekrotyczne', Radiant: 'promieniste', Psychic: 'psychiczne', Force: 'moc', Thunder: 'grom', Bludgeoning: 'obuchowe', Piercing: 'kłute', Slashing: 'cięte' }[type] ?? type);
export function warlockResistance(f, type) {
  type = damageTypeName(type);
  return type && (f.warlockResistance === type || type === 'psychiczne' && f.thoughtShield);
}

export function hexActive(actor, target) {
  return Boolean(actor.hex?.targetId === target.id && actor.hex.expiresAt > Date.now() && actor.concentration === actor.hex.name);
}
