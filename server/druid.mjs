import { druidForms, druidProfile, isDruid } from '../shared/druid.mjs';
import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { characterTraits } from '../shared/character-traits.mjs';
import definitions from '../shared/statistics.json' with { type: 'json' };
import { resourceState, saveResources, casterData } from './spell-resources.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };

export function druidChoiceUpdate(character, stats, stored, resources, explicitSpells, explicitTraits) {
  if (!isDruid(character)) return {};
  const old = stored?.druidProgression;
  const history = structuredClone(old ?? { level: character.level, rest: resources.lastLongRest ?? 0, cantripSwaps: 0, formSwaps: 0 });
  if (old && character.level < old.level) return { error: 'Druid: przywróć zapisany poziom przed zmianą wyborów.' };
  if (old && character.level > old.level) history.cantripSwaps += character.level - old.level;
  if (history.rest !== (resources.lastLongRest ?? 0)) { history.formSwaps = 1; history.rest = resources.lastLongRest ?? 0; }
  const previousSpells = old?.spells ?? stored?.spells;
  if (explicitSpells) {
    if (!['magic', 'martial'].includes(stats.spells.choices.order)) return { error: 'Druid: wybierz Primal Order.' };
    if (previousSpells?.choices?.order && previousSpells.choices.order !== stats.spells.choices.order) return { error: 'Primal Order jest stałym wyborem.' };
    const profile = spellcastingProfile(character, stats.spells, stats.traits);
    for (const id of ['cantrips', 'prepared']) {
      const selected = stats.spells.selections[id] ?? [];
      if (selected.length !== profile.groups.find(g => g.id === id).limit) return { error: `Druid: uzupełnij wybór ${id}.` };
      const previous = previousSpells?.selections?.[id] ?? [];
      const removed = previous.filter(s => !selected.includes(s)).length;
      if (id === 'cantrips' && removed > history.cantripSwaps) return { error: 'Druid: możesz wymienić jedną sztuczkę na zdobyty poziom.' };
      if (id === 'prepared' && removed && (old?.preparedRest ?? old?.rest ?? resources.lastLongRest ?? 0) === (resources.lastLongRest ?? 0)) return { error: 'Druid: przygotowane czary zmieniasz po długim odpoczynku.' };
      if (id === 'prepared' && (removed || !previous.length)) history.preparedRest = resources.lastLongRest ?? 0;
      if (id === 'cantrips') history.cantripSwaps -= removed;
    }
    history.spells = structuredClone(stats.spells);
  }
  if (explicitTraits && character.level >= 2) {
    const forms = stats.traits.druidForms ?? [];
    if (forms.length !== 4 || new Set(forms).size !== 4 || forms.some(id => !druidForms.some(f => f.id === id))) return { error: 'Wild Shape: wybierz cztery różne dostępne formy bestii.' };
    const previous = old?.forms ?? stored?.traits?.druidForms ?? [];
    const removed = previous.filter(id => !forms.includes(id)).length;
    if (removed > history.formSwaps) return { error: 'Wild Shape: wymień najwyżej jedną formę po długim odpoczynku.' };
    history.formSwaps -= removed;
    history.forms = [...forms];
  }
  history.level = character.level;
  return { history };
}

