import { spendSpell, resourceState, saveResources } from './spell-resources.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const die = (n, sides = 20) => Number.isInteger(n) && n >= 1 && n <= sides;
const d20 = (body, forcedDisadvantage = false) => {
  const advantage = Boolean(body.advantage), disadvantage = Boolean(body.disadvantage || forcedDisadvantage);
  check(die(body.roll) && (advantage === disadvantage || die(body.roll2)), 'Podaj wynik k20 i drugą kość przy ułatwieniu/utrudnieniu.');
  return advantage === disadvantage ? body.roll : advantage ? Math.max(body.roll, body.roll2) : Math.min(body.roll, body.roll2);
};
export function handleCombatSpell({ db, user, gm, b, body, canControl, activeMember, damage, persistVitals, log }) {
  if (!['cast', 'spell-attack', 'spell-save', 'spell-effect', 'spell-defense', 'concentration'].includes(body.kind)) return false;
  const controlled = f => f && activeMember(db, b.sessionId, f) && canControl(f);
  const caster = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn]?.id));
  if (body.kind === 'cast') {
    check(controlled(caster) && caster.characterId && caster.hp > 0 && caster.deathFailures < 3, 'Nie możesz rzucić czaru tą postacią.');
    if (b.pending) {
      check(body.slot === 'reaction' && !b.suspendedAction, 'Najpierw rozstrzygnij rozpoczęte działanie.');
      b.suspendedAction = b.pending; b.pending = null;
    }
    check(caster.id === b.fighters[b.turn].id || body.slot === 'reaction', 'Poza własną turą dostępne są tylko reakcje.');
    check(!caster[body.slot] && ['action', 'bonus', 'reaction'].includes(body.slot), 'Działanie zostało już wykorzystane.');
    check(!b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rzuty koncentracji.');
    const c = spendSpell(db, caster.characterId, body.spellId, body.level, body.source);
    check(c.spell.action === body.slot, 'Czas rzucania czaru nie pasuje do tego kroku tury.');
    check(!c.blocked, 'Brak wyszkolenia w założonym pancerzu blokuje rzucanie czarów.');
    const spentSlot = c.spell.level > 0 && body.source !== 'arcanum';
    check(!spentSlot || !(b.slotCasters ?? []).includes(caster.id), 'W tej turze wykorzystano już miejsce na czar.');
    if (spentSlot) b.slotCasters = [...(b.slotCasters ?? []), caster.id];
    caster[body.slot] = `Czar: ${c.spell.name}`;
    if (c.spell.duration?.includes('Koncentracja')) {
      caster.concentration = c.spell.name; caster.concentrationDC = null; caster.concentrationChecks = [];
      const state = resourceState(db, caster.characterId); state.concentration = c.spell.name; saveResources(db, caster.characterId, state);
    }
    log(b, `${caster.name}: ${c.spell.name}${c.spell.level ? ` (${body.level}. krąg, ${body.source === 'arcanum' ? 'Mystic Arcanum' : 'zużyto miejsce'})` : ' (sztuczka)'}.`);
    if (!c.spell.effect) {
      b.pending = { kind: 'request', actorId: caster.id, slot: body.slot, description: `${c.spell.name} — ${c.spell.description ?? ''}\n${c.spell.upgrade ?? ''}\nZasięg i komponenty oraz efekty specjalne rozstrzyga GM. Zasób został już zużyty.` };
      return true;
    }
    const spec = { ...c.spell.effect };
    if (spec.mode === 'shield') {
      if (!caster.shieldAC) { caster.ac += 5; caster.shieldAC = 5; }
      log(b, `${caster.name}: Shield — osłona do początku następnej własnej tury.`);
      return true;
    }
    const targets = Array.isArray(body.targetIds) ? body.targetIds.map(id => b.fighters.find(f => f.id === id)) : [];
    check(targets.length > 0 && targets.length <= (spec.area ? 50 : 1) && targets.every(Boolean) && new Set(targets.map(t => t.id)).size === targets.length, 'Wybierz właściwe, niepowtarzające się cele czaru.');
    check(targets.every(t => t.deathFailures < 3), 'Zwykły czar nie przywraca życia martwemu celowi.');
    spec.dice += spec.cantrip ? (c.character.level >= 17 ? 3 : c.character.level >= 11 ? 2 : c.character.level >= 5 ? 1 : 0) : (body.level - c.spell.level) * (spec.perLevel ?? 0);
    if (spec.woundedSides && targets[0].hp < targets[0].maxHp) spec.sides = spec.woundedSides;
    spec.bonus = spec.ability ? c.ability : 0;
    check(spec.bonus !== null && (spec.mode !== 'attack' || c.attack !== null) && (spec.mode !== 'save' || c.dc !== null), 'Uzupełnij cechę czarowania postaci.');
    if (spec.mode === 'save') check(targets.every(t => t.saves?.[spec.save] != null), 'Uzupełnij modyfikator rzutu obronnego celów przed użyciem tego czaru.');
    b.pending = { kind: 'spell', actorId: caster.id, spellName: c.spell.name, stage: spec.mode === 'attack' ? 'attack' : spec.mode === 'save' ? 'save' : 'effect', spec,
      attackBonus: c.attack, dc: c.dc, targets: targets.map(t => ({ id: t.id })) };
    return true;
  }
  if (body.kind === 'concentration') {
    check(controlled(caster) && caster.hp > 0 && caster.concentrationDC, 'Brak testu koncentracji do wykonania.');
    const roll = d20(body), bonus = caster.saves.con;
    check(bonus != null, 'Uzupełnij rzut obronny na Kondycję.');
    const success = roll + bonus >= caster.concentrationDC;
    log(b, `${caster.name}: koncentracja — ${success ? 'utrzymana' : 'przerwana'}.`);
    if (!success) { caster.concentration = null; caster.concentrationChecks = []; }
    else caster.concentrationChecks = (caster.concentrationChecks ?? [caster.concentrationDC]).slice(1);
    caster.concentrationDC = caster.concentrationChecks[0] ?? null;
    const state = resourceState(db, caster.characterId); state.concentration = caster.concentration; saveResources(db, caster.characterId, state);
    return true;
  }
  const p = b.pending;
  check(p?.kind === 'spell', 'Brak czaru do rozstrzygnięcia.');
  const actor = b.fighters.find(f => f.id === p.actorId);
  if (body.kind === 'spell-defense') {
    check(gm && p.spec.mode !== 'heal', 'Odporności i podatności zatwierdza GM.');
    const target = p.targets.find(t => t.id === body.targetId);
    check(target && [0, 0.5, 1, 2].includes(body.multiplier), 'Wybierz cel i modyfikator obrażeń.');
    target.multiplier = body.multiplier; target.defenseReady = true;
    return true;
  }
  if (body.kind === 'spell-save') {
    check(p.stage === 'save', 'Czar nie oczekuje teraz na rzut obronny.');
    const t = p.targets.find(t => t.id === body.targetId), target = b.fighters.find(f => f.id === t?.id);
    check(t && t.saved === undefined && controlled(target), 'Rzut obronny wykonuje właściciel celu lub GM dla potwora.');
    const roll = d20(body);
    t.saved = roll + target.saves[p.spec.save] >= p.dc;
    log(b, `${target.name}: rzut obronny przeciw ${p.spellName} — ${t.saved ? 'sukces' : 'porażka'}.`);
    if (p.targets.every(t => t.saved !== undefined)) {
      if (!p.spec.half && p.targets.every(t => t.saved)) b.pending = null;
      else p.stage = 'effect';
    }
    return true;
  }
  check(controlled(actor), 'Tę część czaru rozstrzyga osoba rzucająca czar.');
  if (body.kind === 'spell-attack') {
    check(p.stage === 'attack', 'Czar nie oczekuje teraz na atak.');
    const target = b.fighters.find(f => f.id === p.targets[0].id);
    const roll = d20(body, target.dodge || Boolean(actor.mockery));
    actor.mockery = null;
    const hit = roll !== 1 && (roll === 20 || roll + p.attackBonus >= target.ac);
    log(b, `${actor.name} → ${target.name}: ${p.spellName} — ${hit ? roll === 20 ? 'trafienie krytyczne' : 'trafienie' : 'pudło'}.`);
    if (!hit) b.pending = null;
    else { p.stage = 'effect'; p.critical = roll === 20; p.attackTotal = roll + p.attackBonus; }
    return true;
  }
  check(p.stage === 'effect', 'Najpierw wykonaj atak lub rzuty obronne.');
  check(p.spec.mode === 'heal' || p.targets.every(t => t.saved && !p.spec.half || t.defenseReady), 'GM musi zatwierdzić odporności, niewrażliwości i podatności celów.');
  const count = p.spec.dice * (p.critical ? 2 : 1);
  check(Array.isArray(body.rolls) && body.rolls.length === count && body.rolls.every(n => die(n, p.spec.sides)), 'Podaj wynik każdej kości czaru.');
  const total = Math.max(0, body.rolls.reduce((a, n) => a + n, 0) + p.spec.bonus);
  for (const t of p.targets) {
    const target = b.fighters.find(f => f.id === t.id);
    if (p.spec.mode === 'heal') {
      check(!target.healingBlocked, 'Cel nie może teraz odzyskiwać PW.');
      const restored = Math.min(total, target.maxHp - target.hp);
      target.hp += restored;
      if (target.hp > 0) { target.deathFailures = 0; target.deathSuccesses = 0; }
      persistVitals(db, target); log(b, `${p.spellName} → ${target.name}: odzyskano ${restored} PW.`);
    } else {
      const base = t.saved ? p.spec.half ? Math.floor(total / 2) : 0 : total;
      const amount = Math.floor(base * (t.multiplier ?? 1));
      damage(db, target, amount, p.critical);
      if (!t.saved && p.spec.rider === 'mockery') target.mockery = { expiresRound: b.round + (b.fighters.indexOf(target) < b.turn ? 1 : 0) };
      if (!t.saved && p.spec.rider === 'push') log(b, `${target.name}: odepchnięcie 10 stóp — położenie ustala GM.`);
      if (!t.saved && p.spec.rider === 'flee' && !target.reaction && target.hp > 0) {
        target.reaction = 'Dissonant Whispers — ruch';
        log(b, `${target.name}: zużywa reakcję na oddalenie się najbezpieczniejszą trasą — trasę ustala GM.`);
      }
      log(b, `${p.spellName} → ${target.name}: ${amount} obrażeń (${p.spec.type}).`);
    }
  }
  b.pending = null;
  return true;
}
