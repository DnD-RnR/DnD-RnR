export function handleOriginFeats(db, user, path, method, _body, send) {
  if (path !== '/api/origin-feats') return false;
  if (!user) { send(401, { error: 'Zaloguj się, aby kontynuować.' }); return true; }
  if (method !== 'GET') { send(405, { error: 'Niedozwolona metoda.' }); return true; }
  send(200, { feats: db.prepare('SELECT data FROM origin_feat_catalog ORDER BY name').all().map(row => JSON.parse(row.data)) });
  return true;
}
