import { resourceState, saveResources } from './spell-resources.mjs';
import { spellcastingProfile } from '../shared/spellcasting.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
export function paladinResources(character, state = {}) {
  const enabled = character?.class === 'Paladyn (Paladin)' && character.level >= 1;
  const max = enabled ? character.level * 5 : 0;
  const channelDivinityMax = enabled && character.level >= 3 ? (character.level >= 11 ? 3 : 2) : 0;
  return { enabled, layOnHandsMax: max, layOnHandsRemaining: Math.max(0, max - (state.layOnHandsSpent ?? 0)), smiteAvailable: enabled && character.level >= 2 && !state.paladinSmiteUsed,
    channelDivinityMax, channelDivinityRemaining: Math.max(0, channelDivinityMax - (state.channelDivinitySpent ?? 0)),
    divineSense: channelDivinityMax && state.divineSense?.expiresAt > Date.now() ? state.divineSense : null };
}

export function restPaladin(character, state, rest) {
  const { channelDivinityMax } = paladinResources(character, state);
  if (channelDivinityMax) state.channelDivinitySpent = rest === 'long' ? 0 : Math.max(0, (state.channelDivinitySpent ?? 0) - 1);
}

export function syncDivineSense(db, battle) {
  for (const fighter of battle.fighters) {
    if (!fighter.characterId) continue;
    const state = resourceState(db, fighter.characterId);
    if (state.divineSense && (state.divineSense.expiresAt <= Date.now() || fighter.incapacitated || fighter.unconscious || fighter.hp <= 0 || fighter.deathFailures >= 3)) {
      state.divineSense = null;
      saveResources(db, fighter.characterId, state);
    }
    fighter.divineSense = state.divineSense ?? null;
  }
}

export function paladinChoiceUpdate(character, spells, stored, resources) {
  if (character.class !== 'Paladyn (Paladin)') return {};
  const prior = stored?.paladinProgression;
  const history = structuredClone(prior ?? { level: character.level, cantripSwaps: 0 });
  if (character.level < history.level) return { error: 'Paladin: przywróć zapisany poziom.' };
  history.cantripSwaps += character.level - history.level;
  const profile = spellcastingProfile(character, spells);
  for (const group of profile.groups) {
    if ((spells.selections[group.id] ?? []).length !== group.limit) return { error: `Paladin: uzupełnij ${group.id}.` };
  }
  const before = prior?.spells ?? stored?.spells;
  const rest = resources.lastLongRest ?? 0;
  const removed = id => (before?.selections?.[id] ?? []).filter(s => !(spells.selections[id] ?? []).includes(s)).length;
  if (removed('prepared')) {
    if (removed('prepared') > 1 || rest === (history.preparedRest ?? rest)) return { error: 'Paladin: wymień jeden przygotowany czar po długim odpoczynku.' };
    history.preparedRest = rest;
  }
  history.preparedRest ??= rest;
  if (before?.choices?.style !== undefined && before.choices.style !== spells.choices.style) return { error: 'Paladin: Blessed Warrior jest stałym wyborem.' };
  if (removed('styleCantrips') > history.cantripSwaps) return { error: 'Paladin: wymień jedną sztuczkę na zdobyty poziom.' };
  history.cantripSwaps -= removed('styleCantrips');
  history.level = character.level;
  history.spells = structuredClone(spells);
  return { history };
}

export function handlePaladin({ db, b, body, canControl, activeMember, persistVitals, log }) {
  if (!['lay-on-hands', 'divine-sense'].includes(body.kind)) return false;
  const actor = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn]?.id));
  check(actor?.characterId && canControl(actor) && activeMember(db, b.sessionId, actor), 'Nie możesz sterować tą postacią.');
  check(actor.id === b.fighters[b.turn]?.id && !b.pending && !b.fighters.some(f => f.concentrationDC || f.relentlessRagePending), 'Wymagana własna tura bez oczekujących działań.');
  check(actor.hp > 0 && actor.deathFailures < 3 && !actor.incapacitated && !actor.unconscious && !actor.bonus, 'Akcja dodatkowa jest niedostępna.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(actor.characterId);
  const state = resourceState(db, actor.characterId);
  const profile = paladinResources(character, state);
  if (body.kind === 'divine-sense') {
    check(profile.channelDivinityRemaining > 0, 'Divine Sense wymaga 3. poziomu paladyna i dostępnego Channel Divinity.');
    state.channelDivinitySpent = (state.channelDivinitySpent ?? 0) + 1;
    state.divineSense = { expiresAt: Date.now() + 10 * 60 * 1000, radiusFeet: 60, creatureTypes: ['celestial', 'fiend', 'undead'], detectsConsecration: true, detectsDesecration: true };
    actor.divineSense = state.divineSense;
    actor.bonus = 'Divine Sense';
    saveResources(db, actor.characterId, state);
    log(b, `${actor.name}: Divine Sense — 10 minut, 60 stóp. GM ujawnia położenie i typ Celestials, Fiends i Undead oraz obecność miejsc i obiektów poświęconych lub sprofanowanych.`);
    return true;
  }
  check(profile.enabled, 'Lay on Hands wymaga klasy Paladin.');
  const target = b.fighters.find(f => f.id === body.targetId);
  check(target && target.deathFailures < 3, 'Wybierz żywy cel w zasięgu dotyku (zasięg sprawdza GM).');
  const poison = body.mode === 'poison';
  check(poison || body.mode === 'heal', 'Wybierz heal albo poison.');
  const cost = poison ? 5 : body.amount;
  check(Number.isInteger(cost) && cost > 0 && cost <= profile.layOnHandsRemaining, 'Brak punktów Lay on Hands lub niepoprawna liczba.');
  if (!poison) {
    check(Number.isFinite(target.maxHp), 'Uzupełnij maksymalne PW celu.');
    target.hp = Math.min(target.maxHp, target.hp + cost);
    if (target.hp > 0) { target.deathSuccesses = 0; target.deathFailures = 0; target.unconscious = false; }
    persistVitals(db, target);
  }
  state.layOnHandsSpent = (state.layOnHandsSpent ?? 0) + cost;
  actor.bonus = 'Lay on Hands';
  saveResources(db, actor.characterId, state);
  log(b, `${actor.name}: Lay on Hands → ${target.name}, ${cost} pkt. ${poison ? 'Usunięto Poisoned — GM aktualizuje opis stanów.' : 'Przywrócono PW.'}`);
  return true;
}
