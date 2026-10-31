import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { connectFirestore, firestoreLayout, tables, rowId, exportRows, hydrate, readRows, changesBetween } from '../server/firestore.mjs';
import { openDatabase } from '../server/db.mjs';

// Never merge databases implicitly: preserving numeric IDs is only safe when
// the destination is empty. A repeated run verifies the existing migration.
const firestore = connectFirestore();
const { root, collection } = firestoreLayout(firestore);
const sourcePath = resolve(process.env.DB_PATH || 'data/dnd.sqlite');
const stamp = new Date().toISOString().replaceAll(':', '-');
const backupDir = resolve('data/backups');
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `pre-firestore-${stamp}.sqlite`);
const source = new DatabaseSync(sourcePath, { readOnly: true });
try { await backup(source, backupPath); } finally { source.close(); }
// Run any pending schema upgrades on the backup, never on the source.
const local = openDatabase(backupPath);
let rows;
try { rows = exportRows(local); } finally { local.close(); }
const validation = hydrate(rows);
validation.close();
const counts = Object.fromEntries(tables.map(table => [table, rows[table].length]));
console.log('Project:', process.env.FIREBASE_PROJECT_ID, 'Database:', process.env.FIRESTORE_DATABASE_ID || '(default)');
console.log('Backup:', backupPath);
console.log('Rows:', counts);
await firestore.runTransaction(async transaction => {
  const meta = await transaction.get(root);
  const remote = await readRows(transaction, collection);
  if (meta.exists || tables.some(table => remote[table].length)) {
    if (!meta.exists || meta.get('schemaVersion') !== 1 || changesBetween(rows, remote).length) {
      throw new Error('Destination is not empty or differs from SQLite. Refusing to overwrite cloud data.');
    }
    console.log('Existing migration matches; nothing to overwrite.');
    return;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total > 450) throw new Error('Migration exceeds the safe single-transaction size (450 rows). No data was written.');
  for (const table of tables) for (const row of rows[table]) transaction.create(collection(table).doc(rowId(table, row)), row);
  transaction.create(root, { schemaVersion: 1, revision: 1, migratedAt: new Date().toISOString(), counts });
}, { maxAttempts: 1 });
const verified = await firestore.runTransaction(async transaction => {
  await transaction.get(root);
  return readRows(transaction, collection);
}, { readOnly: true });
if (changesBetween(rows, verified).length) throw new Error('Migration verification failed. Keep the local database.');
writeFileSync(join(backupDir, `firestore-migration-${stamp}.json`), JSON.stringify({
  projectId: process.env.FIREBASE_PROJECT_ID, databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
  sourcePath, backupPath, counts, verifiedAt: new Date().toISOString(),
}, null, 2));
console.log('Verified every row, including account password hashes and relationships. Local source was not modified.');
await firestore.terminate();
