// One roll per spell, shared by all simultaneous targets. Keep damage types
// separate through saving throws and defenses, then apply one damage event.
export function spellDamageDice(spec, critical = false) {
  return (spec.components ?? [spec]).flatMap(c => Array.from({ length: c.dice * (critical ? 2 : 1) }, () => ({ sides: c.sides, type: c.type })));
}

export function spellDamageParts(spec, rolls, reduction = 0) {
  let offset = 0;
  const parts = [];
  for (const c of spec.components ?? [spec]) {
    const amount = rolls.slice(offset, offset + c.dice).reduce((sum, n) => sum + n, 0);
    offset += c.dice;
    const existing = parts.find(p => p.type === c.type);
    if (existing) existing.amount += amount;
    else parts.push({ type: c.type, amount });
  }
  parts[0].amount += spec.bonus ?? 0;
  // Flat reductions apply once to the damage event, in component order.
  for (const part of parts) {
    const removed = Math.min(part.amount, reduction);
    part.amount -= removed; reduction -= removed;
  }
  return parts;
}

export function defendSpellDamage(parts, saved, half, defenses, reduction = 0) {
  return parts.map(part => {
    let amount = saved ? half ? Math.floor(part.amount / 2) : 0 : part.amount;
    const removed = Math.min(amount, reduction);
    amount -= removed; reduction -= removed;
    const defense = defenses[part.type] ?? {};
    if (defense.immune) amount = 0;
    else {
      if (defense.resistant) amount = Math.floor(amount / 2);
      if (defense.vulnerable) amount *= 2;
    }
    return { ...part, amount };
  });
}
