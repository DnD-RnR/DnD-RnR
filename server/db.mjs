import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import slots from '../shared/equipment-slots.json' with { type: 'json' };

const derive = promisify(scrypt);
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const actual = await hashPassword(password, stored.split(':')[0]);
  return timingSafeEqual(Buffer.from(actual), Buffer.from(stored));
}
export function openDatabase(path = process.env.DB_PATH || 'data/dnd.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'player', 'gm'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, class TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1
    );`);
  if (!db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql.includes("'gm'")) {
    db.exec(`PRAGMA foreign_keys = OFF; BEGIN;
      CREATE TABLE users_new (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin', 'player', 'gm')));
      INSERT INTO users_new SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT; PRAGMA foreign_keys = ON;`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY, gm_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS game_members (
    id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
    UNIQUE(game_id, character_id)
  );`);
  // Keep the earliest membership if an older database allowed multiple games.
  db.exec(`BEGIN IMMEDIATE;
    UPDATE game_members SET status = 'pending'
    WHERE status = 'accepted' AND id NOT IN (
      SELECT MIN(id) FROM game_members WHERE status = 'accepted' GROUP BY character_id
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_game_per_character
      ON game_members(character_id) WHERE status = 'accepted';
    COMMIT;`);
  const columns = new Set(db.prepare('PRAGMA table_info(characters)').all().map(column => column.name));
  for (const column of ['species', 'background', 'subclass']) {
    if (!columns.has(column)) db.exec(`ALTER TABLE characters ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS character_items (
    id INTEGER PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
    slot TEXT NOT NULL,
    equipped INTEGER NOT NULL DEFAULT 0 CHECK(equipped IN (0, 1))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_item_per_slot ON character_items(character_id, slot) WHERE equipped = 1;`);
  db.exec(`CREATE TABLE IF NOT EXISTS item_catalog (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
    slot TEXT NOT NULL CHECK(slot IN ('backpack', ${slots.map(slot => `'${slot.id}'`).join(', ')}))
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS character_statistics (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  );`);
  return db;
}
