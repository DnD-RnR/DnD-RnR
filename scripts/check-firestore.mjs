import { connectFirestore, firestoreLayout, readRows, tables } from '../server/firestore.mjs';
const db = connectFirestore();
try {
  const { root, collection } = firestoreLayout(db);
  const meta = await root.get();
  console.log('Connected to project:', process.env.FIREBASE_PROJECT_ID);
  console.log('Migration present:', meta.exists);
  const rows = await db.runTransaction(transaction => readRows(transaction, collection), { readOnly: true });
  console.log('Cloud row counts:', Object.fromEntries(tables.map(table => [table, rows[table].length])));
} finally { await db.terminate(); }
