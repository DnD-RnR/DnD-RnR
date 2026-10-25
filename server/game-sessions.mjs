export function handleGameSessions(db, user, path, method, body, send) {
  const gmRoute = path.match(/^\/api\/games\/([1-9]\d*)\/sessions\/(start|end)$/);
  const kickRoute = path.match(/^\/api\/games\/([1-9]\d*)\/sessions\/([1-9]\d*)\/participants\/([1-9]\d*)\/kick$/);
  const characterRoute = path.match(/^\/api\/characters\/([1-9]\d*)\/session(?:\/(join|leave))?$/);
  if (!gmRoute && !characterRoute && !kickRoute) return false;
  const reply = (status, data) => { send(status, data); return true; };
  if (kickRoute) {
    if (method !== 'POST') return reply(405, { error: 'Niedozwolona metoda.' });
    const [, gameId, sessionId, memberId] = kickRoute.map(Number);
    if (user.role !== 'gm' || !db.prepare('SELECT id FROM games WHERE id = ? AND gm_id = ?').get(gameId, user.id)) return reply(404, { error: 'Nie znaleziono gry.' });
    if (!db.prepare('SELECT id FROM game_sessions WHERE id = ? AND game_id = ? AND ended_at IS NULL').get(sessionId, gameId)) return reply(409, { error: 'Ta sesja nie jest aktywna. Odśwież widok gry.' });
    const result = db.prepare(`DELETE FROM session_participants WHERE session_id = ? AND member_id = ?
      AND EXISTS (SELECT 1 FROM game_sessions s JOIN games g ON g.id = s.game_id
        JOIN game_members m ON m.game_id = g.id
        WHERE s.id = session_participants.session_id AND s.ended_at IS NULL
          AND g.id = ? AND g.gm_id = ? AND m.id = session_participants.member_id AND m.status = 'accepted')`).run(sessionId, memberId, gameId, user.id);
    return result.changes ? reply(200, { ok: true }) : reply(404, { error: 'Ta postać już nie uczestniczy w sesji.' });
  }
  if (gmRoute) {
    if (method !== 'POST') return reply(405, { error: 'Niedozwolona metoda.' });
    const game = db.prepare('SELECT id FROM games WHERE id = ? AND gm_id = ?').get(Number(gmRoute[1]), user.id);
    if (!game || user.role !== 'gm') return reply(404, { error: 'Nie znaleziono gry.' });
    if (gmRoute[2] === 'start') {
      const result = db.prepare(`INSERT INTO game_sessions (game_id, started_at)
        SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM game_sessions WHERE game_id = ? AND ended_at IS NULL)`).run(game.id, Date.now(), game.id);
      return result.changes ? reply(201, { sessionId: Number(result.lastInsertRowid) }) : reply(409, { error: 'Sesja tej gry już trwa.' });
    }
    if (!Number.isSafeInteger(body.sessionId) || body.sessionId < 1) return reply(400, { error: 'Wybierz sesję do zakończenia.' });
    const result = db.prepare('UPDATE game_sessions SET ended_at = ? WHERE id = ? AND game_id = ? AND ended_at IS NULL').run(Date.now(), body.sessionId, game.id);
    return result.changes ? reply(200, { ok: true }) : reply(409, { error: 'Ta sesja już się zakończyła lub nie należy do tej gry. Odśwież widok.' });
  }
  const character = db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(Number(characterRoute[1]), user.id);
  if (!character) return reply(404, { error: 'Nie znaleziono postaci.' });
  const membership = db.prepare(`SELECT m.id, g.id AS gameId, g.name AS gameName FROM game_members m JOIN games g ON g.id = m.game_id
    WHERE m.character_id = ? AND m.status = 'accepted'`).get(character.id);
  const activeSession = membership ? db.prepare(`SELECT s.id, s.started_at AS startedAt,
    EXISTS (SELECT 1 FROM session_participants p WHERE p.session_id = s.id AND p.member_id = ?) AS participating
    FROM game_sessions s WHERE s.game_id = ? AND s.ended_at IS NULL`).get(membership.id, membership.gameId) : null;
  if (!characterRoute[2] && method === 'GET') return reply(200, {
    game: membership ? { id: membership.gameId, name: membership.gameName } : null,
    activeSession: activeSession ? { ...activeSession, participating: Boolean(activeSession.participating) } : null,
  });
  if (method !== 'POST' || !characterRoute[2]) return reply(405, { error: 'Niedozwolona metoda.' });
  if (!Number.isSafeInteger(body.sessionId) || body.sessionId < 1) return reply(400, { error: 'Wybierz bieżącą sesję gry.' });
  if (!membership) return reply(409, { error: 'Postać nie należy do żadnej gry. Najpierw zaakceptuj zaproszenie.' });
  if (!activeSession || activeSession.id !== body.sessionId) return reply(409, { error: 'Ta sesja gry nie jest aktywna. Poczekaj na rozpoczęcie sesji przez GM lub odśwież widok.' });
  if (characterRoute[2] === 'leave') {
    db.prepare('DELETE FROM session_participants WHERE session_id = ? AND member_id = ?').run(activeSession.id, membership.id);
    return reply(200, { ok: true });
  }
  // Insert only while membership and the requested session are still active.
  db.prepare(`INSERT OR IGNORE INTO session_participants (session_id, member_id, joined_at)
    SELECT s.id, m.id, ? FROM game_sessions s JOIN game_members m ON m.game_id = s.game_id
    WHERE s.id = ? AND s.ended_at IS NULL AND m.id = ? AND m.status = 'accepted'`).run(Date.now(), activeSession.id, membership.id);
  return reply(200, { sessionId: activeSession.id });
}
