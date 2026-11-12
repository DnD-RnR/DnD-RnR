import { randomUUID, createHash } from 'node:crypto';
import { advancementPreview, hasLevelFeat, levelFeatOptions } from '../shared/advancement.mjs';
import { characterTraits, validateTraitSelection } from '../shared/character-traits.mjs';
import { spellcastingProfile, validateSpellSelection } from '../shared/spellcasting.mjs';
import options from '../shared/character-options.json' with { type: 'json' };
import { emptyStatistics } from './statistics.mjs';
import { resourceState } from './spell-resources.mjs';
import { druidChoiceUpdate } from './druid.mjs';
import { paladinChoiceUpdate } from './paladin.mjs';
import { pactMagicUpdate, invocationUpdate } from './warlock.mjs';
import { fighterChoiceUpdate } from './fighter-choices.mjs';
import { weaponMasteryCount, weaponMasteryChoicesValid } from '../shared/weapon-mastery.mjs';
import { fightingStyleCount, fightingStyleChoicesValid, wizardCantrips } from '../shared/fighting-style.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const statisticsFor = (db, id) => {
  const defaults = emptyStatistics();
  const stored = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id)?.data ?? '{}');
  return { ...defaults, ...stored, values: { ...defaults.values, ...stored.values }, choices: { ...defaults.choices, ...stored.choices } };
};
const saveStatistics = (db, id, stats) => db.prepare('INSERT INTO character_statistics VALUES (?, ?) ON CONFLICT(character_id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(stats));
const save = (db, row) => db.prepare('UPDATE character_advancements SET data=? WHERE id=?').run(JSON.stringify(row), row.id);
const history = (db, id) => db.prepare('SELECT data FROM character_advancements WHERE character_id=? ORDER BY rowid DESC').all(id).map(row => JSON.parse(row.data));
const activeBattle = (db, gameId) => db.prepare('SELECT b.data FROM session_battles b JOIN game_sessions s ON s.id=b.session_id WHERE s.game_id=? AND s.ended_at IS NULL').all(gameId).some(row => JSON.parse(row.data).active);
const snapshot = (character, stats) => ({ level: character.level, subclass: character.subclass, stats });
const publicRow = ({ before, after, resourceFingerprint, ...row }) => row;
function draftShape(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return false;
  if (draft.subclass !== undefined && (typeof draft.subclass !== 'string' || draft.subclass.length > 100)) return false;
  if (draft.feat !== undefined && (typeof draft.feat !== 'string' || draft.feat.length > 100)) return false;
  if (draft.hpMode !== undefined && !['fixed', 'roll'].includes(draft.hpMode)) return false;
  if (draft.featMode !== undefined && !['asi', 'feat'].includes(draft.featMode)) return false;
  if (draft.hpRoll !== undefined && draft.hpRoll !== null && (!Number.isInteger(draft.hpRoll) || draft.hpRoll < 1 || draft.hpRoll > 12)) return false;
  if (draft.increases !== undefined && (!draft.increases || Array.isArray(draft.increases) || typeof draft.increases !== 'object' || Object.entries(draft.increases).some(([key, value]) => !['str','dex','con','int','wis','cha'].includes(key) || !Number.isInteger(value) || value < 0 || value > 2))) return false;
  if (draft.traits !== undefined && (!draft.traits || Array.isArray(draft.traits) || typeof draft.traits !== 'object' || Object.values(draft.traits).some(values => !Array.isArray(values) || values.length > 100 || values.some(v => typeof v !== 'string' || v.length > 150)))) return false;
  if (draft.spells !== undefined && (!draft.spells || !draft.spells.choices || !draft.spells.selections || Array.isArray(draft.spells.choices) || Array.isArray(draft.spells.selections) || typeof draft.spells.choices !== 'object' || typeof draft.spells.selections !== 'object' || Object.values(draft.spells.choices).some(v => typeof v !== 'string') || Object.values(draft.spells.selections).some(v => !Array.isArray(v) || v.some(id => typeof id !== 'string')))) return false;
  if (draft.choices !== undefined) {
    const choices = draft.choices;
    if (!choices || Array.isArray(choices) || typeof choices !== 'object' || !Array.isArray(choices.weaponMastery) || choices.weaponMastery.length > 10 || choices.weaponMastery.some(id => typeof id !== 'string') || typeof choices.fightingStyle !== 'string') return false;
    if (choices.arcaneWarrior !== undefined && (!choices.arcaneWarrior || typeof choices.arcaneWarrior !== 'object' || !Array.isArray(choices.arcaneWarrior.cantrips) || choices.arcaneWarrior.cantrips.some(id => typeof id !== 'string') || typeof choices.arcaneWarrior.ability !== 'string')) return false;
  }
  return true;
}
function validateAdvancement(db, character, previous, draft) {
  const result = advancementPreview(character, previous, draft);
  const next = result.character, stats = result.statistics;
  const error = message => ({ error: message });
  if (!Number.isInteger(previous.values.maxHp) || previous.values.maxHp < 1 || !Number.isInteger(previous.values.con)) return error('Przed awansem uzupełnij maksymalne PW i Kondycję w statystykach.');
  const cls = options.classes.find(c => c.name === next.class);
  if (!cls || !result.hitDie) return error('Brak zasad rozwoju tej klasy.');
  if (next.level >= 3 && !cls.subclasses.includes(next.subclass)) return error('Wybierz podklasę pasującą do klasy.');
  if (draft.hpMode === 'roll' && (!Number.isInteger(draft.hpRoll) || draft.hpRoll < 1 || draft.hpRoll > result.hitDie)) return error(`Podaj wynik k${result.hitDie} w zakresie 1–${result.hitDie}.`);
  if (stats.values.maxHp > 9999) return error('Maksymalne PW przekraczają limit karty.');
  if (hasLevelFeat(next)) {
    if (draft.featMode === 'feat') {
      if (!levelFeatOptions(next, previous).some(f => f.name === draft.feat)) return error('Wybierz dostępny atut, którego jeszcze nie masz.');
      if (Object.values(draft.increases ?? {}).some(Boolean)) return error('Wybierz atut albo zwiększenie cech.');
    } else {
      if (Object.values(draft.increases ?? {}).reduce((sum, n) => sum + n, 0) !== 2) return error('Rozdziel dwa punkty cech: +2 do jednej lub +1 do dwóch.');
      for (const [id, amount] of Object.entries(draft.increases ?? {})) if (amount && (!Number.isInteger(previous.values[id]) || previous.values[id] + amount > 20)) return error('Uzupełnij zwiększane cechy; ten wybór nie może podnieść ich powyżej 20.');
    }
  } else if (draft.feat || Object.values(draft.increases ?? {}).some(Boolean)) return error('Na tym poziomie nie otrzymujesz atutu ani zwiększenia cech.');
  const traitProfile = characterTraits(next, stats);
  const oldTraits = characterTraits(character, previous);
  for (const group of oldTraits.groups) {
    if (['invocations', 'druidForms'].includes(group.id)) continue;
    const prior = previous.traits[group.id] ?? [];
    if (prior.some(value => !(stats.traits[group.id] ?? []).includes(value))) return error(`${group.label}: awans nie pozwala usuwać wcześniejszych stałych wyborów.`);
  }
  if (Object.keys(stats.traits).some(id => !traitProfile.groups.some(g => g.id === id))) return error('Usuń wybory, które nie pasują do nowej podklasy lub poziomu.');
  const traitError = validateTraitSelection(next, { ...stats, requireCompleteTraits: true });
  if (traitError) return error(traitError);
  for (const group of traitProfile.groups) if ((stats.traits[group.id]?.length ?? 0) !== group.limit) return error(`${group.label}: wybierz ${group.limit} opcji.`);
  const spellError = validateSpellSelection(next, stats.spells);
  if (spellError) return error(spellError);
  const spellProfile = spellcastingProfile(next, stats.spells, stats.traits);
  if (next.class === 'Czarodziej (Wizard)') {
    const beforeBook = previous.spells.selections.book ?? [];
    const afterBook = stats.spells.selections.book ?? [];
    if (beforeBook.some(id => !afterBook.includes(id)) || afterBook.filter(id => !beforeBook.includes(id)).length < 2 || afterBook.length < 6 + 2 * (next.level - 1)) return error('Czarodziej: zachowaj księgę i dodaj co najmniej dwa nowe czary (uzupełnij też czary z wcześniejszych poziomów).');
  }
  for (const choice of spellProfile.choices) if (choice.id !== 'style' && !stats.spells.choices[choice.id]) return error(`Uzupełnij: ${choice.label}.`);
  if (previous.spells.choices.order && previous.spells.choices.order !== stats.spells.choices.order) return error('Porządek klasy jest stałym wyborem.');
  for (const group of spellProfile.groups) if (group.limit !== null && (stats.spells.selections[group.id]?.length ?? 0) !== group.limit) return error(`${group.label}: wybierz ${group.limit} czarów.`);
  const choices = stats.choices;
  if (next.class === 'Paladyn (Paladin)' && stats.spells.choices.style === 'magic' && choices.fightingStyle) return error('Blessed Warrior zastępuje Fighting Style. Wybierz jedną z tych opcji.');
  if (!weaponMasteryChoicesValid(next, choices.weaponMastery) || choices.weaponMastery.length !== weaponMasteryCount(next) || !fightingStyleChoicesValid(next, choices.fightingStyle ?? '') || fightingStyleCount(next) && !choices.fightingStyle && stats.spells.choices.style !== 'magic') return error('Uzupełnij Weapon Mastery i Fighting Style.');
  if (choices.fightingStyle === 'arcane-warrior' && (!choices.arcaneWarrior || !['int','wis','cha'].includes(choices.arcaneWarrior.ability) || !Array.isArray(choices.arcaneWarrior.cantrips) || new Set(choices.arcaneWarrior.cantrips).size !== 2 || choices.arcaneWarrior.cantrips.length !== 2 || choices.arcaneWarrior.cantrips.some(id => !wizardCantrips.some(s => s.id === id)))) return error('Arcane Warrior: wybierz dwie różne sztuczki i cechę.');
  if (choices.fastCrafting !== previous.choices?.fastCrafting) return error('Wytwarzanie przedmiotów obsługuj w zakładce Wybory.');
  // Establish the previous level even for characters made before progression metadata existed.
  const state = resourceState(db, character.id);
  const baseline = structuredClone(previous);
  baseline.druidProgression ??= { level: character.level, rest: state.lastLongRest ?? 0, cantripSwaps: 0, formSwaps: 0 };
  baseline.paladinProgression ??= { level: character.level, cantripSwaps: 0 };
  baseline.pactMagicProgression ??= { level: character.level, selections: previous.spells.selections };
  baseline.invocationProgression ??= { level: character.level, selections: previous.traits.invocations ?? [], remaining: 0 };
  const updates = [
    ['druidProgression', druidChoiceUpdate(next, stats, baseline, state, true, true)],
    ['paladinProgression', paladinChoiceUpdate(next, stats.spells, baseline, state)],
    ['pactMagicProgression', pactMagicUpdate(next, stats.spells, baseline, stats.traits, true)],
    ['invocationProgression', invocationUpdate(next, stats, baseline, true)],
    ['fighterChoices', fighterChoiceUpdate(db, next, previous, choices)],
  ];
  for (const [key, update] of updates) { if (update.error) return error(update.error); if (update.history) stats[key] = update.history; }
  return result;
}

export function handleAdvancement(db, user, path, method, body, send) {
  const gameRoute = path.match(/^\/api\/games\/([1-9]\d*)\/advancements(?:\/([^/]+)\/(undo|cancel))?$/);
  const characterRoute = path.match(/^\/api\/characters\/([1-9]\d*)\/advancement(?:\/(draft|complete))?$/);
  if (!gameRoute && !characterRoute) return false;
  const reply = (status, data) => { send(status, data); return true; };
  if (gameRoute) {
    const gameId = Number(gameRoute[1]);
    if (user.role !== 'gm' || !db.prepare('SELECT id FROM games WHERE id=? AND gm_id=?').get(gameId, user.id)) return reply(404, { error: 'Nie znaleziono gry.' });
    if (method === 'GET' && !gameRoute[2]) return reply(200, { advancements: db.prepare('SELECT a.data, c.name AS characterName FROM character_advancements a JOIN characters c ON c.id=a.character_id WHERE a.game_id=? ORDER BY a.rowid DESC').all(gameId).map(row => ({ ...publicRow(JSON.parse(row.data)), characterName: row.characterName })) });
    if (method !== 'POST') return reply(405, { error: 'Niedozwolona metoda.' });
    if (gameRoute[2]) {
      const stored = db.prepare('SELECT * FROM character_advancements WHERE id=? AND game_id=?').get(gameRoute[2], gameId);
      if (!stored) return reply(404, { error: 'Nie znaleziono awansu.' });
      const row = JSON.parse(stored.data);
      if (gameRoute[3] === 'cancel') {
        if (row.status !== 'pending') return reply(409, { error: 'Ten awans nie oczekuje na realizację.' });
        row.status = 'cancelled'; row.cancelledAt = Date.now(); save(db, row);
        return reply(200, { ok: true });
      }
      const character = db.prepare('SELECT * FROM characters WHERE id=?').get(stored.character_id);
      const stats = statisticsFor(db, character.id);
      const latest = history(db, character.id).find(a => a.status === 'completed' || a.status === 'pending');
      if (row.status !== 'completed' || latest?.id !== row.id || activeBattle(db, gameId)) return reply(409, { error: 'Możesz cofnąć tylko ostatni ukończony awans, poza walką i bez kolejnego oczekującego awansu.' });
      if (fingerprint(snapshot(character, stats)) !== fingerprint(row.after) || fingerprint(resourceState(db, character.id)) !== row.resourceFingerprint) return reply(409, { error: 'Po awansie zmieniono kartę lub zużyto zasoby. Cofnięcie nadpisałoby późniejsze zmiany.' });
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE characters SET level=?, subclass=? WHERE id=?').run(row.before.level, row.before.subclass, character.id);
        saveStatistics(db, character.id, row.before.stats);
        row.status = 'reverted'; row.revertedAt = Date.now(); save(db, row); db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return reply(200, { ok: true });
    }
    const ids = body.characterIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 1) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) return reply(400, { error: 'Wybierz postacie i podaj powód awansu (do 500 znaków).' });
    const characters = [];
    for (const id of ids) {
      const character = db.prepare("SELECT c.* FROM characters c JOIN game_members m ON m.character_id=c.id WHERE c.id=? AND m.game_id=? AND m.status='accepted'").get(id, gameId);
      if (!character) return reply(404, { error: 'Postać nie należy do tej gry.' });
      if (character.level >= 20 || history(db, id).some(a => a.status === 'pending')) return reply(409, { error: `${character.name}: maksymalny poziom lub już oczekujący awans.` });
      characters.push(character);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const c of characters) {
        const row = { id: randomUUID(), characterId: c.id, gameId, fromLevel: c.level, toLevel: c.level + 1, reason: body.reason.trim(), gmName: user.name, grantedAt: Date.now(), status: 'pending', version: 0, draft: {} };
        db.prepare('INSERT INTO character_advancements VALUES (?, ?, ?, ?)').run(row.id, c.id, gameId, JSON.stringify(row));
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return reply(201, { ok: true });
  }
  const id = Number(characterRoute[1]);
  const character = db.prepare('SELECT * FROM characters WHERE id=? AND user_id=?').get(id, user.id);
  if (!character) return reply(404, { error: 'Nie znaleziono postaci.' });
  const stats = statisticsFor(db, id);
  const rows = history(db, id), pending = rows.find(a => a.status === 'pending');
  const base = fingerprint(snapshot(character, stats));
  if (!characterRoute[2] && method === 'GET') return reply(200, { character, statistics: stats, base, blockedByBattle: pending ? activeBattle(db, pending.gameId) : false, pending: pending ? publicRow(pending) : null, history: rows.map(publicRow) });
  if (method !== 'POST') return reply(405, { error: 'Niedozwolona metoda.' });
  if (!pending || pending.id !== body.id || pending.version !== body.version || pending.fromLevel !== character.level) return reply(409, { error: 'Awans zmienił się. Odśwież zakładkę Rozwój.' });
  if (body.base !== base) return reply(409, { error: 'Karta została zmieniona w innym oknie. Odśwież zakładkę Rozwój przed kontynuacją.' });
  if (!db.prepare("SELECT id FROM game_members WHERE game_id=? AND character_id=? AND status='accepted'").get(pending.gameId, id)) return reply(409, { error: 'Postać nie należy już do gry przyznającej awans.' });
  if (!draftShape(body.draft)) return reply(400, { error: 'Niepoprawne dane kreatora.' });
  const draft = Object.fromEntries(['subclass','hpMode','hpRoll','featMode','feat','increases','spells','traits','choices'].filter(key => Object.hasOwn(body.draft, key)).map(key => [key, body.draft[key]]));
  if (characterRoute[2] === 'draft') {
    pending.draft = draft; pending.version++; save(db, pending);
    return reply(200, { pending: publicRow(pending) });
  }
  if (activeBattle(db, pending.gameId)) return reply(409, { error: 'Zakończ aktywną walkę przed zatwierdzeniem awansu.' });
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = validateAdvancement(db, character, stats, draft);
    if (result.error) { db.exec('ROLLBACK'); return reply(400, { error: result.error }); }
    pending.before = snapshot(character, stats);
    pending.after = snapshot(result.character, result.statistics);
    pending.resourceFingerprint = fingerprint(resourceState(db, id));
    pending.hpGain = result.hpGain;
    pending.features = result.features.map(f => f.name);
    pending.draft = draft; pending.status = 'completed'; pending.completedAt = Date.now(); pending.version++;
    db.prepare('UPDATE characters SET level=?, subclass=? WHERE id=?').run(result.character.level, result.character.subclass, id);
    saveStatistics(db, id, result.statistics); save(db, pending); db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return reply(200, { character: { ...character, level: pending.toLevel, subclass: pending.after.subclass }, advancement: publicRow(pending) });
}
