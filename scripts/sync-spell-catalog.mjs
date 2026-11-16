// Refresh the entire public index; never replace data with an incomplete download.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const origin = 'https://dnd2024.wikidot.com';
export const clean = html => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/[ \t\r\n]+/g, ' ').trim();

export function parseIndex(html) {
  const spells = new Map();
  for (const section of html.split(/<div id="wiki-tab-0-/).slice(1)) {
    const level = Number(section.match(/^(\d+)"/)?.[1]);
    if (!Number.isInteger(level) || level > 9) throw new Error('Unexpected spell index structure');
    for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const link = row[1].match(/href="\/spell:([^"#]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
      if (!link || cells.length !== 7) continue;
      const id = link[1];
      if (spells.has(id)) throw new Error(`Duplicate spell in index: ${id}`);
      spells.set(id, { id, name: clean(link[2]), level, school: cells[1], classes: cells[2].toLowerCase().split(',').map(s => s.trim()), castingTime: cells[3].replace(/\s*\(\*\)/g, ''), range: cells[4], components: cells[5], duration: cells[6], url: `${origin}/spell:${id}` });
    }
  }
  if (spells.size < 380 || new Set([...spells.values()].map(s => s.level)).size !== 10) throw new Error(`Incomplete spell index: ${spells.size}`);
  return spells;
}

export function parseSpell(html) {
  const safeHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const content = safeHtml.split(/<div id="page-content">/)[1];
  if (!content) throw new Error('Missing spell content');
  let depth = 1, end = -1;
  for (const tag of content.matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) { end = tag.index; break; }
  }
  if (end < 0) throw new Error('Unclosed spell content');
  const main = content.slice(0, end);
  const paragraphs = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const duration = paragraphs.find(p => /<strong>Duration:?<\/strong>/i.test(p[1]));
  if (!duration) throw new Error('Missing spell Duration');
  const metadata = label => clean(main.match(new RegExp(`<strong>${label}:?<\\/strong>\\s*([\\s\\S]*?)(?:<br\\s*\\/?>|<\\/p>)`, 'i'))?.[1] ?? '');
  let body = main.slice(duration.index + duration[0].length);
  const upgradePattern = /<p\b[^>]*>\s*<strong>(?:Using a Higher-Level Spell Slot|Cantrip Upgrade|At Higher Levels)[^<]*<\/strong>[\s\S]*?<\/p>/i;
  const upgradeHtml = body.match(upgradePattern)?.[0] ?? '';
  body = body.replace(upgradePattern, '');
  const description = body.split(/<\/p>|<\/tr>|<\/li>|<\/h[1-6]>/i).map(clean).filter(Boolean).join('\n\n');
  if (!description) throw new Error('Missing spell description');
  return { source: clean(main.match(/<p>\s*Source:([\s\S]*?)<\/p>/i)?.[1] ?? ''), castingTime: metadata('Casting Time'), range: metadata('Range'), components: metadata('Components?'), duration: metadata('Duration'), description, upgrade: clean(upgradeHtml).replace(/^(?:Using a Higher-Level Spell Slot|Cantrip Upgrade|At Higher Levels)\.?\s*/i, '') };
}

async function main() {
  const catalogPath = new URL('../shared/spell-catalog.json', import.meta.url);
  const cache = new URL('../.local-preview/spell-sources/', import.meta.url);
  mkdirSync(cache, { recursive: true });
  async function page(path, fresh = false) {
    const file = new URL(`${path.replaceAll(':', '-')}${fresh ? '.current' : ''}.html`, cache);
    if ((!fresh || process.argv.includes('--offline')) && existsSync(file)) return readFileSync(file, 'utf8');
    const legacy = new URL(`${path.replaceAll(':', '-')}.html`, cache);
    if (process.argv.includes('--offline') && existsSync(legacy)) return readFileSync(legacy, 'utf8');
    if (process.argv.includes('--offline')) throw new Error(`Missing cached page: ${path}`);
    const response = await fetch(`${origin}/${path}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const html = await response.text();
    if (!html.includes('id="page-content"')) throw new Error(`${path}: missing content`);
    writeFileSync(file, html);
    return html;
  }
  const indexed = parseIndex(await page('spell:all', true));
  const old = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const byId = new Map(old.spells.map(s => [s.id, s]));
  const missing = [...indexed.keys()].filter(id => !byId.has(id));
  const extra = [...byId.keys()].filter(id => !indexed.has(id));
  const mismatches = [...indexed.values()].flatMap(spell => {
    const previous = byId.get(spell.id);
    return previous && previous.level !== spell.level ? [{ id: spell.id, catalogLevel: previous.level, indexLevel: spell.level }] : [];
  });
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ indexed: indexed.size, catalog: old.spells.length, missing, extra, mismatches }, null, 2));
    if (missing.length || extra.length || mismatches.length) process.exitCode = 1;
    return;
  }
  let next = 0;
  const entries = [...indexed.values()];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < entries.length) {
      const spell = entries[next++];
      const existing = byId.get(spell.id);
      // Preserve established translations; enrich every record with index metadata.
      if (!existing || process.argv.includes('--refresh-descriptions')) {
        const details = parseSpell(await page(`spell:${spell.id}`, process.argv.includes('--refresh-descriptions')));
        Object.assign(spell, details, { duration: details.duration.replace(/Concentration/gi, 'Koncentracja') });
      } else Object.assign(spell, existing, { school: spell.school, components: spell.components });
      byId.set(spell.id, spell);
    }
  }));
  const spells = entries.map(s => byId.get(s.id)).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const checkedAt = new Date().toISOString();
  writeFileSync(catalogPath, JSON.stringify({ source: origin, edition: 'All spells listed at spell:all (PHB 2024 and supplements)', checkedAt, spells }, null, 2) + '\n');
  writeFileSync(new URL('../shared/spell-index.json', import.meta.url), JSON.stringify({ source: `${origin}/spell:all`, checkedAt, spells: [...indexed.values()].map(({ id, name, level, url }) => ({ id, name, level, url })) }, null, 2) + '\n');
  console.log(JSON.stringify({ indexed: indexed.size, catalog: spells.length, added: missing.length, extraRemoved: extra.length, levelMismatches: mismatches }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
