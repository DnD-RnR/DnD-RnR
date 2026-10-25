import { createInterface } from 'node:readline/promises';
import { openDatabase, hashPassword } from './db.mjs';

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
  db = openDatabase();
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new Error('Ten login już istnieje.');
  db.prepare('INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, ?)').run(username, name, await hashPassword(password), 'admin');
  console.log('Utworzono administratora.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { rl.close(); db?.close(); }
