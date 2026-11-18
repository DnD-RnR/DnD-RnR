import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { emptyStatistics } from './statistics.mjs';
import { characterTraits, validateTraitSelection, dragonbornAncestries, dragonbornAncestryProfile } from '../shared/character-traits.mjs';
import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { speciesSaveAdvantage, speciesD20 } from '../shared/species.mjs';
import { publicCaster, spendSpell, resourceState, saveResources, handleSpellResources } from './spell-resources.mjs';
import { handleBattles } from './battles.mjs';
import { exportRows, hydrate } from './firestore.mjs';

const hero = (species, level = 5) => ({ class: 'Wojownik (Fighter)', subclass: '', level, species, background: '' });
function fixture(species, traits = {}, level = 5) {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO users VALUES (1,'gm','GM','unused','gm'),(2,'hero','Hero','unused','player');
    INSERT INTO games (id,gm_id,name) VALUES (1,1,'Game');
    INSERT INTO game_sessions (id,game_id,started_at) VALUES (1,1,1);
    INSERT INTO characters (id,user_id,name,class,level) VALUES (1,2,'Hero','Fighter',5);
    INSERT INTO game_members (id,game_id,character_id,status) VALUES (1,1,1,'accepted');
    INSERT INTO session_participants VALUES (1,1,1);
    INSERT INTO game_monster_entries VALUES (1,'ogre','Ogre',80,12,30,'','{"str":2,"dex":0,"con":0,"int":0,"wis":0,"cha":0}');
    INSERT INTO character_items (id,character_id,name,quantity,slot,equipped,weapon_id) VALUES (1,1,'Sword',1,'main-hand',1,'longsword');`);
  db.prepare('UPDATE characters SET class = ?, species = ?, level = ? WHERE id = 1').run(hero(species).class, species, level);
  const stats = emptyStatistics();
  Object.assign(stats.values, { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 14, hp: 20, maxHp: 40, tempHp: 0, ac: 15, speed: null });
  stats.traits = traits; db.prepare('INSERT INTO character_statistics VALUES (1, ?)').run(JSON.stringify(stats));
  const gm = { id: 1, role: 'gm' }, player = { id: 2, role: 'player' };
  let version = 0;
  const call = (action = '', body = {}, user = gm) => {
    let result; handleBattles(db, user, `/api/games/1/battle${action ? '/' + action : ''}`, action ? 'POST' : 'GET', { sessionId: 1, version, ...body }, (status, data) => { result = { status, ...data }; });
    if (result.battle) version = result.battle.version; return result;
  };
  const start = () => call('start', { fighters: [{ memberId: 1, initiative: 20 }, { enemyId: 'ogre', initiative: 10 }] });
  const rest = type => { let result; handleSpellResources(db, gm, '/api/games/1/spell-rest', 'POST', { rest: type }, (status, data) => { result = { status, ...data }; }); return result; };
  const outside = body => { let result; handleSpellResources(db, player, '/api/characters/1/spell-resources', 'POST', { kind: 'species-outside', version: resourceState(db, 1).version, confirmed: true, ...body }, (status, data) => { result = { status, ...data }; }); return result; };
  return { db, stats, call, start, rest, outside, gm, player };
}

test('SRD elven lineages grant level-gated spells, senses, speed and independent casting abilities', () => {
  for (const lineage of ['drow', 'high', 'wood']) for (const level of [1, 3, 5]) {
    const c = hero('Elf', level), traits = { elfLineage: [lineage], elfSpellAbility: ['wis'] };
    const profile = spellcastingProfile(c, undefined, traits);
    assert.equal(profile.automatic.length, level === 1 ? 1 : level === 3 ? 2 : 3);
    assert.ok(profile.automatic.every(s => s.spellcastingAbility === 'wis'));
    const stats = emptyStatistics(); stats.traits = traits;
    const p = characterTraits(c, stats);
    assert.equal(p.darkvision, lineage === 'drow' ? 120 : 60);
    assert.equal(p.baseSpeed, lineage === 'wood' ? 35 : 30);
    assert.equal(p.creatureType, 'Humanoid');
  }
  const profile = spellcastingProfile(hero('Elf'), undefined, { elfLineage: ['high'], elfSpellAbility: ['cha'], highElfCantrip: ['fire-bolt'] });
  assert.equal(profile.automatic[0].id, 'fire-bolt');
  assert.throws(() => spellcastingProfile(hero('Elf'), undefined, { elfLineage: ['high'], highElfCantrip: ['cure-wounds'] }));
});

test('Aasimar requires size, grants CHA Light and both celestial resistances', () => {
  const c = hero('Aasimar'), stats = emptyStatistics(); stats.requireCompleteTraits = true;
  assert.match(validateTraitSelection(c, stats), /Aasimar/);
  stats.traits = { aasimarSize: ['small'] };
  assert.equal(validateTraitSelection(c, stats), null);
  const p = characterTraits(c, stats);
  assert.equal(p.size, 'Small'); assert.equal(p.darkvision, 60);
  assert.deepEqual(p.damageResistances, ['nekrotyczne', 'promieniste']);
  const light = spellcastingProfile(c).automatic.find(s => s.id === 'light');
  assert.equal(light.spellcastingAbility, 'cha');
});

test('Forest Gnome free casts exhaust at proficiency, persist and reset only after long rest', () => {
  const f = fixture('Gnom (Gnome)', { gnomeLineage: ['forest'], gnomeSpellAbility: ['wis'] });
  try {
    assert.ok(publicCaster(f.db, 1).spells.some(s => s.id === 'minor-illusion'));
    for (let i = 0; i < 3; i++) spendSpell(f.db, 1, 'speak-with-animals', 1, 'legacy');
    assert.equal(publicCaster(f.db, 1).spells.find(s => s.id === 'speak-with-animals').speciesFreeRemaining, 0);
    assert.throws(() => spendSpell(f.db, 1, 'speak-with-animals', 1, 'legacy'));
    assert.equal(f.rest('short').status, 200);
    assert.throws(() => spendSpell(f.db, 1, 'speak-with-animals', 1, 'legacy'));
    const restored = hydrate(exportRows(f.db));
    try { assert.equal(resourceState(restored, 1).speciesSpellUses['speak-with-animals'], 3); } finally { restored.close(); }
    assert.equal(f.rest('long').status, 200);
    assert.equal(publicCaster(f.db, 1).spells.find(s => s.id === 'speak-with-animals').speciesFreeRemaining, 3);
  } finally { f.db.close(); }
});

test('Orc adrenaline renews on short rest while endurance stays spent', () => {
  const f = fixture('Ork (Orc)');
  try {
    const state = resourceState(f.db, 1); state.adrenalineRushUses = 0; state.relentlessEnduranceAvailable = false; saveResources(f.db, 1, state);
    assert.equal(f.rest('short').status, 200);
    assert.equal(resourceState(f.db, 1).adrenalineRushUses, 3);
    assert.equal(resourceState(f.db, 1).relentlessEnduranceAvailable, false);
  } finally { f.db.close(); }
});

test('Dragonborn breath replaces one attack and flight ends on incapacitation', () => {
  const f = fixture('Smokowiec (Dragonborn)', { dragonbornAncestry: ['fire'] });
  try {
    f.start();
    const breath = f.call('act', { kind: 'breath-weapon', slot: 'action' }, f.player);
    assert.equal(breath.status, 200); assert.equal(breath.battle.fighters[0].attacksLeft, 1);
    assert.match(breath.battle.pending.description, /na ZR,/);
    f.call('act', { kind: 'resolve', note: 'Brak celów.' });
    const targetId = f.call().battle.fighters[1].id;
    assert.equal(f.call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 1 }, f.player).status, 200);
    const flight = f.call('act', { kind: 'draconic-flight', slot: 'bonus' }, f.player);
    assert.equal(flight.status, 200); assert.equal(flight.battle.fighters[0].flySpeed, 30);
    const actorId = flight.battle.fighters[0].id;
    const disabled = f.call('act', { kind: 'condition', actorId, condition: 'incapacitated', enabled: true });
    assert.equal(disabled.status, 200); assert.equal(disabled.battle.fighters[0].flySpeed, 0);
    assert.equal(resourceState(f.db, 1).draconicFlightAvailable, false);
  } finally { f.db.close(); }
});

test('Dragonborn has ten ancestors and breath uses DEX, shared damage dice and half on a successful save', () => {
  assert.equal(dragonbornAncestries.length, 10);
  assert.equal(dragonbornAncestryProfile('red').damageType, 'ogień');
  assert.equal(dragonbornAncestryProfile('fire').damageType, 'ogień'); // Existing saved characters.
  const f = fixture('Smokowiec (Dragonborn)', { dragonbornAncestry: ['red'] });
  try {
    const b = f.start().battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
    f.call('act', { kind: 'breath-weapon', slot: 'action' }, f.player);
    assert.equal(f.call('act', { kind: 'species-breath-targets', actorId, targetIds: [targetId], confirmed: true }).status, 200);
    assert.equal(f.call('act', { kind: 'spell-save', targetId, roll: 20 }).status, 200);
    assert.equal(f.call('act', { kind: 'spell-defense', targetId, multiplier: 1 }).status, 200);
    assert.equal(f.call('act', { kind: 'spell-effect', rolls: [5, 6] }, f.player).status, 200);
    assert.equal(f.call().battle.fighters[1].hp, 75);
    assert.equal(f.call().battle.fighters[0].attacksLeft, 1);
  } finally { f.db.close(); }
});

test('Dwarf poison resistance applies to typed damage and Stonecunning has a persistent limit', () => {
  const f = fixture('Krasnolud (Dwarf)');
  try {
    const actorId = f.start().battle.fighters[0].id;
    assert.equal(f.call('act', { kind: 'species-stonecunning', confirmed: true }, f.player).status, 200);
    assert.equal(resourceState(f.db, 1).stonecunningUses, 1);
    assert.equal(f.call('act', { kind: 'species-stonecunning', confirmed: true }, f.player).status, 409);
    f.call('next');
    f.call('act', { kind: 'request', slot: 'action', description: 'Poison' });
    const hit = f.call('act', { kind: 'resolve', note: 'Poison', targetId: actorId, effect: 'damage', amount: 10, damageType: 'trucizna' });
    assert.equal(hit.status, 200); assert.equal(hit.battle.fighters[0].hp, 15);
  } finally { f.db.close(); }
});

test('Goliath Large Form changes size, speed, STR checks, expires and cannot be reused', () => {
  const f = fixture('Goliat (Goliath)', { giantAncestry: ['cloud'] });
  try {
    f.start(); const large = f.call('act', { kind: 'species-large', confirmed: true }, f.player);
    assert.equal(large.status, 200); assert.equal(large.battle.fighters[0].size, 'Large'); assert.equal(large.battle.fighters[0].speed, 45);
    assert.equal(f.call('act', { kind: 'ability-check', ability: 'str', roll: 10 }, f.player).status, 409);
    assert.equal(f.call('act', { kind: 'ability-check', ability: 'str', roll: 10, roll2: 15 }, f.player).status, 200);
    const end = f.call('act', { kind: 'species-end', effect: 'large' }, f.player);
    assert.equal(end.status, 200); assert.equal(end.battle.fighters[0].speed, 35); assert.equal(end.battle.fighters[0].size, 'Medium');
    assert.equal(resourceState(f.db, 1).largeFormAvailable, false);
  } finally { f.db.close(); }
});

test('Aasimar Healing Hands validates dice atomically and revelation damage is once on own turn', () => {
  const f = fixture('Aasimar', { aasimarSize: ['medium'] });
  try {
    const b = f.start().battle, targetId = b.fighters[1].id;
    assert.equal(f.call('act', { kind: 'species-healing-hands', targetId: b.fighters[0].id, confirmed: true, rolls: [4] }, f.player).status, 409);
    assert.equal(resourceState(f.db, 1).healingHandsUsed, undefined);
    const heal = f.call('act', { kind: 'species-healing-hands', targetId: b.fighters[0].id, confirmed: true, rolls: [4, 3, 2] }, f.player);
    assert.equal(heal.status, 200); assert.equal(heal.battle.fighters[0].hp, 29);
    assert.equal(f.call('act', { kind: 'species-revelation', form: 'wings' }, f.player).status, 200);
    f.call('next'); f.call('next');
    const hit = () => f.call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 15 }, f.player);
    assert.equal(hit().status, 200);
    const damage = f.call('act', { kind: 'damage', rolls: [3], revelationDamage: true }, f.player);
    assert.equal(damage.status, 200); assert.equal(f.call().battle.fighters[1].hp, 71);
    hit(); assert.equal(f.call('act', { kind: 'damage', rolls: [3], revelationDamage: true }, f.player).status, 409);
  } finally { f.db.close(); }
});

test('Human Inspiration and Rock Gnome devices work outside combat with resource versions', () => {
  const human = fixture('Człowiek (Human)');
  try { assert.equal(human.outside({ ability: 'species-inspiration', roll: 17 }).status, 200); assert.equal(human.outside({ ability: 'species-inspiration', roll: 18 }).status, 409); } finally { human.db.close(); }
  const gnome = fixture('Gnom (Gnome)', { gnomeLineage: ['rock'], gnomeSpellAbility: ['int'] });
  try {
    for (let i = 0; i < 3; i++) assert.equal(gnome.outside({ ability: 'gnome-device', deviceEffect: 'ignite', description: 'Fire starter' }).status, 200);
    assert.equal(gnome.outside({ ability: 'gnome-device', deviceEffect: 'ignite', description: 'Fourth' }).status, 409);
    assert.equal(resourceState(gnome.db, 1).gnomeDevices.length, 3);
  } finally { gnome.db.close(); }
});

test('Halfling Luck requires an original 1; species saving advantages match their scopes', () => {
  const f = fixture('Niziołek (Halfling)');
  try {
    f.start(); assert.equal(f.call('act', { kind: 'ability-check', ability: 'str', roll: 1, halflingRoll: 15 }, f.player).status, 200);
    assert.equal(f.call('act', { kind: 'ability-check', ability: 'str', roll: 2, halflingRoll: 15 }, f.player).status, 409);
    assert.equal(speciesD20({ species: 'Niziołek (Halfling)' }, 1, 1), 1);
    assert.throws(() => speciesD20({ species: 'Elf' }, 1, 20));
    assert.equal(speciesSaveAdvantage({ species: 'Gnom (Gnome)' }, 'int'), true);
    assert.equal(speciesSaveAdvantage({ species: 'Gnom (Gnome)' }, 'dex'), false);
    assert.equal(speciesSaveAdvantage({ species: 'Elf' }, 'wis', 'charmed'), true);
    assert.equal(speciesSaveAdvantage({ species: 'Krasnolud (Dwarf)' }, 'con', 'poisoned'), true);
    assert.equal(speciesSaveAdvantage({ species: 'Niziołek (Halfling)' }, 'wis', 'frightened'), true);
  } finally { f.db.close(); }
});

test('Goliath fire, frost and hill apply their hit effects and spend exactly one ancestry use', () => {
  for (const ancestry of ['fire', 'frost', 'hill']) {
    const f = fixture('Goliat (Goliath)', { giantAncestry: [ancestry] });
    try {
      const targetId = f.start().battle.fighters[1].id;
      f.call('act', { kind: 'base-size', actorId: targetId, size: 'Large' });
      f.call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 15 }, f.player);
      const hit = f.call('act', { kind: 'damage', rolls: [3], giantStrike: true, giantRoll: ancestry === 'fire' ? 10 : 6 }, f.player);
      assert.equal(hit.status, 200); assert.equal(resourceState(f.db, 1).giantAncestryUses, 2);
      const target = f.call().battle.fighters[1];
      assert.equal(target.hp, ancestry === 'fire' ? 64 : ancestry === 'frost' ? 68 : 74);
      if (ancestry === 'hill') assert.equal(target.prone, true);
      if (ancestry === 'frost') {
        assert.equal(target.speed, 20); f.call('next');
        assert.equal(f.call('next').battle.fighters[1].speed, 30);
      }
    } finally { f.db.close(); }
  }
});

test('Goliath stone reduces pending damage, storm retaliates once and cloud consumes a bonus action', () => {
  for (const ancestry of ['stone', 'storm', 'cloud']) {
    const f = fixture('Goliat (Goliath)', { giantAncestry: [ancestry] });
    try {
      const b = f.start().battle, actorId = b.fighters[0].id;
      if (ancestry === 'cloud') {
        const jump = f.call('act', { kind: 'species-cloud', confirmed: true, feet: 30 }, f.player);
        assert.equal(jump.status, 200); assert.equal(jump.battle.fighters[0].moved, 0);
        assert.equal(f.call('act', { kind: 'species-cloud', confirmed: true }, f.player).status, 409);
      } else {
        f.call('next');
        const attack = { id: 'club', name: 'Club', bonus: 10, dice: 1, sides: 12, damageBonus: 0, type: 'obuchowe', light: false };
        assert.equal(f.call('act', { kind: 'attack', slot: 'action', targetId: actorId, attack, roll: 15 }).status, 200);
        if (ancestry === 'stone') assert.equal(f.call('act', { kind: 'species-stone', actorId, confirmed: true, roll: 5 }, f.player).status, 200);
        const damage = f.call('act', { kind: 'damage', rolls: [10] });
        assert.equal(damage.status, 200); assert.equal(damage.battle.fighters[0].hp, ancestry === 'stone' ? 17 : 10);
        if (ancestry === 'storm') {
          assert.equal(f.call('act', { kind: 'species-storm', actorId, confirmed: true, roll: 8 }, f.player).status, 200);
          assert.equal(f.call().battle.fighters[1].hp, 72);
          assert.equal(f.call('act', { kind: 'species-storm', actorId, confirmed: true, roll: 8 }, f.player).status, 409);
        }
      }
      assert.equal(resourceState(f.db, 1).giantAncestryUses, 2);
    } finally { f.db.close(); }
  }
});

test('Aasimar radiance requires GM geometry, damages all selected creatures once per turn', () => {
  const f = fixture('Aasimar', { aasimarSize: ['medium'] });
  try {
    const b = f.start().battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
    assert.equal(f.call('act', { kind: 'species-revelation', form: 'radiance' }, f.player).status, 200);
    assert.equal(f.call('next', {}, f.player).status, 409);
    assert.equal(f.call('act', { kind: 'species-radiance-targets', actorId, confirmed: true, targetIds: [actorId, targetId] }, f.player).status, 409);
    assert.equal(f.call('act', { kind: 'species-radiance-targets', actorId, confirmed: true, targetIds: [actorId, targetId] }).status, 200);
    const next = f.call('next'); assert.equal(next.status, 200);
    assert.equal(next.battle.fighters[0].hp, 19); // Radiant resistance, rounded down.
    assert.equal(next.battle.fighters[1].hp, 77);
  } finally { f.db.close(); }
});

test('Aasimar shroud frightens failed CHA targets through the end of the next Aasimar turn', () => {
  const f = fixture('Aasimar', { aasimarSize: ['medium'] });
  try {
    const b = f.start().battle, targetId = b.fighters[1].id;
    const shroud = f.call('act', { kind: 'species-revelation', form: 'shroud', confirmed: true, targetIds: [targetId], saves: { [targetId]: { roll: 1 } } }, f.player);
    assert.equal(shroud.status, 200);
    assert.equal(f.call('act', { kind: 'spell-save', targetId, roll: 1 }).status, 200);
    assert.equal(f.call('act', { kind: 'spell-defense', targetId, multiplier: 1 }).status, 200);
    assert.equal(f.call('act', { kind: 'spell-effect', rolls: [] }, f.player).status, 200);
    assert.ok(f.call().battle.fighters[1].conditionSources.some(e => e.kind === 'frightened'));
    f.call('next'); f.call('next');
    assert.ok(f.call().battle.fighters[1].conditionSources.some(e => e.kind === 'frightened'));
    f.call('next'); assert.equal(f.call().battle.fighters[1].conditionSources.length, 0);
  } finally { f.db.close(); }
});

test('Elf free spells, Aasimar healing and species effects respect long rest and elapsed game time', () => {
  const elf = fixture('Elf', { elfLineage: ['drow'], elfSpellAbility: ['cha'], elfSkill: ['perception'] });
  try {
    spendSpell(elf.db, 1, 'faerie-fire', 1, 'legacy');
    assert.throws(() => spendSpell(elf.db, 1, 'faerie-fire', 1, 'legacy'));
    spendSpell(elf.db, 1, 'darkness', 2, 'legacy');
    elf.rest('long'); assert.doesNotThrow(() => spendSpell(elf.db, 1, 'faerie-fire', 1, 'legacy'));
  } finally { elf.db.close(); }
  const aasimar = fixture('Aasimar', { aasimarSize: ['small'] });
  try {
    assert.equal(aasimar.outside({ ability: 'species-healing-hands', rolls: [4, 4, 4] }).status, 200);
    assert.equal(aasimar.outside({ ability: 'species-healing-hands', rolls: [4, 4, 4] }).status, 409);
    assert.equal(aasimar.outside({ ability: 'species-revelation', form: 'wings' }).status, 200);
    assert.equal(publicCaster(aasimar.db, 1).effectiveStats.flySpeed, 30);
    let response;
    handleSpellResources(aasimar.db, aasimar.gm, '/api/games/1/spell-rest', 'POST', { rest: 'time', seconds: 61 }, (status, data) => { response = { status, ...data }; });
    assert.equal(response.status, 200); assert.equal(publicCaster(aasimar.db, 1).effectiveStats.flySpeed, 0);
    aasimar.rest('short'); assert.equal(resourceState(aasimar.db, 1).healingHandsUsed, true);
    aasimar.rest('long'); assert.equal(resourceState(aasimar.db, 1).healingHandsUsed, false);
  } finally { aasimar.db.close(); }
});

test('Halfling Naturally Stealthy grants Hide invisibility and an attack ends only that source', () => {
  const f = fixture('Niziołek (Halfling)');
  try {
    const b = f.start().battle, targetId = b.fighters[1].id;
    const hidden = f.call('act', { kind: 'species-hide', total: 17, confirmed: true }, f.player);
    assert.equal(hidden.status, 200);
    assert.ok(resourceState(f.db, 1).conditionSources.some(e => e.speciesHide && e.kind === 'invisible'));
    f.call('next'); f.call('next');
    const attack = f.call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 2, roll2: 15 }, f.player);
    assert.equal(attack.status, 200); assert.equal(attack.battle.pending.kind, 'damage');
    assert.equal(resourceState(f.db, 1).conditionSources.some(e => e.speciesHide), false);
  } finally { f.db.close(); }
});

test('Goliath critical hits double ancestry dice but not fixed Revelation damage', () => {
  const f = fixture('Goliat (Goliath)', { giantAncestry: ['fire'] });
  try {
    const targetId = f.start().battle.fighters[1].id;
    f.call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 20 }, f.player);
    assert.equal(f.call('act', { kind: 'damage', rolls: [3, 3], giantStrike: true, giantRolls: [10] }, f.player).status, 409);
    assert.equal(f.call('act', { kind: 'damage', rolls: [3, 3], giantStrike: true, giantRolls: [10, 8] }, f.player).status, 200);
    assert.equal(f.call().battle.fighters[1].hp, 53);
  } finally { f.db.close(); }
});
