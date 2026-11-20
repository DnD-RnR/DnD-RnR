import { resourceState, saveResources, proficiencyBonus } from './spell-resources.mjs';
import { isIncapacitated } from '../shared/conditions.mjs';
import { healingBlocked, spellSpeed } from './spell-conditions.mjs';
import { persistConditionState } from './conditions.mjs';
import { timedSize } from '../shared/timed-effects.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const die = (n, sides) => Number.isInteger(n) && n >= 1 && n <= sides;
const effectAlive = (b, f, e) => e && e.expiresAt > Date.now() && (e.battleId !== (b.startedAt ?? b.sessionId) || b.round < e.endRound || b.round === e.endRound && b.turn < b.fighters.indexOf(f));
function persist(db, f) {
  const state = resourceState(db, f.characterId);
  state.speciesEffects = f.speciesEffects; saveResources(db, f.characterId, state);
}
export function endSpeciesHide(db, f) {
  const sources = f.conditionSources ?? [];
  if (!sources.some(e => e.speciesHide)) return;
  f.conditionSources = sources.filter(e => !e.speciesHide); f.hidden = false; persistConditionState(db, f);
}
export function applySpeciesFear(db, b, source, target) {
  const id = `revelation:${source.id}`;
  target.conditionSources = (target.conditionSources ?? []).filter(e => e.id !== id);
  target.conditionSources.push({ id, kind: 'frightened', sourceId: source.id, sourceName: source.name });
  target.speciesFear = { id, sourceId: source.id, endRound: b.round + (b.fighters.indexOf(source) <= b.turn ? 1 : 0) }; persistConditionState(db, target);
}
export function bindSpecies(db, b) {
  for (const f of b.fighters.filter(f => f.characterId)) {
    for (const e of Object.values(f.speciesEffects ?? {})) {
      e.battleId = b.startedAt; e.endRound = b.round + Math.max(0, Math.ceil((e.expiresAt - Date.now()) / 6000));
    }
    persist(db, f);
  }
}
export function releaseSpecies(db, b) {
  for (const f of b.fighters.filter(f => f.characterId)) {
    for (const e of Object.values(f.speciesEffects ?? {})) if (e.battleId === b.startedAt) {
      e.expiresAt = Math.min(e.expiresAt, Date.now() + Math.max(0, e.endRound - b.round) * 6000); e.battleId = null;
    }
    persist(db, f);
  }
}
export function syncSpecies(db, b) {
  for (const f of b.fighters) {
    if (isIncapacitated(f)) endSpeciesHide(db, f);
    let changed = false;
    if (f.speciesFrost) { const source = b.fighters.find(t => t.id === f.speciesFrost.sourceId); if (!source || b.round > f.speciesFrost.endRound || b.round === f.speciesFrost.endRound && b.turn >= b.fighters.indexOf(source)) f.speciesFrost = null; }
    for (const [key, e] of Object.entries(f.speciesEffects ?? {})) {
      if (!effectAlive(b, f, e) || key === 'flight' && isIncapacitated(f)) { delete f.speciesEffects[key]; changed = true; }
    }
    if (changed && f.characterId) persist(db, f);
    if (f.speciesFear) {
      const source = b.fighters.find(s => s.id === f.speciesFear.sourceId);
      if (!source || b.round > f.speciesFear.endRound || b.round === f.speciesFear.endRound && b.turn > b.fighters.indexOf(source)) {
        f.conditionSources = (f.conditionSources ?? []).filter(e => e.id !== f.speciesFear.id); f.speciesFear = null; persistConditionState(db, f);
      }
    }
  }
}
export function endSpeciesTurn({ db, b, f, damage, log }) {
  for (const target of b.fighters) if (target.speciesFear?.sourceId === f.id && b.round >= target.speciesFear.endRound) {
    target.conditionSources = (target.conditionSources ?? []).filter(e => e.id !== target.speciesFear.id); target.speciesFear = null; persistConditionState(db, target);
  }
  const revelation = f.speciesEffects?.revelation;
  if (revelation?.form === 'radiance' && effectAlive(b, f, revelation)) {
    check(revelation.radianceConfirmedTurn === `${b.round}:${b.turn}`, 'Inner Radiance: MG musi potwierdzić wszystkie istoty w promieniu 10 stóp przed końcem tury.');
    for (const id of revelation.nearbyIds ?? []) {
      const target = b.fighters.find(t => t.id === id);
      if (target) damage(db, target, proficiencyBonus(f.level), false, 'promieniste');
    }
    log(b, `${f.name}: Inner Radiance — obrażenia na koniec tury.`);
  }
}
export function advanceSpeciesTime(db, ids, seconds) {
  for (const id of ids) {
    const state = resourceState(db, id);
    for (const effect of Object.values(state.speciesEffects ?? {})) effect.expiresAt -= seconds * 1000;
    state.speciesEffects = Object.fromEntries(Object.entries(state.speciesEffects ?? {}).filter(([, e]) => e.expiresAt > Date.now()));
    for (const device of state.gnomeDevices ?? []) device.expiresAt -= seconds * 1000;
    state.gnomeDevices = (state.gnomeDevices ?? []).filter(d => d.expiresAt > Date.now());
    saveResources(db, id, state);
  }
}
// Extra damage is opt-in and resolved alongside the triggering attack/spell.
export function speciesHit({ db, b, actor, target, body, damage, log, attackRoll, dealt, critical = false }) {
  if (body.giantStrike) {
    check(attackRoll && dealt > 0 && actor.giantAncestryUses > 0, 'Giant Ancestry wymaga trafienia, obrażeń i dostępnego użycia.');
    const id = actor.goliathAncestry?.id;
    check(['fire', 'frost', 'hill'].includes(id), 'Ten przodek nie daje efektu przy trafieniu.');
    if (id === 'hill') {
      check(['Tiny', 'Small', 'Medium', 'Large'].includes(timedSize(target)), 'Hill’s Tumble: potwierdź rozmiar celu (najwyżej Large).');
      target.prone = true; persistConditionState(db, target);
    } else {
      const rolls = body.giantRolls ?? [body.giantRoll];
      check(Array.isArray(rolls) && rolls.length === (critical ? 2 : 1) && rolls.every(n => die(n, id === 'fire' ? 10 : 6)), 'Podaj kości dodatkowych obrażeń przodka (dwie przy trafieniu krytycznym).');
      damage(db, target, rolls.reduce((a, n) => a + n, 0), false, id === 'fire' ? 'ogień' : 'zimno');
      if (id === 'frost') target.speciesFrost = { sourceId: actor.id, endRound: b.round + (b.fighters.indexOf(actor) <= b.turn ? 1 : 0) };
    }
    actor.giantAncestryUses--; const state = resourceState(db, actor.characterId); state.giantAncestryUses = actor.giantAncestryUses; saveResources(db, actor.characterId, state);
    log(b, `${actor.name}: ${actor.goliathAncestry.label}.`);
  }
  if (body.revelationDamage) {
    const e = actor.speciesEffects?.revelation;
    check(actor.id === b.fighters[b.turn].id && effectAlive(b, actor, e) && dealt > 0 && e.damageTurn !== `${b.round}:${b.turn}`, 'Celestial Revelation: dodatkowe obrażenia raz we własnej turze po zadaniu obrażeń.');
    e.damageTurn = `${b.round}:${b.turn}`;
    damage(db, target, proficiencyBonus(actor.level), false, e.form === 'shroud' ? 'nekrotyczne' : 'promieniste'); persist(db, actor);
    log(b, `${actor.name}: Celestial Revelation — dodatkowe obrażenia.`);
  }
}
export function handleSpecies({ db, b, body, gm, canControl, activeMember, damage, persistVitals, log }) {
  if (!body.kind?.startsWith('species-')) return false;
  const f = b.fighters.find(t => t.id === (body.actorId ?? b.fighters[b.turn].id));
  const gmRadiance = gm && ['species-radiance-targets', 'species-breath-targets', 'species-hide-end'].includes(body.kind);
  check(f?.characterId && (canControl(f) || gmRadiance) && activeMember(db, b.sessionId, f), 'Nie możesz sterować tą postacią.');
  check(!b.fighters.some(t => t.concentrationDC || t.relentlessRagePending), 'Najpierw rozstrzygnij oczekujące rzuty.');
  check(gmRadiance || f.hp > 0 && f.deathFailures < 3 && !isIncapacitated(f), 'Ta postać nie może teraz działać.');
  const state = resourceState(db, f.characterId), pb = proficiencyBonus(f.level);
  const ownTurn = () => check(f.id === b.fighters[b.turn].id && !b.pending, 'Wymagana własna tura bez oczekującego działania.');
  const slot = (key, label) => { check(!f[key] && !(key === 'reaction' && f.reactionDeferred), 'Działanie zostało wykorzystane.'); f[key] = label; };
  const confirm = () => check(body.confirmed === true, 'Potwierdź z MG zasięg, widoczność i warunki zdolności.');
  const start = (key, seconds, extra = {}) => {
    f.speciesEffects ??= {};
    f.speciesEffects[key] = { expiresAt: Date.now() + seconds * 1000, battleId: b.startedAt ?? b.sessionId, endRound: b.round + seconds / 6, ...extra };
    state.speciesEffects = f.speciesEffects;
  };
  const targets = () => {
    check(Array.isArray(body.targetIds) && new Set(body.targetIds).size === body.targetIds.length, 'Wybierz cele bez powtórzeń.');
    return body.targetIds.map(id => { const target = b.fighters.find(t => t.id === id); check(target && target.deathFailures < 3, 'Niepoprawny cel.'); return target; });
  };
  if (body.kind === 'species-hide-end') {
    check(!b.pending, 'Najpierw rozstrzygnij działanie.'); endSpeciesHide(db, f);
  } else if (body.kind === 'species-breath-targets') {
    check(gm && b.pending?.breathWeapon && b.pending.actorId === f.id && f.breathWeaponDC != null, 'MG wybiera obszar oczekującej Broni Oddechowej.'); confirm();
    const selected = targets(); check(selected.every(t => t.saves.dex != null), 'Uzupełnij rzuty obronne ZR celów.');
    b.pending = selected.length ? { kind: 'spell', actorId: f.id, spellId: 'species-breath', spellName: 'Breath Weapon', stage: 'save', dc: f.breathWeaponDC, spec: { mode: 'save', save: 'dex', dice: f.breathWeaponDamage, sides: 10, type: f.breathWeaponType, half: true, bonus: 0 }, targets: selected.map(t => ({ id: t.id })) } : null;
  } else if (body.kind === 'species-end') {
    check(!b.pending && ['flight', 'large', 'revelation'].includes(body.effect) && f.speciesEffects?.[body.effect], 'Brak efektu do zakończenia.');
    delete f.speciesEffects[body.effect]; state.speciesEffects = f.speciesEffects;
  } else if (body.kind === 'species-inspiration') {
    check((state.heroicInspirationAvailable ?? f.species === 'Człowiek (Human)') && die(body.roll, 20), 'Brak inspiracji albo wyniku przerzutu k20.');
    state.heroicInspirationAvailable = false;
    log(b, `${f.name}: Heroic Inspiration — nowy wynik k20: ${body.roll}; użyj go w rozstrzyganym teście.`);
  } else if (body.kind === 'species-stonecunning') {
    ownTurn(); confirm(); check(f.species === 'Krasnolud (Dwarf)' && (state.stonecunningUses ?? 0) < pb, 'Stonecunning niedostępne.');
    slot('bonus', 'Stonecunning'); state.stonecunningUses = (state.stonecunningUses ?? 0) + 1; start('stonecunning', 600);
  } else if (body.kind === 'species-adrenaline') {
    ownTurn(); check(f.species === 'Ork (Orc)' && (state.adrenalineRushUses ?? pb) > 0, 'Adrenaline Rush niedostępne.');
    slot('bonus', 'Adrenaline Rush'); state.adrenalineRushUses = (state.adrenalineRushUses ?? pb) - 1; f.adrenalineRushUses = state.adrenalineRushUses;
    f.extraMove = (f.extraMove ?? 0) + spellSpeed(f); f.tempHp = Math.max(f.tempHp ?? 0, pb); persistVitals(db, f);
  } else if (body.kind === 'species-healing-hands') {
    ownTurn(); confirm(); check(f.species === 'Aasimar' && !state.healingHandsUsed, 'Healing Hands niedostępne.');
    const target = b.fighters.find(t => t.id === body.targetId);
    check(target && target.deathFailures < 3 && !healingBlocked(target), 'Wybierz żywy cel, który może odzyskiwać PW.');
    check(Array.isArray(body.rolls) && body.rolls.length === pb && body.rolls.every(n => die(n, 4)), 'Podaj k4 w liczbie równej premii biegłości.');
    slot('action', 'Healing Hands'); state.healingHandsUsed = true;
    target.hp = Math.min(target.maxHp, target.hp + body.rolls.reduce((a, n) => a + n, 0));
    if (target.hp > 0) { target.deathSuccesses = 0; target.deathFailures = 0; } persistVitals(db, target);
  } else if (body.kind === 'species-revelation') {
    ownTurn(); check(f.species === 'Aasimar' && f.level >= 3 && !state.revelationUsed && ['wings', 'radiance', 'shroud'].includes(body.form), 'Celestial Revelation niedostępne.');
    slot('bonus', 'Celestial Revelation'); state.revelationUsed = true; start('revelation', 60, { form: body.form });
    if (body.form === 'shroud') {
      confirm(); check(f.speciesCha != null, 'Uzupełnij Charyzmę.');
      const selected = targets();
      check(selected.every(target => target.id !== f.id && target.saves.cha != null), 'Wybierz istoty inne niż sojusznicy i ty; uzupełnij ich rzuty obronne CHA.');
      b.pending = selected.length ? { kind: 'spell', actorId: f.id, spellId: 'species-shroud', spellName: 'Necrotic Shroud', stage: 'save', dc: 8 + f.speciesCha + pb, spec: { mode: 'condition', save: 'cha', rider: 'frightened', speciesShroud: true, dice: 0, sides: 0, bonus: 0, type: 'Necrotic' }, targets: selected.map(t => ({ id: t.id })) } : null;
    }
  } else if (body.kind === 'species-radiance-targets') {
    check(gm && f.speciesEffects?.revelation?.form === 'radiance', 'Cele blasku ustala MG.'); confirm();
    f.speciesEffects.revelation.nearbyIds = targets().map(t => t.id);
    f.speciesEffects.revelation.radianceConfirmedTurn = `${b.round}:${b.turn}`; state.speciesEffects = f.speciesEffects;
  } else if (body.kind === 'species-large') {
    ownTurn(); confirm(); check(f.species === 'Goliat (Goliath)' && f.level >= 5 && state.largeFormAvailable !== false, 'Large Form niedostępne.');
    slot('bonus', 'Large Form'); state.largeFormAvailable = false; f.largeFormAvailable = false; start('large', 600);
  } else if (body.kind === 'species-flight') {
    ownTurn(); check(f.species === 'Smokowiec (Dragonborn)' && f.level >= 5 && state.draconicFlightAvailable !== false, 'Draconic Flight niedostępne.');
    slot('bonus', 'Draconic Flight'); state.draconicFlightAvailable = false; f.draconicFlightAvailable = false; start('flight', 600);
  } else if (body.kind === 'species-cloud') {
    ownTurn(); confirm(); check(f.goliathAncestry?.id === 'cloud' && f.giantAncestryUses > 0, 'Cloud’s Jaunt niedostępne.');
    slot('bonus', 'Cloud’s Jaunt'); f.giantAncestryUses--; state.giantAncestryUses = f.giantAncestryUses;
    log(b, `${f.name}: teleportacja do 30 stóp na widziane wolne pole (bez kosztu ruchu).`);
  } else if (body.kind === 'species-stone') {
    confirm(); check(f.goliathAncestry?.id === 'stone' && f.giantAncestryUses > 0 && die(body.roll, 12) && f.speciesCon != null, 'Stone’s Endurance niedostępne.');
    check(b.pending?.kind === 'damage' && b.pending.targetId === f.id || b.pending?.kind === 'spell' && b.pending.stage === 'effect' && b.pending.targets.some(t => t.id === f.id), 'Brak oczekujących obrażeń tej postaci.');
    check(!f.speciesReduction, 'Redukcja została już zastosowana.'); slot('reaction', 'Stone’s Endurance');
    f.speciesReduction = Math.max(0, body.roll + f.speciesCon); f.giantAncestryUses--; state.giantAncestryUses = f.giantAncestryUses;
  } else if (body.kind === 'species-storm') {
    confirm(); const event = f.speciesDamageEvent, target = b.fighters.find(t => t.id === event?.sourceId);
    check(f.goliathAncestry?.id === 'storm' && f.giantAncestryUses > 0 && event?.amount > 0 && !event.used && target && die(body.roll, 8), 'Storm’s Thunder wymaga świeżo otrzymanych obrażeń od istoty w 60 stopach.');
    slot('reaction', 'Storm’s Thunder'); event.used = true; f.giantAncestryUses--; state.giantAncestryUses = f.giantAncestryUses;
    damage(db, target, body.roll, false, 'grom');
  } else if (body.kind === 'species-hide') {
    ownTurn(); confirm(); check(f.species === 'Niziołek (Halfling)', 'Naturally Stealthy wymaga Niziołka.');
    check(Number.isInteger(body.total) && body.total >= -20 && body.total <= 100, 'Podaj rozstrzygnięty wynik testu Stealth.');
    slot('action', 'Hide'); f.hidden = body.total >= 15; f.hideDC = body.total;
    endSpeciesHide(db, f);
    if (body.total >= 15) {
      f.hidden = true;
      f.conditionSources ??= []; f.conditionSources.push({ id: `species-hide:${f.characterId}`, kind: 'invisible', sourceId: f.id, sourceCharacterId: f.characterId, sourceName: 'Hide', speciesHide: true, dc: body.total }); persistConditionState(db, f);
    }
  } else throw new Error('Nieznana zdolność gatunku.');
  state.conditionSources = f.conditionSources ?? state.conditionSources ?? [];
  saveResources(db, f.characterId, state); log(b, `${f.name}: ${body.kind}.`); return true;
}
