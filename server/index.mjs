import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase, hashPassword, verifyPassword } from './db.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const publicUser = ({ id, username, name, role }) => ({ id, username, name, role });
export function createApp(db, origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173') {
  const attempts = new Map();
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));
  return createServer(async (req, res) => {
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
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) return send(413, { error: 'Za duże żądanie.' }); }
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
      if (path === '/api/me' && req.method === 'GET') return send(200, { user: publicUser(user) });
      if (path === '/api/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(digest(token)); cookie('', 0); return send(200, { ok: true });
      }
      if (path === '/api/characters' && req.method === 'GET') return send(200, { characters: db.prepare('SELECT id, name, class, level FROM characters WHERE user_id = ?').all(user.id) });
      if (path.startsWith('/api/admin/')) {
        if (user.role !== 'admin') return send(403, { error: 'Dostęp tylko dla administratora.' });
        if (path === '/api/admin/players' && req.method === 'GET') return send(200, { players: db.prepare("SELECT id, username, name, role FROM users WHERE role = 'player' ORDER BY id DESC").all() });
        if (path === '/api/admin/players' && req.method === 'POST') {
          const { username, name, password } = body;
          if (typeof username !== 'string' || !/^[a-z0-9._-]{3,40}$/.test(username) || typeof name !== 'string' || !name.trim() || name.length > 80 || typeof password !== 'string' || password.length < 12 || password.length > 128) return send(400, { error: 'Login: 3–40 znaków a-z, 0-9, . _ -. Imię: 1–80 znaków. Hasło: 12–128 znaków.' });
          if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return send(409, { error: 'Ten login jest już zajęty.' });
          const hashed = await hashPassword(password);
          try {
            const result = db.prepare("INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, 'player')").run(username, name.trim(), hashed);
            return send(201, { user: { id: Number(result.lastInsertRowid), username, name: name.trim(), role: 'player' } });
          } catch (error) { if (String(error.code).includes('CONSTRAINT')) return send(409, { error: 'Ten login jest już zajęty.' }); throw error; }
        }
        if (path === '/api/admin/characters' && req.method === 'POST') {
          const { userId, name, characterClass } = body;
          if (!Number.isSafeInteger(userId) || typeof name !== 'string' || !name.trim() || name.length > 80 || typeof characterClass !== 'string' || !characterClass.trim() || characterClass.length > 80) return send(400, { error: 'Wybierz gracza, podaj imię i klasę postaci (do 80 znaków).' });
          if (!db.prepare("SELECT id FROM users WHERE id = ? AND role = 'player'").get(userId)) return send(400, { error: 'Nie znaleziono gracza.' });
          db.prepare('INSERT INTO characters (user_id, name, class) VALUES (?, ?, ?)').run(userId, name.trim(), characterClass.trim());
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
