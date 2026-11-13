import { createHash } from 'node:crypto';
import { handleGames } from './games.mjs';

export function createGameEvents(db, { maxAgeMs = 45000, heartbeatMs = 15000 } = {}) {
  const subscribers = new Set();
  let heartbeat, stopWatch, publishing;
  let dirty = false;
  let sequence = 0;
  let observedRevision;
  function authorized(client) {
    const session = db.prepare(`SELECT u.id FROM users u JOIN sessions s ON s.user_id = u.id
      WHERE u.id = ? AND s.token = ? AND s.expires > ?`).get(client.userId, client.token, Date.now());
    if (!session) return false;
    return !client.gameId || db.prepare(`SELECT g.id FROM games g JOIN users u ON u.id = g.gm_id
      WHERE g.id = ? AND u.id = ? AND u.role = 'gm'`).get(client.gameId, client.userId);
  }
  function fingerprint(client) {
    if (!client.gameId) return db.watchChanges ? observedRevision : sequence;
    let snapshot;
    handleGames(db, { id: client.userId, role: 'gm' }, `/api/games/${client.gameId}`, 'GET', {}, (_status, data) => { snapshot = data; });
    const catalog = db.prepare('SELECT id, name, description, slot, weight, cost, armor_id, source_id FROM item_catalog ORDER BY name, id').all();
    return createHash('sha256').update(JSON.stringify({ snapshot, catalog })).digest('hex');
  }
  function fail(error) {
    console.error('Could not refresh game events:', error.message);
    for (const client of [...subscribers]) client.res.end();
  }
  function publish() {
    if (!subscribers.size) return Promise.resolve();
    dirty = true;
    // Same-turn signals coalesce; a commit arriving during a refresh must cause
    // another pass, so no invalidation is lost while a transaction is pending.
    return publishing ||= Promise.resolve().then(async () => {
      while (dirty && subscribers.size) {
        dirty = false;
        sequence++;
        const snapshot = () => [...subscribers].map(client => ({ client,
          next: authorized(client) ? fingerprint(client) : undefined }));
        const updates = db.run ? await db.run(snapshot) : snapshot();
        for (const { client, next } of updates) {
          if (!subscribers.has(client) || client.res.writableEnded || client.res.destroyed) continue;
          if (next === undefined) {
            if (!client.gameId) client.res.write('event: expired\ndata: {}\n\n');
            client.res.end();
          } else if (!client.ready || next !== client.fingerprint) {
            const event = client.ready ? 'change' : 'ready';
            client.ready = true;
            client.fingerprint = next;
            // Socket effects happen after commit, never in retryable work.
            if (!client.res.write(`event: ${event}\ndata: {}\n\n`)) client.res.destroy();
          }
        }
      }
    }).catch(fail).finally(() => {
      publishing = undefined;
      // A signal can also arrive between the drain returning and this finally.
      if (dirty && subscribers.size) void publish();
    });
  }
  function subscribe(req, res, client) {
    client.res = res;
    client.ready = Boolean(client.gameId); // Preserve the legacy GM protocol.
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    subscribers.add(client);
    const lifetime = setTimeout(() => res.end(), maxAgeMs);
    const expiry = client.expiresAt ? setTimeout(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write('event: expired\ndata: {}\n\n'); res.end();
    }, Math.max(0, Math.min(client.expiresAt - Date.now(), 2147483647))) : undefined;
    lifetime.unref(); expiry?.unref();
    const cleanup = () => {
      clearTimeout(lifetime); clearTimeout(expiry);
      subscribers.delete(client);
      if (!subscribers.size) {
        clearInterval(heartbeat); heartbeat = undefined;
        stopWatch?.(); stopWatch = undefined; observedRevision = undefined;
      }
    };
    res.once('close', cleanup);
    res.once('error', () => { res.destroy(); cleanup(); });
    req.once('error', () => { res.destroy(); cleanup(); });
    if (!heartbeat) {
      heartbeat = setInterval(() => {
        // Keep the socket open without any Firestore reads while idle.
        for (const client of [...subscribers]) {
          if (client.res.writableEnded || client.res.destroyed) continue;
          if (!client.res.write(': keep-alive\n\n')) client.res.destroy();
        }
      }, heartbeatMs);
      heartbeat.unref();
    }
    if (db.watchChanges && !stopWatch) {
      try {
        const stop = db.watchChanges(revision => { observedRevision = revision; void publish(); }, fail);
        if (subscribers.size) stopWatch = stop;
        else stop();
      }
      catch (error) { fail(error); }
    }
    // Revalidate after subscription, closing the initial-fetch/subscription gap.
    if (!db.watchChanges || observedRevision !== undefined) void publish();
  }
  return { subscribe, publish, fingerprint };
}
