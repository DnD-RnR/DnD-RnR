import { createInterface } from 'node:readline/promises';
import { hashPassword } from './db.mjs';
import { openFirestoreDatabase } from './firestore.mjs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
let db;
try {
  const username = (await rl.question('Login administratora: ')).trim().toLowerCase();
  const name = (await rl.question('Imię: ')).trim();
  console.log('Hasło podaj w zmiennej ADMIN_PASSWORD (nie zostanie wyświetlone).');
  const password = process.env.ADMIN_PASSWORD;
  if (!/^[a-z0-9._-]{3,40}$/.test(username) || !name || name.length > 80 || !password || password.length < 12 || password.length > 128) {
    throw new Error('Login: 3–40 znaków a-z, 0-9, . _ -. Imię: 1–80 znaków. ADMIN_PASSWORD: 12–128 znaków.');
  }
  db = await openFirestoreDatabase();
  const hashed = await hashPassword(password);
  await db.run(() => {
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new Error('Ten login już istnieje.');
    db.prepare('INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, ?)').run(username, name, hashed, 'admin');
  });
  console.log('Utworzono administratora.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { rl.close(); db?.close(); }
