import { createHash } from 'node:crypto';
import { paladinChoiceUpdate } from './paladin.mjs';
import { druidChoiceUpdate } from './druid.mjs';
import { resourceState } from './spell-resources.mjs';
import { fighterChoiceUpdate } from './fighter-choices.mjs';
import definitions from '../shared/statistics.json' with { type: 'json' };
import { emptySpellSelection, spellcastingProfile, validateSpellSelection } from '../shared/spellcasting.mjs';
import { characterTraits, emptyTraitSelection, validateTraitSelection } from '../shared/character-traits.mjs';
import { armorClassFromEquipment, armorSpeedPenalty, armorTrainingEffects, hasArmorTraining, hasStealthDisadvantage, speedFromEquipment } from './armor-class.mjs';
import { weaponMasteryChoicesValid } from '../shared/weapon-mastery.mjs';
import { fightingStyleChoicesValid, wizardCantrips } from '../shared/fighting-style.mjs';
import { fastCraftingOptions } from '../shared/crafter.mjs';
import { pactMagicUpdate, invocationUpdate } from './warlock.mjs';

const emptyArcaneWarrior = () => ({ cantrips: [], ability: '' });
const validArcaneWarrior = value => value && typeof value === 'object' && !Array.isArray(value)
  && Array.isArray(value.cantrips) && value.cantrips.length === 2
  && new Set(value.cantrips).size === 2
  && value.cantrips.every(id => wizardCantrips.some(spell => spell.id === id))
  && ['int', 'wis', 'cha'].includes(value.ability);

// Include every source used to derive editable statistics. Compute this inside
// the request transaction, so a Firestore retry checks the latest state again.
function statisticsRevision(db, character) {
  const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(character.id);
  const equipment = db.prepare(`SELECT i.id, i.equipped, i.armor_id, a.category, a.armor_class, a.strength, a.stealth_disadvantage
    FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ? ORDER BY i.id`).all(character.id);
  return createHash('sha256').update(JSON.stringify({ character, stored: stored?.data ?? null, equipment })).digest('hex');
}

