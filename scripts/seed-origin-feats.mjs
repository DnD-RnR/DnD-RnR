import { connectFirestore, firestoreLayout } from '../server/firestore.mjs';
import feats from '../shared/origin-feats.json' with { type: 'json' };

if (feats.some(feat => feat.category !== 'Origin') || new Set(feats.map(f => f.id)).size !== feats.length) {
  throw new Error('Invalid Origin-only catalog.');
}
const firestore = connectFirestore();
const { root, collection } = firestoreLayout(firestore);
try {
  const changed = await firestore.runTransaction(async transaction => {
    const meta = await transaction.get(root);
    if (!meta.exists || meta.get('schemaVersion') !== 1) throw new Error('Firestore must already be initialized.');
    const previous = await transaction.get(collection('origin_feat_catalog'));
    const known = new Map(previous.docs.map(doc => [doc.id, doc.data()]));
    let changed = 0;
    for (const feat of feats) {
      const row = { id: feat.id, name: feat.name, category: 'Origin', data: JSON.stringify(feat) };
      const old = known.get(feat.id);
      if (old?.name === row.name && old.category === row.category && old.data === row.data) continue;
      transaction.set(collection('origin_feat_catalog').doc(feat.id), row);
      changed++;
    }
    if (changed) transaction.update(root, { revision: meta.get('revision') + 1 });
    return changed;
  });
  console.log(`Origin feats: ${feats.length}; updated: ${changed}.`);
} finally { await firestore.terminate(); }