export function endWildShape(f) {
  if (!f.wildShape) return;
  Object.assign(f, f.wildShape.original);
  f.wildShape = null;
}
export function applyWildShape(f, form, character, stats, shape) {
  endWildShape(f);
  const original = Object.fromEntries(['ac', 'speed', 'saves', 'attacks', 'maxAttacks', 'notes', 'formSkills', 'formAbilities', 'size', 'climbSpeed', 'darkvision'].map(k => [k, f[k] ?? null]));
  const traits = characterTraits(character, stats), pb = 2 + Math.floor((character.level - 1) / 4);
  const mod = ability => Math.floor(((form[ability] ?? stats.values[ability]) - 10) / 2);
  const formAbilities = Object.fromEntries(definitions.abilities.map(a => [a.id, mod(a.id)]));
  f.saves = Object.fromEntries(definitions.abilities.map(a => [a.id, Math.max(mod(a.id) + (traits.effectiveSavingThrows.includes(a.id) || form.saves?.includes(a.id) ? pb : 0), mod(a.id) + (form.saves?.includes(a.id) ? 2 : 0))]));
  f.formSkills = Object.fromEntries(definitions.skills.map(s => [s.id, mod(s.ability) + Math.max(pb * Math.max(traits.effectiveSkills[s.id], form.skills?.[s.id] ? 1 : 0), 2 * (form.skills?.[s.id] ?? 0)) + (traits.skillBonuses[s.id] ?? 0)]));
  Object.assign(f, { ac: form.ac, speed: form.speed, maxAttacks: 1, size: form.size, climbSpeed: form.climb ?? 0, darkvision: form.darkvision ?? 0, formAbilities,
    attacks: [{ ...form.attack, id: `beast:${form.id}`, ability: form.id === 'riding-horse' || form.id === 'wolf' ? 'str' : 'dex', light: false }], notes: form.notes ?? '',
    wildShape: { ...shape, original } });
}
export function syncWildShapes(db, b) {
  for (const f of b.fighters) if (f.wildShape && (Date.now() >= f.wildShape.expiresAt || f.hp <= 0 || f.incapacitated || f.unconscious || f.deathFailures >= 3)) {
    endWildShape(f);
    const state = resourceState(db, f.characterId); state.wildShape = null; saveResources(db, f.characterId, state);
  }
}
export function handleDruid({ db, b, body, canControl, activeMember, persistVitals, log }) {
  if (!['wild-shape', 'wild-shape-end', 'wild-companion'].includes(body.kind)) return false;
  const f = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(f?.characterId && activeMember(db, b.sessionId, f) && canControl(f), 'Nie możesz sterować tą postacią.');
  check(f.id === b.fighters[b.turn].id && !b.pending && !b.fighters.some(a => a.concentrationDC || a.relentlessRagePending), 'Wymagana własna tura bez oczekujących działań.');
  check(f.hp > 0 && !f.incapacitated && !f.unconscious, 'Postać nie może teraz działać.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(f.characterId);
  const profile = druidProfile(character);
  check(profile.max, 'Ta zdolność wymaga 2. poziomu druida.');
  const state = resourceState(db, f.characterId);
  const uses = Math.min(profile.max, state.wildShapeUses ?? profile.max);
  if (body.kind === 'wild-companion') {
    check(!f.action && !f.wildShape && !f.rage, 'Wild Companion wymaga akcji Magic i możliwości rzucania czarów.');
    check(!casterData(db, f.characterId).blocked, 'Brak wyszkolenia w pancerzu blokuje rzucanie czarów.');
    check(typeof body.form === 'string' && ['bat', 'cat', 'crab', 'frog', 'hawk', 'lizard', 'octopus', 'owl', 'rat', 'raven', 'sea-horse', 'spider', 'weasel'].includes(body.form), 'Wybierz formę Find Familiar.');
    if (body.source === 'wild-shape') { check(uses > 0, 'Brak użyć Wild Shape.'); state.wildShapeUses = uses - 1; }
    else {
      check(body.source === 'slot' && Number.isInteger(body.level) && body.level >= 1 && body.level <= 9 && !(b.slotCasters ?? []).includes(f.id), 'Wybierz dostępne miejsce na czar.');
      const total = spellcastingProfile(character).slots[body.level - 1] ?? 0;
      check(total > (state.spent[body.level - 1] ?? 0), 'Brak miejsca na czar.');
      state.spent[body.level - 1] = (state.spent[body.level - 1] ?? 0) + 1;
      b.slotCasters = [...(b.slotCasters ?? []), f.id];
    }
    state.wildCompanion = { form: body.form, creatureType: 'fey', materialComponents: false, summonedAt: Date.now() };
    f.wildCompanion = state.wildCompanion; f.action = 'Wild Companion';
  } else {
    check(!f.bonus, 'Akcja dodatkowa została wykorzystana.');
    if (body.kind === 'wild-shape-end') { check(f.wildShape, 'Wild Shape nie jest aktywne.'); endWildShape(f); state.wildShape = null; }
    else {
      check(uses > 0, 'Brak użyć Wild Shape.');
      const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(f.characterId).data);
      const form = druidForms.find(form => form.id === body.formId);
      check(form && stats.traits?.druidForms?.includes(form.id), 'Nie znasz tej formy.');
      check(['merge', 'drop'].includes(body.equipment), 'Wybierz merge albo drop dla wyposażenia.');
      state.wildShape = { formId: form.id, equipment: body.equipment, expiresAt: Date.now() + profile.durationHours * 3600000 };
      applyWildShape(f, form, character, stats, state.wildShape);
      f.tempHp = Math.max(f.tempHp, character.level); state.wildShapeUses = uses - 1;
    }
    f.bonus = body.kind === 'wild-shape' ? 'Wild Shape' : 'Koniec Wild Shape';
    persistVitals(db, f);
  }
  f.wildShapeUses = state.wildShapeUses ?? uses;
  saveResources(db, f.characterId, state);
  log(b, `${f.name}: ${body.kind}; Wild Shape ${f.wildShapeUses}/${profile.max}. ${f.notes ?? ''}`);
  return true;
}
