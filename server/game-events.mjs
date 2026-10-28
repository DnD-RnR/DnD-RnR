import { createHash } from 'node:crypto';
import { handleGames } from './games.mjs';

export function createGameEvents(db) {
  const subscribers = new Set();
  function authorized(client) {
    return db.prepare(`SELECT g.id FROM games g JOIN users u ON u.id = g.gm_id
      JOIN sessions s ON s.user_id = u.id WHERE g.id = ? AND u.id = ? AND u.role = 'gm'
      AND s.token = ? AND s.expires > ?`).get(client.gameId, client.userId, client.token, Date.now());
  }
  function fingerprint(client) {
    let snapshot;
    handleGames(db, { id: client.userId, role: 'gm' }, `/api/games/${client.gameId}`, 'GET', {}, (_status, data) => { snapshot = data; });
    const catalog = db.prepare('SELECT id, name, description, slot, weight, cost, armor_id, source_id FROM item_catalog ORDER BY name, id').all();
    return createHash('sha256').update(JSON.stringify({ snapshot, catalog })).digest('hex');
  }
  function publish() {
    for (const client of subscribers) {
      if (!authorized(client)) { client.res.end(); continue; }
      const next = fingerprint(client);
      if (next !== client.fingerprint) {
        client.fingerprint = next;
        // Slow clients reconnect and fetch the latest snapshot instead of buffering events.
        if (!client.res.write('event: change\ndata: {}\n\n')) client.res.destroy();
      }
    }
  }
  function subscribe(req, res, client) {
    client.res = res;
    client.fingerprint = fingerprint(client);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    subscribers.add(client);
    const heartbeat = setInterval(() => {
      if (!authorized(client)) { res.end(); return; }
      if (!res.write(': keep-alive\n\n')) res.destroy();
    }, 20000);
    heartbeat.unref();
    const cleanup = () => { clearInterval(heartbeat); subscribers.delete(client); };
    res.on('close', cleanup);
    req.on('error', cleanup);
  }
  return { subscribe, publish };
}
