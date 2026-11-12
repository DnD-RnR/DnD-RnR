import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, initializeDatabase } from './db.mjs';
import { exportRows, hydrate } from './firestore.mjs';
import { handleOriginFeats } from './origin-feats.mjs';
import feats from '../shared/origin-feats.json' with { type: 'json' };
import { originFeatSheet, originFeatNames } from '../shared/origin-feats.mjs';
import options from '../shared/trait-options.json' with { type: 'json' };

test('Origin catalog seeds idempotently and survives the Firestore round trip', () => {
  const db = openDatabase(':memory:');
  let restored;
  try {
    initializeDatabase(db);
    const rows = db.prepare('SELECT data FROM origin_feat_catalog').all();
    assert.equal(rows.length, feats.length);
    assert.deepEqual(new Set(rows.map(row => JSON.parse(row.data).id)), new Set(feats.map(f => f.id)));
    for (const row of rows) {
      const feat = JSON.parse(row.data);
      assert.equal(feat.category, 'Origin');
      assert.ok(feat.description.length > 30);
      assert.ok(!feat.description.includes('?'), feat.id);
    }
    restored = hydrate(exportRows(db));
    assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM origin_feat_catalog').get().count, feats.length);
    assert.deepEqual(new Set(options.originFeats), new Set(originFeatNames));
  } finally { restored?.close(); db.close(); }
});

test('Origin catalog API requires authentication and allows only reading', () => {
  const db = openDatabase(':memory:');
  try {
    const call = (user, method) => {
      let result;
      assert.equal(handleOriginFeats(db, user, '/api/origin-feats', method, {}, (status, body) => { result = { status, body }; }), true);
      return result;
    };
    assert.equal(call(null, 'GET').status, 401);
    assert.equal(call({ id: 1 }, 'POST').status, 405);
    const result = call({ id: 1 }, 'GET');
    assert.equal(result.status, 200);
    assert.equal(result.body.feats.length, feats.length);
    assert.ok(result.body.feats.every(f => f.category === 'Origin'));
  } finally { db.close(); }
});

test('Origin sheet uses the chosen casting ability and computes level-dependent values', () => {
  const sheet = originFeatSheet(['Magic Initiate (Wizard)', 'Tough', 'Familiar Friend'], { level: 9 }, {
    values: { cha: 18, int: 8 }, traits: {
      'origin:Magic Initiate (Wizard):ability': ['cha'],
      'origin:Magic Initiate (Wizard):cantrips': ['fire-bolt','mage-hand'],
      'origin:Magic Initiate (Wizard):spell': ['shield'],
    },
  });
  assert.equal(sheet[0].spellAttack, 8);
  assert.equal(sheet[0].spellDc, 16);
  assert.equal(sheet[0].spells.length, 3);
  assert.match(sheet[1].details.join(), /18/);
  assert.match(sheet[2].details.join(), /18/);
});
