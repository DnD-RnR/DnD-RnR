import { resourceState, saveResources } from './spell-resources.mjs';
import { isIncapacitated, canSeeConditionTarget } from '../shared/conditions.mjs';
import { hasSpellCondition } from './spell-conditions.mjs';
import { hasTimedModifier } from '../shared/timed-effects.mjs';
import { adjustBattleRoll } from './epic-boons.mjs';

export const isBard = character => character?.class === 'Bard';

export function bardResources(character, charismaModifier, state) {
  if (!isBard(character)) return null;
  const level = character.level;
  const max = Math.max(1, charismaModifier ?? 0);
  return {
    max, remaining: Math.max(0, max - (state.bardicSpent ?? 0)),
    die: level >= 15 ? 12 : level >= 10 ? 10 : level >= 5 ? 8 : 6,
    font: level >= 5, countercharm: level >= 7,
    cuttingWords: character.subclass === 'College of Lore' && level >= 3,
    peerlessSkill: character.subclass === 'College of Lore' && level >= 14,
  };
}

export function activeInspiration(state, now = Date.now()) {
  return state.bardicInspiration?.expiresAt > now ? state.bardicInspiration : null;
}

export function restoreInitiativeInspiration(fighter, state) {
  if (fighter.level < 18 || !fighter.bard || fighter.bard.remaining >= 2) return;
  state.bardicSpent = Math.max(0, fighter.bard.max - 2);
}

export function recoverInspiration(caster, level) {
  const bard = bardResources(caster.character, caster.ability, caster.state);
  check(bard?.font && bard.remaining < bard.max && caster.slots.some(s => s.source === 'slot' && s.level === level && s.remaining > 0),
    'Font of Inspiration wymaga wydanego użycia Inspiracji i dostępnej komórki czaru.');
  caster.state.spent[level - 1] = (caster.state.spent[level - 1] ?? 0) + 1;
  caster.state.bardicSpent = bard.max - bard.remaining - 1;
}

const check = (ok, message) => { if (!ok) throw new Error(message); };
const die = (value, sides) => Number.isInteger(value) && value >= 1 && value <= sides;
const mindConditions = new Set(['charmed', 'frightened', 'fear', 'hypnotic-pattern']);

