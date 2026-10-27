import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import slots from '../shared/equipment-slots.json' with { type: 'json' };
import weapons from '../shared/weapon-catalog.json' with { type: 'json' };
import armors from '../shared/armor-catalog.json' with { type: 'json' };

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
  db.exec(`CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL, ended_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_game ON game_sessions(game_id) WHERE ended_at IS NULL;
  CREATE TABLE IF NOT EXISTS session_participants (
    session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES game_members(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, member_id)
  );`);
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
  const itemColumns = new Set(db.prepare('PRAGMA table_info(character_items)').all().map(column => column.name));
  if (!itemColumns.has('weapon_id')) db.exec('ALTER TABLE character_items ADD COLUMN weapon_id TEXT REFERENCES weapon_catalog(id)');
  if (!itemColumns.has('armor_id')) db.exec('ALTER TABLE character_items ADD COLUMN armor_id TEXT REFERENCES armor_catalog(id)');
  if (!itemColumns.has('grip')) db.exec("ALTER TABLE character_items ADD COLUMN grip TEXT NOT NULL DEFAULT 'one' CHECK(grip IN ('one', 'two'))");
  db.exec(`CREATE TABLE IF NOT EXISTS item_catalog (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
    slot TEXT NOT NULL CHECK(slot IN ('backpack', ${slots.map(slot => `'${slot.id}'`).join(', ')}))
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS weapon_catalog (
    id TEXT PRIMARY KEY CHECK(length(trim(id)) BETWEEN 1 AND 80),
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    category TEXT NOT NULL CHECK(category IN ('simple', 'martial')),
    damage TEXT NOT NULL CHECK(length(trim(damage)) BETWEEN 1 AND 40),
    damage_type TEXT NOT NULL CHECK(length(trim(damage_type)) BETWEEN 1 AND 40),
    type TEXT NOT NULL DEFAULT 'wręczna' CHECK(type IN ('wręczna', 'dystansowa')),
    range TEXT NOT NULL CHECK(length(trim(range)) BETWEEN 0 AND 80),
    weight REAL CHECK(weight IS NULL OR weight >= 0),
    cost TEXT NOT NULL CHECK(length(trim(cost)) BETWEEN 1 AND 40),
    properties TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(properties)),
    mastery TEXT NOT NULL DEFAULT '' CHECK(length(mastery) <= 40)
  );`);
  const weaponSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'weapon_catalog'").get()?.sql || '';
  if (weaponSchema.includes('length(trim(range)) BETWEEN 1 AND 80') || weaponSchema.includes("type IN ('melee', 'ranged')")) {
    db.exec(`PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE weapon_catalog_new (
        id TEXT PRIMARY KEY CHECK(length(trim(id)) BETWEEN 1 AND 80),
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
        category TEXT NOT NULL CHECK(category IN ('simple', 'martial')),
        damage TEXT NOT NULL CHECK(length(trim(damage)) BETWEEN 1 AND 40),
        damage_type TEXT NOT NULL CHECK(length(trim(damage_type)) BETWEEN 1 AND 40),
        type TEXT NOT NULL DEFAULT 'wręczna' CHECK(type IN ('wręczna', 'dystansowa')),
        range TEXT NOT NULL CHECK(length(trim(range)) BETWEEN 0 AND 80),
        weight REAL CHECK(weight IS NULL OR weight >= 0),
        cost TEXT NOT NULL CHECK(length(trim(cost)) BETWEEN 1 AND 40),
        properties TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(properties)),
        mastery TEXT NOT NULL DEFAULT '' CHECK(length(mastery) <= 40)
      );
      INSERT INTO weapon_catalog_new (id, name, category, type, damage, damage_type, range, weight, cost, properties, mastery)
        SELECT id, name, category,
          CASE type WHEN 'ranged' THEN 'dystansowa' ELSE 'wręczna' END,
          damage, damage_type, range, weight, cost, properties, mastery FROM weapon_catalog;
      DROP TABLE weapon_catalog;
      ALTER TABLE weapon_catalog_new RENAME TO weapon_catalog;
      COMMIT;
      PRAGMA foreign_keys = ON;`);
  }
  const weaponColumns = new Set(db.prepare('PRAGMA table_info(weapon_catalog)').all().map(column => column.name));
  if (!weaponColumns.has('type')) db.exec("ALTER TABLE weapon_catalog ADD COLUMN type TEXT NOT NULL DEFAULT 'wręczna' CHECK(type IN ('wręczna', 'dystansowa'))");
  if (!weaponColumns.has('mastery')) db.exec("ALTER TABLE weapon_catalog ADD COLUMN mastery TEXT NOT NULL DEFAULT '' CHECK(length(mastery) <= 40)");
  const addWeapon = db.prepare(`INSERT INTO weapon_catalog
    (id, name, category, type, damage, damage_type, range, weight, cost, properties, mastery)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category,
      type=excluded.type, damage=excluded.damage, damage_type=excluded.damage_type,
      range=excluded.range, weight=excluded.weight, cost=excluded.cost,
      properties=excluded.properties, mastery=excluded.mastery`);
  for (const weapon of weapons) {
    addWeapon.run(weapon.id, weapon.name, weapon.category, weapon.type, weapon.damage,
      weapon.damageType, weapon.range, weapon.weight, weapon.cost, JSON.stringify(weapon.properties), weapon.mastery);
  }
  const itemSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'character_items'").get()?.sql || '';
  if (itemSchema.includes("grip IN ('one', 'two')")) {
    db.exec(`PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE character_items_new (
        id INTEGER PRIMARY KEY,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
        slot TEXT NOT NULL,
        equipped INTEGER NOT NULL DEFAULT 0 CHECK(equipped IN (0, 1)),
        weapon_id TEXT REFERENCES weapon_catalog(id),
        armor_id TEXT REFERENCES armor_catalog(id),
        grip TEXT NOT NULL DEFAULT 'none' CHECK(grip IN ('one', 'two', 'none'))
      );
      INSERT INTO character_items_new (id, character_id, name, description, quantity, slot, equipped, weapon_id, armor_id, grip)
        SELECT id, character_id, name, description, quantity, slot, equipped, weapon_id, armor_id,
          CASE WHEN EXISTS (
            SELECT 1 FROM weapon_catalog w WHERE w.id = character_items.weapon_id AND w.type = 'dystansowa'
          ) THEN 'none' ELSE grip END
        FROM character_items;
      DROP TABLE character_items;
      ALTER TABLE character_items_new RENAME TO character_items;
      CREATE UNIQUE INDEX one_item_per_slot ON character_items(character_id, slot) WHERE equipped = 1;
      COMMIT;
      PRAGMA foreign_keys = ON;`);
  }
  db.prepare(`DELETE FROM weapon_catalog WHERE id NOT IN (${weapons.map(() => '?').join(', ')})`).run(...weapons.map(weapon => weapon.id));
  db.exec(`CREATE TABLE IF NOT EXISTS armor_catalog (
    id TEXT PRIMARY KEY CHECK(length(trim(id)) BETWEEN 1 AND 80),
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    category TEXT NOT NULL CHECK(category IN ('light', 'medium', 'heavy', 'shield')),
    armor_class TEXT NOT NULL CHECK(length(trim(armor_class)) BETWEEN 1 AND 80),
    strength INTEGER CHECK(strength IS NULL OR strength >= 1),
    stealth_disadvantage INTEGER NOT NULL CHECK(stealth_disadvantage IN (0, 1)),
    weight REAL CHECK(weight IS NULL OR weight >= 0),
    cost TEXT NOT NULL CHECK(length(trim(cost)) BETWEEN 1 AND 40),
    don_time INTEGER NOT NULL CHECK(don_time >= 0),
    doff_time INTEGER NOT NULL CHECK(doff_time >= 0)
  );`);
  const addArmor = db.prepare(`INSERT INTO armor_catalog
    (id, name, category, armor_class, strength, stealth_disadvantage, weight, cost, don_time, doff_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category,
      armor_class=excluded.armor_class, strength=excluded.strength,
      stealth_disadvantage=excluded.stealth_disadvantage, weight=excluded.weight,
      cost=excluded.cost, don_time=excluded.don_time, doff_time=excluded.doff_time`);
  for (const armor of armors) {
    addArmor.run(armor.id, armor.name, armor.category, armor.armorClass, armor.strength,
      armor.stealthDisadvantage ? 1 : 0, armor.weight, armor.cost, armor.donTime, armor.doffTime);
  }
  db.prepare(`DELETE FROM armor_catalog WHERE id NOT IN (${armors.map(() => '?').join(', ')})`).run(...armors.map(armor => armor.id));
  const catalogColumns = new Set(db.prepare('PRAGMA table_info(item_catalog)').all().map(column => column.name));
  if (!catalogColumns.has('armor_id')) db.exec('ALTER TABLE item_catalog ADD COLUMN armor_id TEXT REFERENCES armor_catalog(id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS one_catalog_entry_per_armor ON item_catalog(armor_id) WHERE armor_id IS NOT NULL');
  db.prepare(`UPDATE character_items SET weapon_id = (
    SELECT w.id FROM weapon_catalog w WHERE w.name = character_items.name
  ) WHERE weapon_id IS NULL`).run();
  db.exec(`CREATE TABLE IF NOT EXISTS character_statistics (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  );`);
  return db;
}
