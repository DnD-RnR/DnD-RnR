import slots from '../shared/equipment-slots.json' with { type: 'json' };

export function handleItems(db, user, path, method, body, send) {
  if (path !== '/api/items') return false;
  const reply = (status, data) => { send(status, data); return true; };
  if (method === 'GET') {
    if (!['admin', 'gm'].includes(user.role)) return reply(403, { error: 'Katalog jest dostępny dla administratora i GM.' });
    return reply(200, { items: db.prepare(`SELECT i.id, i.name, i.description, i.slot, i.weight, i.cost, i.armor_id AS armorId,
      a.category AS armorCategory FROM item_catalog i LEFT JOIN armor_catalog a ON a.id = i.armor_id
      ORDER BY i.name, i.id`).all() });
  }
  if (method === 'POST') {
    if (user.role !== 'admin') return reply(403, { error: 'Tylko administrator może dodawać przedmioty do katalogu.' });
    const { name, description = '', slot, weight = null, cost = '' } = body;
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || typeof description !== 'string' || description.length > 2000 ||
      (weight !== null && (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0)) ||
      typeof cost !== 'string' || cost.length > 40 || !['backpack', ...slots.map(s => s.id)].includes(slot)) {
      return reply(400, { error: 'Podaj nazwę, opis, poprawną wagę, wartość i wybierz slot z listy.' });
    }
    const result = db.prepare('INSERT INTO item_catalog (name, description, slot, weight, cost) VALUES (?, ?, ?, ?, ?)').run(name.trim(), description.trim(), slot, weight, cost.trim());
    return reply(201, { id: Number(result.lastInsertRowid) });
  }
  return reply(405, { error: 'Niedozwolona metoda.' });
}
