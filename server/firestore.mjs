import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { openDatabase, initializeDatabase } from './db.mjs';

// Firestore is the only persistent store. SQLite provides relational queries and
// constraints in RAM; it never opens the former local database in this runtime.
export const tables = ['users', 'sessions', 'characters', 'games', 'game_members',
  'game_sessions', 'session_participants', 'weapon_catalog', 'armor_catalog',
  'item_catalog', 'character_items', 'character_statistics', 'game_monsters', 'game_monster_entries', 'session_battles', 'character_spell_resources'];
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
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const firestore = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || '(default)');
  firestore.settings({ preferRest: true });
  return firestore;
}
export function firestoreLayout(firestore) {
  const root = firestore.collection('dnd_rnr').doc('main');
  return { root, collection: table => root.collection(table) };
}
export async function readRows(reader, collection) {
  const snapshots = await Promise.all(tables.map(table => reader.get(collection(table))));
  return Object.fromEntries(tables.map((table, i) => [table, snapshots[i].docs.map(doc => doc.data())]));
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
  let queue = Promise.resolve();
  const db = {
    prepare(sql) { if (!current) throw new Error('Firestore database is not loaded'); return current.prepare(sql); },
    exec(sql) { return current.exec(sql); },
    close() { current?.close(); },
    async run(work) {
      const pending = queue.then(async () => {
        let candidate;
        let nextRevision;
        try {
          const result = await firestore.runTransaction(async transaction => {
            // A previous attempt can have been aborted by Firestore contention.
            candidate?.close();
            candidate = undefined;
            const meta = await transaction.get(root);
            if (!meta.exists || meta.get('schemaVersion') !== 1) throw new Error('Firestore has not been migrated. Run npm run db:migrate first.');
            const version = meta.get('revision');
            const before = current && version === revision ? exportRows(current) : await readRows(transaction, collection);
            candidate = hydrate(before);
            const saved = current;
            current = candidate;
            let output;
            try { output = await work(); } finally { current = saved; }
            const after = exportRows(candidate);
            const changes = changesBetween(before, after);
            // Stay below Firestore's request limits and fail atomically.
            if (changes.length > 450) throw new Error('Too many database changes in one request (maximum 450).');
            for (const { table, id, row } of changes) {
              if (row) transaction.set(collection(table).doc(id), row);
              else transaction.delete(collection(table).doc(id));
            }
            nextRevision = changes.length ? version + 1 : version;
            if (changes.length) transaction.update(root, { revision: nextRevision });
            return output;
          }, { maxAttempts: 5 });
          current?.close();
          current = candidate;
          revision = nextRevision;
          return result;
        } catch (error) { candidate?.close(); throw error; }
      });
      queue = pending.catch(() => {});
      return pending;
    },
  };
  await db.run(() => {});
  await db.run(() => { initializeDatabase(db); });
  return db;
}
