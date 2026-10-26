import { handleGames } from './games.mjs';
import { createGameEvents } from './game-events.mjs';
import { handleGameSessions } from './game-sessions.mjs';
import { handleItems } from './items.mjs';
import { handleWeapons } from './weapons.mjs';
import { handleStatistics } from './statistics.mjs';
import options from '../shared/character-options.json' with { type: 'json' };
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase, hashPassword, verifyPassword } from './db.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
function characterError(body) {
  const { userId, name, characterClass, level, species, background, subclass } = body;
  const selectedClass = options.classes.find(entry => entry.name === characterClass);
  if (!Number.isSafeInteger(userId) || typeof name !== 'string' || !name.trim() || name.length > 80 || !Number.isInteger(level) || level < 1 || level > 20) return 'Wybierz gracza, podaj imię (do 80 znaków) i poziom 1–20.';
  if (!selectedClass || !options.species.includes(species) || !options.backgrounds.includes(background)) return 'Wybierz klasę, gatunek i pochodzenie z list D&D 2024.';
  if (level < 3 ? subclass !== '' : !selectedClass.subclasses.includes(subclass)) return 'Podklasa musi pasować do klasy i jest wybierana od 3. poziomu.';
  return null;
}
const publicUser = ({ id, username, name, role }) => ({ id, username, name, role });
export function createApp(db, origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173') {
  const attempts = new Map();
  const gameEvents = createGameEvents(db);
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));
  return createServer(async (req, res) => {
    res.once('finish', () => {
      if (req.method === 'POST' && res.statusCode >= 200 && res.statusCode < 300) gameEvents.publish();
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const cookie = (value, age) => res.setHeader('Set-Cookie', `session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Niedozwolona metoda.' });
      if (req.method === 'POST' && req.headers.origin !== origin) return send(403, { error: 'Niedozwolone źródło żądania.' });
      let body = {};
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Wymagany format JSON.' });
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65536) return send(413, { error: 'Za duże żądanie.' }); }
        try { body = JSON.parse(raw); } catch { return send(400, { error: 'Niepoprawne dane.' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Niepoprawne dane.' });
      }
      const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('session='))?.slice(8) || '';
      const user = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token = ? AND expires > ?').get(digest(token), Date.now());
      if (path === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
        const attempt = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
        if (attempt.count >= 10) return send(429, { error: 'Za dużo prób. Spróbuj ponownie za 15 minut.' });
        attempt.count++; attempts.set(ip, attempt);
        if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 128) return send(400, { error: 'Podaj login i hasło.' });
        const found = db.prepare('SELECT * FROM users WHERE username = ?').get(body.username.trim().toLowerCase());
        const valid = await verifyPassword(body.password, found?.password || await dummyHash);
        if (!found || !valid) return send(401, { error: 'Nieprawidłowy login lub hasło.' });
        db.prepare('DELETE FROM sessions WHERE token = ? OR expires <= ?').run(digest(token), now);
        const session = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(session), found.id, now + 8 * 60 * 60 * 1000);
        cookie(session, 8 * 60 * 60);
        return send(200, { user: publicUser(found) });
      }
      if (!user) return send(401, { error: 'Zaloguj się, aby kontynuować.' });
      if (handleWeapons(db, user, path, req.method, body, send)) return;
      const eventsRoute = path.match(/^\/api\/games\/([1-9]\d*)\/events$/);
      if (eventsRoute && req.method === 'GET') {
        const gameId = Number(eventsRoute[1]);
        if (user.role !== 'gm' || !db.prepare('SELECT id FROM games WHERE id = ? AND gm_id = ?').get(gameId, user.id)) return send(404, { error: 'Nie znaleziono gry.' });
        gameEvents.subscribe(req, res, { gameId, userId: user.id, token: digest(token) });
        return;
      }
      if (path === '/api/me' && req.method === 'GET') return send(200, { user: publicUser(user) });
      if (path === '/api/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(digest(token)); cookie('', 0); return send(200, { ok: true });
      }
      if (handleGameSessions(db, user, path, req.method, body, send)) return;
      if (handleGames(db, user, path, req.method, body, send)) return;
      if (handleItems(db, user, path, req.method, body, send)) return;
      if (handleStatistics(db, user, path, req.method, body, send)) return;
      if (path === '/api/characters' && req.method === 'POST') {
        if (!['player', 'gm'].includes(user.role)) return send(403, { error: 'Administrator tworzy postacie w panelu administracji.' });
        if (body.userId !== undefined && body.userId !== user.id) return send(403, { error: 'Możesz tworzyć postacie tylko na swoim koncie.' });
        if (user.role === 'player' && body.level !== 1) return send(400, { error: 'Gracz może utworzyć postać tylko na poziomie 1.' });
        const character = { ...body, userId: user.id };
        const validationError = characterError(character);
        if (validationError) return send(400, { error: validationError });
        const { name, characterClass, level, species, background, subclass } = character;
        const result = db.prepare('INSERT INTO characters (user_id, name, class, level, species, background, subclass) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, name.trim(), characterClass, level, species, background, subclass);
        return send(201, { id: Number(result.lastInsertRowid) });
      }
      if (path === '/api/characters' && req.method === 'GET') return send(200, { characters: db.prepare(`
        SELECT c.id, c.name, c.class, c.level, c.species, c.background, c.subclass, g.name AS gameName,
          s.id AS activeSessionId, CASE WHEN p.member_id IS NOT NULL THEN 1 ELSE 0 END AS participating
        FROM characters c
        LEFT JOIN game_members m ON m.character_id = c.id AND m.status = 'accepted'
        LEFT JOIN games g ON g.id = m.game_id
        LEFT JOIN game_sessions s ON s.game_id = g.id AND s.ended_at IS NULL
        LEFT JOIN session_participants p ON p.session_id = s.id AND p.member_id = m.id
        WHERE c.user_id = ?`).all(user.id) });
      const recipientsRoute = path.match(/^\/api\/characters\/([1-9]\d*)\/recipients$/);
      if (recipientsRoute && req.method === 'GET') {
        const characterId = Number(recipientsRoute[1]);
        if (!db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(characterId, user.id)) return send(404, { error: 'Nie znaleziono postaci.' });
        return send(200, { characters: db.prepare('SELECT id, name FROM characters WHERE id != ? ORDER BY name, id').all(characterId) });
      }
      const inventoryRoute = path.match(/^\/api\/characters\/([1-9]\d*)\/inventory(?:\/([1-9]\d*)\/(equip|unequip|delete|transfer))?$/);
      if (inventoryRoute) {
        const [, rawCharacterId, rawItemId, action] = inventoryRoute;
        const characterId = Number(rawCharacterId);
        if (!db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(characterId, user.id)) return send(404, { error: 'Nie znaleziono postaci.' });
        if (!action && req.method === 'GET') {
          const items = db.prepare(`SELECT i.id, i.name, i.description, i.quantity, i.slot, i.equipped, i.grip,
            w.id AS weaponId, w.type AS weaponType, w.damage AS weaponDamage, w.damage_type AS weaponDamageType,
            w.range AS weaponRange, w.properties AS weaponProperties, w.mastery AS weaponMastery
            FROM character_items i LEFT JOIN weapon_catalog w ON w.id = i.weapon_id
            WHERE i.character_id = ? ORDER BY i.id DESC`).all(characterId);
          return send(200, { items: items.map(item => ({
            id: item.id, name: item.name, description: item.description, quantity: item.quantity,
            slot: item.slot, equipped: item.equipped,
            ...(item.weaponId ? { grip: item.grip, weapon: {
              id: item.weaponId, type: item.weaponType, damage: item.weaponDamage,
              damageType: item.weaponDamageType, range: item.weaponRange,
              properties: JSON.parse(item.weaponProperties), mastery: item.weaponMastery,
            } } : {}),
          })) });
        }
        if (action && req.method === 'POST') {
          const itemId = Number(rawItemId);
          const item = db.prepare(`SELECT i.id, i.slot, i.weapon_id AS weaponId, i.grip,
            w.properties AS weaponProperties FROM character_items i
            LEFT JOIN weapon_catalog w ON w.id = i.weapon_id
            WHERE i.id = ? AND i.character_id = ?`).get(itemId, characterId);
          if (!item) return send(404, { error: 'Nie znaleziono przedmiotu.' });
          if (action === 'transfer') {
            const { recipientId, quantity } = body;
            if (!Number.isSafeInteger(recipientId) || recipientId === characterId || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return send(400, { error: 'Wybierz inną postać i poprawną liczbę sztuk.' });
            db.exec('BEGIN IMMEDIATE');
            try {
              const source = db.prepare('SELECT * FROM character_items WHERE id = ? AND character_id = ?').get(itemId, characterId);
              if (!source || source.equipped || quantity > source.quantity) {
                db.exec('ROLLBACK');
                return send(409, { error: 'Przedmiot musi być w plecaku i mieć wystarczającą liczbę sztuk. Odśwież ekwipunek.' });
              }
              if (!db.prepare('SELECT id FROM characters WHERE id = ?').get(recipientId)) {
                db.exec('ROLLBACK');
                return send(404, { error: 'Postać odbiorcy już nie istnieje.' });
              }
              if (quantity === source.quantity) {
                db.prepare('UPDATE character_items SET character_id = ? WHERE id = ?').run(recipientId, itemId);
              } else {
                db.prepare('UPDATE character_items SET quantity = quantity - ? WHERE id = ?').run(quantity, itemId);
                db.prepare('INSERT INTO character_items (character_id, name, description, quantity, slot, equipped, weapon_id, grip) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').run(recipientId, source.name, source.description, quantity, source.slot, source.weapon_id, source.grip);
              }
              db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
          }
          if (action === 'delete') db.prepare('DELETE FROM character_items WHERE id = ? AND character_id = ?').run(itemId, characterId);
          if (action === 'unequip') db.prepare('UPDATE character_items SET equipped = 0 WHERE id = ? AND character_id = ?').run(itemId, characterId);
          if (action === 'equip') {
            const isWeapon = Boolean(item.weaponId);
            if (isWeapon) {
              const weapon = db.prepare('SELECT type, properties FROM weapon_catalog WHERE id = ?').get(item.weaponId);
              const grip = body.grip === 'two' ? 'two' : 'one';
              const properties = weapon;
              const weaponProperties = JSON.parse(properties.properties);
              const requiresTwoHands = weaponProperties.some(property => property.startsWith('dwuręczna'));
              const isRanged = weapon.type === 'dystansowa';
              if (!isRanged && requiresTwoHands && grip !== 'two') return send(400, { error: 'Ta broń wymaga dwóch rąk.' });
              if (!isRanged && grip === 'two' && !requiresTwoHands && !weaponProperties.some(property => property.startsWith('wszechstronna'))) return send(400, { error: 'Ta broń nie może być trzymana w dwóch rękach.' });
              db.exec('BEGIN');
              try {
                const targetSlot = isRanged ? 'belt' : 'main-hand';
                const targetGrip = isRanged ? 'none' : requiresTwoHands ? 'two' : grip;
                db.prepare("UPDATE character_items SET equipped = 0, slot = 'backpack' WHERE character_id = ? AND slot = ?").run(characterId, targetSlot);
                if (!isRanged && targetGrip === 'two') {
                  db.prepare("UPDATE character_items SET equipped = 0, slot = 'backpack' WHERE character_id = ? AND slot = 'off-hand'").run(characterId);
                }
                db.prepare("UPDATE character_items SET equipped = 1, slot = ?, grip = ? WHERE id = ? AND character_id = ?").run(targetSlot, targetGrip, itemId, characterId);
                db.exec('COMMIT');
              } catch (error) { db.exec('ROLLBACK'); throw error; }
              return send(200, { ok: true });
            }
            if (item.slot === 'backpack') return send(400, { error: 'Ten przedmiot jest przeznaczony do plecaka.' });
            db.exec('BEGIN');
            try {
              db.prepare('UPDATE character_items SET equipped = 0 WHERE character_id = ? AND slot = ?').run(characterId, item.slot);
              db.prepare('UPDATE character_items SET equipped = 1 WHERE id = ? AND character_id = ?').run(itemId, characterId);
              db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
          }
          return send(200, { ok: true });
        }
        return send(405, { error: 'Niedozwolona metoda.' });
      }
      if (path.startsWith('/api/admin/')) {
        if (user.role !== 'admin') return send(403, { error: 'Dostęp tylko dla administratora.' });
        const target = path.match(/^\/api\/admin\/(players|characters)\/([1-9]\d*)\/(update|delete)$/);
        if (target && req.method === 'POST') {
          const [, kind, rawId, action] = target;
          const id = Number(rawId);
          if (!Number.isSafeInteger(id)) return send(400, { error: 'Niepoprawny identyfikator.' });
          const record = kind === 'players'
            ? db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('player', 'gm')").get(id)
            : db.prepare('SELECT id FROM characters WHERE id = ?').get(id);
          if (!record) return send(404, { error: 'Nie znaleziono zasobu.' });
          if (action === 'delete') {
            if (kind === 'players') {
              db.exec('BEGIN');
              try {
                db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
                db.prepare('DELETE FROM characters WHERE user_id = ?').run(id);
                db.prepare('DELETE FROM users WHERE id = ?').run(id);
                db.exec('COMMIT');
              } catch (error) { db.exec('ROLLBACK'); throw error; }
            } else db.prepare('DELETE FROM characters WHERE id = ?').run(id);
            return send(200, { ok: true });
          }
          if (kind === 'players') {
            const { username, name, password } = body;
            if (typeof username !== 'string' || !/^[a-z0-9._-]{3,40}$/.test(username) || typeof name !== 'string' || !name.trim() || name.length > 80 || (password !== undefined && (typeof password !== 'string' || (password !== '' && (password.length < 6 || password.length > 128))))) return send(400, { error: 'Podaj poprawny login, imię (do 80 znaków) i opcjonalne hasło (6–128 znaków).' });
            const hashed = password ? await hashPassword(password) : null;
            try {
              db.exec('BEGIN');
              db.prepare('UPDATE users SET username = ?, name = ?, password = COALESCE(?, password) WHERE id = ?').run(username, name.trim(), hashed, id);
              if (hashed) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
              db.exec('COMMIT');
            } catch (error) {
              db.exec('ROLLBACK');
              if (error.errcode === 2067 || String(error.code).includes('CONSTRAINT')) return send(409, { error: 'Ten login jest już zajęty.' });
              throw error;
            }
          } else {
            const { userId, name, characterClass, level, species, background, subclass } = body;
            const validationError = characterError(body);
            if (validationError) return send(400, { error: validationError });
            if (!db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('player', 'gm')").get(userId)) return send(400, { error: 'Nie znaleziono gracza.' });
            db.prepare('DELETE FROM game_members WHERE character_id = ? AND EXISTS (SELECT 1 FROM characters WHERE id = ? AND user_id != ?)').run(id, id, userId);
            db.prepare('UPDATE characters SET user_id = ?, name = ?, class = ?, level = ?, species = ?, background = ?, subclass = ? WHERE id = ?').run(userId, name.trim(), characterClass, level, species, background, subclass, id);
          }
          return send(200, { ok: true });
        }
        if (path === '/api/admin/characters' && req.method === 'GET') return send(200, { characters: db.prepare('SELECT id, user_id AS userId, name, class, level, species, background, subclass FROM characters ORDER BY id DESC').all() });
        if (path === '/api/admin/gms' && req.method === 'GET') return send(200, { players: db.prepare("SELECT id, username, name, role FROM users WHERE role = 'gm' ORDER BY id DESC").all() });
        if (path === '/api/admin/players' && req.method === 'GET') return send(200, { players: db.prepare("SELECT id, username, name, role FROM users WHERE role = 'player' ORDER BY id DESC").all() });
        if (path === '/api/admin/players' && req.method === 'POST') {
          const { username, name, password, role = 'player' } = body;
          if (!['player', 'gm'].includes(role)) return send(400, { error: 'Wybierz konto gracza lub GM.' });
          if (typeof username !== 'string' || !/^[a-z0-9._-]{3,40}$/.test(username) || typeof name !== 'string' || !name.trim() || name.length > 80 || typeof password !== 'string' || password.length < 6 || password.length > 128) return send(400, { error: 'Login: 3–40 znaków a-z, 0-9, . _ -. Imię: 1–80 znaków. Hasło: 6–128 znaków.' });
          if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return send(409, { error: 'Ten login jest już zajęty.' });
          const hashed = await hashPassword(password);
          try {
            const result = db.prepare("INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, ?)").run(username, name.trim(), hashed, role);
            return send(201, { user: { id: Number(result.lastInsertRowid), username, name: name.trim(), role } });
          } catch (error) { if (String(error.code).includes('CONSTRAINT')) return send(409, { error: 'Ten login jest już zajęty.' }); throw error; }
        }
        if (path === '/api/admin/characters' && req.method === 'POST') {
          const { userId, name, characterClass, level, species, background, subclass } = body;
            const validationError = characterError(body);
            if (validationError) return send(400, { error: validationError });
          if (!db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('player', 'gm')").get(userId)) return send(400, { error: 'Nie znaleziono gracza.' });
          db.prepare('INSERT INTO characters (user_id, name, class, level, species, background, subclass) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, name.trim(), characterClass, level, species, background, subclass);
          return send(201, { ok: true });
        }
      }
      send(404, { error: 'Nie znaleziono zasobu.' });
    } catch (error) { console.error(error); if (!res.headersSent) send(500, { error: 'Błąd serwera. Spróbuj ponownie.' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase();
  createApp(db).listen(Number(process.env.PORT || 3001), '127.0.0.1', () => console.log('API: http://127.0.0.1:' + (process.env.PORT || 3001)));
}
