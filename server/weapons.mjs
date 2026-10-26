export function handleWeapons(db, user, path, method, _body, send) {
  if (path !== '/api/weapons') return false;
  if (method !== 'GET') {
    send(405, { error: 'Niedozwolona metoda.' });
    return true;
  }
  if (!user) {
    send(401, { error: 'Zaloguj się, aby kontynuować.' });
    return true;
  }
  send(200, {
    weapons: db.prepare(`SELECT id, name, category, type, damage, damage_type AS damageType,
      range, weight, cost, properties, mastery FROM weapon_catalog ORDER BY category, type, name, id`).all()
      .map(weapon => ({ ...weapon, properties: JSON.parse(weapon.properties) })),
  });
  return true;
}
