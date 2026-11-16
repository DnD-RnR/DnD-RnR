import { writeFileSync } from 'node:fs';
import catalog from '../shared/spell-catalog.json' with { type: 'json' };
import index from '../shared/spell-index.json' with { type: 'json' };
import { spellEffects, spellAction } from '../shared/combat-spells.mjs';

const indexed = new Map(index.spells.map(s => [s.id, s]));
const ids = new Set(catalog.spells.map(s => s.id));
const missing = [...indexed.keys()].filter(id => !ids.has(id));
const extra = [...ids].filter(id => !indexed.has(id));
const invalid = catalog.spells.filter(s => !s.name || !s.description || !s.source || !s.components || !s.castingTime || !s.range || !s.duration || indexed.get(s.id)?.level !== s.level || /\$j\(|nitroAds|<script/i.test(s.description)).map(s => s.id);
const spells = catalog.spells.map(s => ({ id: s.id, name: s.name, level: s.level, source: s.source, url: s.url, combatAction: spellAction(s), resolution: spellEffects[s.id] ? 'engine-with-gm-confirmation' : s.id === 'hex' ? 'dedicated-handler' : 'gm', mode: spellEffects[s.id]?.mode ?? null, gmNote: spellEffects[s.id]?.gmNote ?? null }));
const report = { source: index.source, checkedAt: index.checkedAt, catalogCount: catalog.spells.length, indexCount: indexed.size, missing, extra, invalid, counts: { engine: spells.filter(s => s.resolution === 'engine-with-gm-confirmation').length, dedicated: spells.filter(s => s.resolution === 'dedicated-handler').length, gm: spells.filter(s => s.resolution === 'gm').length }, spells };
writeFileSync(new URL('../docs/spell-coverage.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, spells: undefined }, null, 2));
if (missing.length || extra.length || invalid.length || ids.size !== catalog.spells.length) process.exitCode = 1;