export function emptyStatistics() {
  return {
    armorClassBase: 'class',
    traits: emptyTraitSelection(),
    spells: emptySpellSelection(),
    values: Object.fromEntries([...definitions.abilities, ...definitions.numbers].map(field => [field.id, null])),
    savingThrows: [],
    skills: Object.fromEntries(definitions.skills.map(skill => [skill.id, 0])),
    spellAbility: '',
    notes: Object.fromEntries(definitions.notes.map(field => [field.id, ''])),
    choices: { weaponMastery: [], fightingStyle: '', arcaneWarrior: emptyArcaneWarrior(), fastCrafting: '' },
  };
}
function validStatistics(stats) {
  if (!stats || typeof stats !== 'object' || !stats.values || !stats.skills || !stats.notes || !Array.isArray(stats.savingThrows)) return false;
  if (stats.armorClassBase !== undefined && !['standard', 'class'].includes(stats.armorClassBase)) return false;
  const abilities = definitions.abilities.map(ability => ability.id);
  if (stats.spellAbility !== '' && !abilities.includes(stats.spellAbility)) return false;
  if (stats.savingThrows.some(id => !abilities.includes(id)) || new Set(stats.savingThrows).size !== stats.savingThrows.length) return false;
  for (const field of [...definitions.abilities.map(ability => ({ ...ability, min: 1, max: 30 })), ...definitions.numbers]) {
    if (field.id === 'ac') continue;
    const value = stats.values[field.id];
    if (value !== null && (!Number.isInteger(value) || value < field.min || value > field.max)) return false;
  }
  if (definitions.skills.some(skill => ![0, 1, 2].includes(stats.skills[skill.id]))) return false;
  if (definitions.notes.some(field => typeof stats.notes[field.id] !== 'string' || stats.notes[field.id].length > 1500)) return false;
  return true;
}
export function handleStatistics(db, user, path, method, body, send) {
  const match = path.match(/^\/api\/characters\/([1-9]\d*)\/(statistics|choices)$/);
  if (!match) return false;
  const characterId = Number(match[1]);
  const character = Number.isSafeInteger(characterId) && db.prepare('SELECT id, class, level, subclass, species, background FROM characters WHERE id = ? AND user_id = ?').get(characterId, user.id);
  if (!character) {
    send(404, { error: 'Nie znaleziono postaci.' }); return true;
  }
  if (match[2] === 'choices') {
    if (method === 'GET') {
      const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId);
      const choices = stored ? JSON.parse(stored.data).choices ?? {} : {};
      const currentStats = stored ? JSON.parse(stored.data) : emptyStatistics();
      const craftingProfile = characterTraits(character, currentStats);
      const ownedTools = new Set(db.prepare('SELECT name FROM character_items WHERE character_id = ?').all(characterId).map(item => item.name));
      const craftingOptions = craftingProfile.feats.includes('Crafter') ? fastCraftingOptions([...new Set([...craftingProfile.tools, ...ownedTools])]).map(option => {
        const catalog = option.kind === 'item'
          ? db.prepare('SELECT name FROM item_catalog WHERE source_id = ?').get(option.id)
          : db.prepare('SELECT name FROM weapon_catalog WHERE id = ?').get(option.id);
        return { value: `${option.kind}:${option.id}`, name: catalog?.name ?? option.id, toolLabel: option.toolLabel };
      }).filter(option => option.name) : [];
      const hasCrafter = craftingProfile.feats.includes('Crafter') || character.background === 'Rzemieślnik (Artisan)';
      send(200, { hasCrafter, choices: {
        weaponMastery: choices.weaponMastery ?? [],
        fightingStyle: choices.fightingStyle ?? '',
        arcaneWarrior: choices.arcaneWarrior ?? emptyArcaneWarrior(),
        fastCrafting: choices.fastCrafting ?? '',
      }, fastCraftingOptions: craftingOptions });
    } else if (method === 'POST') {
      const arcaneWarrior = body?.arcaneWarrior;
      const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId);
      const currentStats = stored ? JSON.parse(stored.data) : emptyStatistics();
      const profile = characterTraits(character, currentStats);
      const ownedTools = new Set(db.prepare('SELECT name FROM character_items WHERE character_id = ?').all(characterId).map(item => item.name));
      const availableCrafting = (profile.feats.includes('Crafter') || character.background === 'Rzemieślnik (Artisan)')
        ? fastCraftingOptions([...new Set([...profile.tools, ...ownedTools])])
        : [];
      const fastCrafting = Object.hasOwn(body, 'fastCrafting') ? body.fastCrafting : currentStats.choices?.fastCrafting ?? '';
      if (!body || !weaponMasteryChoicesValid(character, body.weaponMastery) || !fightingStyleChoicesValid(character, body.fightingStyle ?? '')
        || typeof fastCrafting !== 'string'
        || (fastCrafting !== '' && !availableCrafting.some(option => `${option.kind}:${option.id}` === fastCrafting))
        || (body.fightingStyle === 'arcane-warrior' && !validArcaneWarrior(arcaneWarrior))) {
        send(400, { error: 'Wybierz poprawne, niepowtarzające się bronie do Weapon Mastery.' }); return true;
      }
      const fighterUpdate = fighterChoiceUpdate(db, character, currentStats, body);
      if (fighterUpdate.error) { send(400, { error: fighterUpdate.error }); return true; }
      const stats = currentStats;
      if (fighterUpdate.history) stats.fighterChoices = fighterUpdate.history;
      if (fastCrafting !== '' && fastCrafting !== stats.choices?.fastCrafting) {
        const [kind, id] = fastCrafting.split(':');
        db.exec('BEGIN IMMEDIATE');
        try {
          const option = availableCrafting.find(value => value.kind === kind && value.id === id);
          const item = kind === 'item'
            ? db.prepare('SELECT source_id AS sourceId, name, description, slot, weight, cost FROM item_catalog WHERE source_id = ?').get(id)
            : db.prepare('SELECT id, name, weight, cost FROM weapon_catalog WHERE id = ?').get(id);
          if (!option || !item) { db.exec('ROLLBACK'); send(409, { error: 'Wybrany przedmiot nie jest już dostępny w tabeli Szybkie wytwarzanie.' }); return true; }
          db.prepare(`INSERT INTO character_items
            (character_id, name, description, quantity, slot, equipped, weapon_id, weight, cost)
            VALUES (?, ?, ?, 1, 'backpack', 0, ?, ?, ?)`).run(characterId, item.name, item.description ?? '', kind === 'weapon' ? item.id : null, item.weight, item.cost);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      stats.choices = {
        weaponMastery: body.weaponMastery,
        fightingStyle: body.fightingStyle ?? '',
        arcaneWarrior: body.fightingStyle === 'arcane-warrior' ? arcaneWarrior : emptyArcaneWarrior(),
        fastCrafting,
      };
      db.prepare('INSERT INTO character_statistics (character_id, data) VALUES (?, ?) ON CONFLICT(character_id) DO UPDATE SET data = excluded.data').run(characterId, JSON.stringify(stats));
      send(200, { choices: stats.choices });
    } else send(405, { error: 'Niedozwolona metoda.' });
  } else if (method === 'GET') {
    const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId);
    const statistics = stored ? JSON.parse(stored.data) : emptyStatistics();
    statistics.spells ??= emptySpellSelection();
    statistics.traits ??= emptyTraitSelection();
    statistics.choices ??= { weaponMastery: [], fightingStyle: '', arcaneWarrior: emptyArcaneWarrior() };
    statistics.choices.fightingStyle ??= '';
    statistics.choices.arcaneWarrior ??= emptyArcaneWarrior();
    statistics.choices.fastCrafting ??= '';
    statistics.spellAbility = spellcastingProfile(character, statistics.spells, statistics.traits).ability || statistics.spellAbility;
    statistics.proficiency = 2 + Math.floor((character.level - 1) / 4);
    const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength,
      a.stealth_disadvantage AS stealthDisadvantage
      FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(characterId);
    const trainingEffects = armorTrainingEffects(characterTraits(character, statistics), equipment);
    statistics.values.ac = armorClassFromEquipment(statistics, equipment.map(item => ({ ...item, trained: hasArmorTraining(characterTraits(character, statistics), item.armorCategory) })), character);
    statistics.values.speed = speedFromEquipment(statistics, equipment, statistics.values.speed);
    if (hasStealthDisadvantage(equipment)) statistics.stealthDisadvantage = true;
    Object.entries(trainingEffects).forEach(([key, value]) => { if (value) statistics[key] = true; });
    send(200, { statistics, revision: statisticsRevision(db, character) });
  } else if (method === 'POST') {
    if (!validStatistics(body)) { send(400, { error: 'Sprawdź statystyki: cechy 1–30, zakresy liczb i długość notatek (do 1500 znaków).' }); return true; }
    if (typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision)) {
      send(428, { error: 'Ten formularz nie ma aktualnej wersji danych. Odśwież stronę i ponownie rozpocznij edycję.' }); return true;
    }
    if (body.expectedRevision !== statisticsRevision(db, character)) {
      send(409, { error: 'Karta zmieniła się od rozpoczęcia edycji. Nie zapisano Twoich zmian, aby nie nadpisać nowszych danych.' }); return true;
    }
    const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId);
    const combats = db.prepare(`SELECT b.data FROM session_battles b JOIN game_sessions s ON s.id = b.session_id
      JOIN game_members m ON m.game_id = s.game_id WHERE m.character_id = ? AND s.ended_at IS NULL`).all(characterId);
    const fighting = combats.some(row => { const battle = JSON.parse(row.data); return battle.active && battle.fighters.some(f => f.characterId === characterId); });
    if (fighting && stored) {
      const current = JSON.parse(stored.data).values;
      if (['hp', 'tempHp', 'deathSuccesses', 'deathFailures'].some(key => body.values[key] !== current[key])) {
        send(409, { error: 'PW i rzuty przeciw śmierci zmieniły się w trwającej walce. Odśwież kartę; te wartości zmieniaj na ekranie walki.' }); return true;
      }
    }
    const spells = Object.hasOwn(body, 'spells') ? body.spells : (stored ? JSON.parse(stored.data).spells : null) ?? emptySpellSelection();
    const spellError = validateSpellSelection(character, spells);
    if (spellError) { send(400, { error: spellError }); return true; }
    const levelFeats = stored ? JSON.parse(stored.data).levelFeats ?? [] : [];
    body.levelFeats = levelFeats;
    const submittedTraits = Object.hasOwn(body, 'traits') ? body.traits : (stored ? JSON.parse(stored.data).traits : null) ?? emptyTraitSelection();
    const submittedTraitEntries = submittedTraits && typeof submittedTraits === 'object' && !Array.isArray(submittedTraits) ? Object.entries(submittedTraits) : [];
    const supportedTraitGroups = new Set(characterTraits(character, { ...body, spells, traits: submittedTraits }).groups.map(group => group.id));
    if (submittedTraitEntries.some(([id]) => !supportedTraitGroups.has(id))) { send(400, { error: 'Wybór biegłości nie pasuje do obecnej klasy, gatunku lub pochodzenia.' }); return true; }
    const traits = Object.fromEntries(submittedTraitEntries.filter(([id]) => supportedTraitGroups.has(id)));
    const traitError = validateTraitSelection(character, { ...body, spells, traits, requireCompleteTraits: true });
    if (traitError) { send(400, { error: traitError }); return true; }
    const druid = druidChoiceUpdate(character, { spells, traits }, stored ? JSON.parse(stored.data) : null, character.class === 'Druid' ? resourceState(db, characterId) : {}, Object.hasOwn(body, 'spells'), Object.hasOwn(body, 'traits'));
    if (druid.error) { send(400, { error: druid.error }); return true; }
    const paladin = paladinChoiceUpdate(character, spells, stored ? JSON.parse(stored.data) : null, character.class === 'Paladyn (Paladin)' ? resourceState(db, characterId) : {});
    if (paladin.error) { send(400, { error: paladin.error }); return true; }
    const pactMagic = pactMagicUpdate(character, spells, stored ? JSON.parse(stored.data) : null, traits, Object.hasOwn(body, 'spells'));
    if (pactMagic.error) { send(400, { error: pactMagic.error }); return true; }
    const invocation = invocationUpdate(character, { spells, traits }, stored ? JSON.parse(stored.data) : null, Object.hasOwn(body, 'traits'));
    if (invocation.error) { send(400, { error: invocation.error }); return true; }
    const choices = Object.hasOwn(body, 'choices') ? body.choices : (stored ? JSON.parse(stored.data).choices : null) ?? { weaponMastery: [], fightingStyle: '', arcaneWarrior: emptyArcaneWarrior() };
    if (!choices || !weaponMasteryChoicesValid(character, choices.weaponMastery ?? []) || !fightingStyleChoicesValid(character, choices.fightingStyle ?? '')
      || (choices.fightingStyle === 'arcane-warrior' && !validArcaneWarrior(choices.arcaneWarrior))) { send(400, { error: 'Wybierz poprawne wybory Weapon Mastery i Fighting Style.' }); return true; }
    if (character.class === 'Paladyn (Paladin)' && spells.choices.style === 'magic' && choices.fightingStyle) { send(400, { error: 'Blessed Warrior zast?puje Fighting Style.' }); return true; }
    const fighterUpdate = fighterChoiceUpdate(db, character, stored ? JSON.parse(stored.data) : null, choices);
    if (fighterUpdate.error) { send(400, { error: fighterUpdate.error }); return true; }
    // Store only supported fields, never arbitrary properties from the request.
    const stats = emptyStatistics();
    if (levelFeats.length) stats.levelFeats = levelFeats;
    if (fighterUpdate.history) stats.fighterChoices = fighterUpdate.history;
    stats.armorClassBase = body.armorClassBase ?? 'class';
    for (const key of Object.keys(stats.values)) stats.values[key] = key === 'ac' ? null : body.values[key];
    for (const key of Object.keys(stats.skills)) stats.skills[key] = body.skills[key];
    for (const key of Object.keys(stats.notes)) stats.notes[key] = body.notes[key];
    stats.savingThrows = body.savingThrows;
    stats.spells = spells;
    if (druid.history) stats.druidProgression = druid.history;
    if (paladin.history) stats.paladinProgression = paladin.history;
    if (pactMagic.history) stats.pactMagicProgression = pactMagic.history;
    if (invocation.history) stats.invocationProgression = invocation.history;
    stats.traits = traits;
    stats.choices = {
      weaponMastery: choices.weaponMastery,
      fightingStyle: choices.fightingStyle ?? '',
      arcaneWarrior: choices.fightingStyle === 'arcane-warrior' ? choices.arcaneWarrior : emptyArcaneWarrior(),
      fastCrafting: choices.fastCrafting ?? '',
    };
    stats.spellAbility = spellcastingProfile(character, spells, traits).ability || body.spellAbility;
    stats.proficiency = 2 + Math.floor((character.level - 1) / 4);
    const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.strength
      FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(characterId);
    if (stats.values.speed !== null) stats.values.speed += armorSpeedPenalty(stats, equipment);
    db.prepare('INSERT INTO character_statistics (character_id, data) VALUES (?, ?) ON CONFLICT(character_id) DO UPDATE SET data = excluded.data').run(characterId, JSON.stringify(stats));
    const outputEquipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength,
      a.stealth_disadvantage AS stealthDisadvantage
      FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(characterId);
    const outputTraits = characterTraits(character, stats);
    const outputEffects = armorTrainingEffects(outputTraits, outputEquipment);
    stats.values.ac = armorClassFromEquipment(stats, outputEquipment.map(item => ({ ...item, trained: hasArmorTraining(outputTraits, item.armorCategory) })), character);
    stats.values.speed = speedFromEquipment(stats, outputEquipment, stats.values.speed);
    if (hasStealthDisadvantage(outputEquipment)) stats.stealthDisadvantage = true;
    Object.entries(outputEffects).forEach(([key, value]) => { if (value) stats[key] = true; });
    send(200, { statistics: stats, revision: statisticsRevision(db, character) });
  } else send(405, { error: 'Niedozwolona metoda.' });
  return true;
}
