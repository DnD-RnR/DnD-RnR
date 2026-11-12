import { createHash } from 'node:crypto';
import { handleGames } from './games.mjs';

export function createGameEvents(db) {
  const subscribers = new Set();
  let heartbeat;
  let publishing;
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
  function publishNow() {
    const updates = [];
    for (const client of subscribers) {
      if (!authorized(client)) { updates.push({ client }); continue; }
      const next = fingerprint(client);
      updates.push({ client, next });
    }
    return updates;
  }
  async function refresh() {
    try {
      const updates = db.run ? await db.run(publishNow) : publishNow();
      for (const { client, next } of updates) {
        if (!subscribers.has(client)) continue;
        if (next === undefined) { client.res.end(); continue; }
        if (next === client.fingerprint) continue;
        client.fingerprint = next;
        // Slow clients reconnect and fetch the latest snapshot instead of buffering events.
        if (!client.res.write('event: change\ndata: {}\n\n')) client.res.destroy();
      }
    } catch (error) {
      console.error('Could not refresh game events:', error.message);
      for (const client of subscribers) client.res.end();
    }
  }
  function publish() {
    if (!subscribers.size) return Promise.resolve();
    return publishing ||= refresh().finally(() => { publishing = undefined; });
  }
  function subscribe(req, res, client) {
    client.res = res;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    subscribers.add(client);
    heartbeat ||= setInterval(async () => {
      await publish();
      for (const { res } of subscribers) {
        if (!res.writableEnded && !res.destroyed && !res.write(': keep-alive\n\n')) res.destroy();
      }
    }, 20000);
    heartbeat.unref();
    const cleanup = () => {
      subscribers.delete(client);
      if (!subscribers.size) { clearInterval(heartbeat); heartbeat = undefined; }
    };
    res.on('close', cleanup);
    req.on('error', cleanup);
  }
  return { subscribe, publish, fingerprint };
}
