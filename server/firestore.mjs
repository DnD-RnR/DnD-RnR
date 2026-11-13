import { applicationDefault, cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { openDatabase, initializeDatabase } from './db.mjs';

// Firestore is the only persistent store. SQLite provides relational queries and
// constraints in RAM; it never opens the former local database in this runtime.
export const tables = ['users', 'sessions', 'characters', 'games', 'game_members',
  'game_sessions', 'session_participants', 'weapon_catalog', 'armor_catalog',
  'item_catalog', 'character_items', 'character_statistics', 'game_monsters', 'game_monster_entries', 'session_battles', 'character_spell_resources', 'origin_feat_catalog', 'character_advancements'];
const keys = { character_spell_resources: ['character_id'], session_battles: ['session_id'], game_monster_entries: ['game_id', 'id'], game_monsters: ['game_id'], sessions: ['token'], session_participants: ['session_id', 'member_id'], character_statistics: ['character_id'] };
export const rowId = (table, row) => (keys[table] || ['id']).map(key => encodeURIComponent(String(row[key]))).join('~');
const normalized = value => JSON.stringify(value, Object.keys(value).sort());
export function exportRows(db) {
  return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...row }))]));
}
export function hydrate(rows) {
  const db = openDatabase(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = OFF; BEGIN');
    for (const table of tables) db.exec(`DELETE FROM ${table}`);
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
      const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of rows[table] || []) insert.run(...columns.map(column => row[column] ?? null));
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error(`Invalid foreign keys: ${violations.length}`);
    db.exec('COMMIT; PRAGMA foreign_keys = ON');
    return db;
  } catch (error) { db.close(); throw error; }
}
export function connectFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Set FIREBASE_PROJECT_ID and Google server credentials. Local database fallback is disabled.');
  // In serverless environments store the service account JSON as an encrypted
  // environment variable, not a path to a local secrets file.
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credential = serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault();
  const existing = getApps().find(app => app.options.projectId === projectId);
  const app = existing || initializeApp({ projectId, credential });
  const firestore = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || '(default)');
  if (!existing) firestore.settings({ preferRest: true });
  return firestore;
}
export function firestoreLayout(firestore) {
  const root = firestore.collection('dnd_rnr').doc('main');
  return { root, collection: table => root.collection(table) };
}
export async function readRows(reader, collection, selected = tables, metrics) {
  const snapshots = await Promise.all(selected.map(async table => {
    const snapshot = await reader.get(collection(table));
    if (metrics) {
      metrics.collectionQueries++;
      metrics.documentReads += Math.max(1, snapshot.docs.length);
    }
    return snapshot;
  }));
  return Object.fromEntries(selected.map((table, i) => [table, snapshots[i].docs.map(doc => doc.data())]));
}
export function changesBetween(before, after) {
  const changes = [];
  for (const table of tables) {
    const previous = new Map(before[table].map(row => [rowId(table, row), row]));
    const next = new Map(after[table].map(row => [rowId(table, row), row]));
    for (const [id, row] of next) if (!previous.has(id) || normalized(previous.get(id)) !== normalized(row)) changes.push({ table, id, row });
    for (const id of previous.keys()) if (!next.has(id)) changes.push({ table, id });
  }
  return changes;
}
export async function openFirestoreDatabase(firestore = connectFirestore()) {
  const { root, collection } = firestoreLayout(firestore);
  let current;
  let revision;
  let tableRevisions;
  // Process-local counters count SDK work, including retries. Billing may include
  // additional operations; aggregate all instances and compare with Cloud metrics.
  const metrics = { transactions: 0, attempts: 0, documentReads: 0, collectionQueries: 0,
    documentWrites: 0, documentDeletes: 0, fullReloads: 0, partialReloads: 0, failures: 0, durationMs: 0,
    watchStarts: 0, watchStops: 0, watchReads: 0 };
  const watches = new Set();
  let queue = Promise.resolve();
  const db = {
    metrics() { return { ...metrics }; },
    watchChanges(onChange, onError) {
      let active = true;
      metrics.watchStarts++;
      const unsubscribe = root.onSnapshot(snapshot => {
        if (!active) return;
        metrics.watchReads++;
        metrics.documentReads++;
        if (!snapshot.exists || snapshot.get('schemaVersion') !== 1) {
          onError(new Error('Invalid Firestore metadata'));
          return;
        }
        onChange(snapshot.get('revision'));
      }, error => { if (active) onError(error); });
      const stop = () => {
        if (!active) return;
        active = false;
        metrics.watchStops++;
        watches.delete(stop);
        unsubscribe();
      };
      watches.add(stop);
      return stop;
    },
    prepare(sql) { if (!current) throw new Error('Firestore database is not loaded'); return current.prepare(sql); },
    exec(sql) { return current.exec(sql); },
    close() { for (const stop of watches) stop(); current?.close(); },
    async run(work) {
      const pending = queue.then(async () => {
        const started = performance.now();
        metrics.transactions++;
        let candidate;
        let nextRevision;
        let nextTableRevisions;
        let committedChanges;
        try {
          const result = await firestore.runTransaction(async transaction => {
            metrics.attempts++;
            // A previous attempt can have been aborted by Firestore contention.
            candidate?.close();
            candidate = undefined;
            const meta = await transaction.get(root);
            metrics.documentReads++;
            if (!meta.exists || meta.get('schemaVersion') !== 1) throw new Error('Firestore has not been migrated. Run npm run db:migrate first.');
            const version = meta.get('revision');
            // The marker detects writes from older deployments/scripts which only
            // increment revision. In that case invalidate every table safely.
            const remoteTables = meta.get('trackedRevision') === version &&
              tables.every(table => Number.isSafeInteger(meta.get('tableRevisions')?.[table]))
              ? meta.get('tableRevisions') : undefined;
            let before;
            if (current && version === revision) before = exportRows(current);
            else if (current && remoteTables && tableRevisions) {
              const selected = tables.filter(table => remoteTables[table] !== tableRevisions[table]);
              before = { ...exportRows(current), ...await readRows(transaction, collection, selected, metrics) };
              metrics.partialReloads++;
            } else {
              before = await readRows(transaction, collection, tables, metrics);
              metrics.fullReloads++;
            }
            candidate = hydrate(before);
            const saved = current;
            current = candidate;
            let output;
            try { output = await work(); } finally { current = saved; }
            const after = exportRows(candidate);
            const changes = changesBetween(before, after);
            committedChanges = changes;
            // Stay below Firestore's request limits and fail atomically.
            if (changes.length > 450) throw new Error('Too many database changes in one request (maximum 450).');
            for (const { table, id, row } of changes) {
              if (row) transaction.set(collection(table).doc(id), row);
              else transaction.delete(collection(table).doc(id));
            }
            nextRevision = changes.length ? version + 1 : version;
            nextTableRevisions = remoteTables;
            if (changes.length) {
              nextTableRevisions = { ...(remoteTables || Object.fromEntries(tables.map(table => [table, version]))) };
              for (const { table } of changes) nextTableRevisions[table] = nextRevision;
              transaction.update(root, { revision: nextRevision, trackedRevision: nextRevision, tableRevisions: nextTableRevisions });
            }
            return output;
          }, { maxAttempts: 5 });
          current?.close();
          current = candidate;
          revision = nextRevision;
          tableRevisions = nextTableRevisions;
          // Count committed writes, not buffered writes from failed attempts.
          // The root is updated exactly once for each nonempty diff.
          metrics.documentWrites += committedChanges.filter(change => change.row).length + (committedChanges.length ? 1 : 0);
          metrics.documentDeletes += committedChanges.filter(change => !change.row).length;
          return result;
        } catch (error) { metrics.failures++; candidate?.close(); throw error; }
        finally { metrics.durationMs += performance.now() - started; }
      });
      queue = pending.catch(() => {});
      return pending;
    },
  };
  // Load and initialize in a single transaction (PR #2).
  await db.run(() => { initializeDatabase(db); });
  return db;
}
