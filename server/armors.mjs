export function handleArmors(db, user, path, method, _body, send) {
  if (path !== '/api/armors') return false;
  if (method !== 'GET') {
    send(405, { error: 'Niedozwolona metoda.' });
    return true;
  }
  if (!user) {
    send(401, { error: 'Zaloguj się, aby kontynuować.' });
    return true;
  }
  send(200, {
    armors: db.prepare(`SELECT id, name, category, armor_class AS armorClass,
      strength, stealth_disadvantage AS stealthDisadvantage, weight, cost,
      don_time AS donTime, doff_time AS doffTime
      FROM armor_catalog ORDER BY CASE category
        WHEN 'light' THEN 1 WHEN 'medium' THEN 2 WHEN 'heavy' THEN 3 ELSE 4 END, name, id`).all()
      .map(armor => ({ ...armor, stealthDisadvantage: Boolean(armor.stealthDisadvantage) })),
  });
  return true;
}