export function handleBard({ db, b, body, canControl, activeMember, casterData, log }) {
  const { kind } = body;
  if (typeof kind !== 'string' || !kind.startsWith('bard-')) return false;
  const actor = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(actor && canControl(actor) && activeMember(db, b.sessionId, actor), 'Nie kontrolujesz tej postaci.');
  const state = actor.characterId ? resourceState(db, actor.characterId) : null;
  const bard = state && actor.bard;
  const remaining = bard ? Math.max(0, bard.max - (state.bardicSpent ?? 0)) : 0;
  const r = b.lastRoll;
  const failed = r && (['attack', 'spell-attack'].includes(r.kind) ? r.hit === false : Number.isFinite(r.dc) && r.total < r.dc);
  const save = r?.kind === 'saving-throw' ? r : r?.kind === 'spell-save' && r.pending.targets.find(t => t.id === r.targetId);
  const spend = () => {
    check(remaining > 0, 'Brak użyć Bardic Inspiration.');
    state.bardicSpent = (state.bardicSpent ?? 0) + 1;
    saveResources(db, actor.characterId, state);
  };
  const react = name => {
    check(!isIncapacitated(actor) && !actor.reaction && !actor.reactionDeferred && !hasSpellCondition(actor, 'no-reactions') && !hasTimedModifier(actor, 'slow'),
      'Reakcja jest niedostępna.');
    actor.reaction = name;
  };
  if (kind === 'bard-font') {
    check(bard?.font, 'Font of Inspiration jest niedostępna.');
    const caster = casterData(db, actor.characterId);
    recoverInspiration(caster, body.level);
    saveResources(db, actor.characterId, caster.state);
    log(b, `${actor.name}: Font of Inspiration.`);
  } else if (kind === 'bard-inspire') {
    const target = b.fighters.find(f => f.id === body.targetId);
    check(bard && !isIncapacitated(actor) && actor.id === b.fighters[b.turn].id && !b.pending && !actor.bonus &&
      target && target.id !== actor.id && activeMember(db, b.sessionId, target) && target.deathFailures < 3 &&
      body.confirmed === true, 'Wybierz inną postać, która słyszy Barda w 60 stopach i potwierdź warunki z MG.');
    const recipient = target.characterId ? resourceState(db, target.characterId) : target;
    check(!activeInspiration(recipient), 'Cel ma już kość Bardic Inspiration.');
    spend();
    recipient.bardicInspiration = { die: bard.die, expiresAt: Date.now() + 3600000 };
    if (target.characterId) saveResources(db, target.characterId, recipient);
    actor.bonus = 'Bardic Inspiration';
    log(b, `${actor.name} → ${target.name}: Bardic Inspiration k${bard.die}.`);
  } else if (kind === 'bard-use' || kind === 'bard-peerless') {
    const peerless = kind === 'bard-peerless';
    const recipient = state ?? actor;
    const inspiration = activeInspiration(recipient);
    check(failed && r.actorId === actor.id && Number.isFinite(r.total) &&
      (peerless ? bard?.peerlessSkill && !r.peerlessAttempted && remaining > 0 && ['ability-check', 'attack', 'spell-attack'].includes(r.kind) && die(body.roll, bard.die) : inspiration && die(body.roll, inspiration.die)),
      'Wymagany jest własny nieudany test i dostępna kość właściwego rozmiaru.');
    const originalTotal = r.total;
    adjustBattleRoll(b, r, originalTotal + body.roll);
    if (peerless) {
      r.peerlessAttempted = true;
      if (r.hit ?? r.total >= r.dc) spend();
      else adjustBattleRoll(b, r, originalTotal);
    } else {
      delete recipient.bardicInspiration;
      if (actor.characterId) saveResources(db, actor.characterId, recipient);
    }
    log(b, `${actor.name}: ${peerless ? 'Peerless Skill' : 'Bardic Inspiration'} +${body.roll}.`);
  } else if (kind === 'bard-cutting') {
    const p = b.pending;
    const damage = body.damage === true && (p?.kind === 'damage' && p.attack.dice > 0 ||
      p?.kind === 'spell' && p.stage === 'effect' && ['attack', 'save'].includes(p.spec.mode) && p.spec.dice > 0);
    const success = r?.hit === true || r?.kind === 'ability-check' && Number.isFinite(r.dc) && r.total >= r.dc;
    const source = b.fighters.find(f => f.id === (damage ? p.actorId : r?.actorId));
    check(bard?.cuttingWords && source && source.id !== actor.id && canSeeConditionTarget(actor, source) &&
      (body.damage === true ? damage : success) && die(body.roll, bard.die) && body.confirmed === true,
      'Cutting Words wymaga widzianego celu w 60 stopach oraz potwierdzonego rzutu obra?e? lub udanego ataku albo testu cechy.');
    react('Cutting Words');
    spend();
    if (damage) p.cuttingWordsReduction = (p.cuttingWordsReduction ?? 0) + body.roll;
    else adjustBattleRoll(b, r, r.total - body.roll);
    log(b, `${actor.name}: Cutting Words −${body.roll}.`);
  } else if (kind === 'bard-countercharm') {
    check(bard?.countercharm && failed && save && Number.isFinite(save.rerollModifier) && !save.countercharm &&
      [r.condition, r.pending?.conditionChoice, r.pending?.spec.condition, r.pending?.spec.rider].some(value => mindConditions.has(value)) &&
      (r.targetId === actor.id || body.confirmed === true) && die(body.roll, 20) &&
      (save.rerollDisadvantage || die(body.roll2, 20)), 'Countercharm wymaga nieudanego rzutu przeciw zauroczeniu lub strachowi w 30 stopach.');
    react('Countercharm');
    save.countercharm = true;
    const current = r.pending && b.pending?.castingId === r.pending.castingId && b.pending.targets?.find(t => t.id === r.targetId);
    if (current) current.countercharm = true;
    adjustBattleRoll(b, r, (save.rerollDisadvantage ? body.roll : Math.max(body.roll, body.roll2)) + save.rerollModifier);
    log(b, `${actor.name}: Countercharm — powtórzony rzut obronny.`);
  } else throw new Error('Nieznana zdolność Barda.');
  return true;
}
