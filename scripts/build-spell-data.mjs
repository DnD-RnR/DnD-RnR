// Run with `node scripts/build-spell-data.mjs` to refresh PHB 2024 and the full Warlock list.
// English spell descriptions and upgrade text are included in the generated catalog.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import characterOptions from '../shared/character-options.json' with { type: 'json' };

const origin = 'https://dnd2024.wikidot.com';
const cache = new URL('../.local-preview/spell-sources/', import.meta.url);
mkdirSync(cache, { recursive: true });
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&#0?39;|&apos;|&#8217;|’/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const polishRange = value => value
  .replace(/\bfeet\b/gi, 'stóp')
  .replace(/(\d+)\s+foot\b/gi, '$1 stóp')
  .replace(/\bmiles\b/gi, 'mil')
  .replace(/\bmile\b/gi, 'milę')
  .replace(/\bSelf\b/gi, 'własny')
  .replace(/\bTouch\b/gi, 'dotyk')
  .replace(/\bUnlimited\b/gi, 'nieograniczony')
  .replace(/\bSight\b/gi, 'w zasięgu wzroku')
  .replace(/\bSpecial\b/gi, 'specjalny');
const polishDuration = value => value
  .replace(/^Instantaneous$/i, 'Natychmiastowy')
  .replace(/^Special$/i, 'Specjalny')
  .replace(/\bup to 1 round\b/gi, 'do 1 rundy')
  .replace(/\bup to 1 minute\b/gi, 'do 1 minuty')
  .replace(/\bup to 1 hour\b/gi, 'do 1 godziny')
  .replace(/\bup to 1 day\b/gi, 'do 1 dnia')
  .replace(/\b1 round\b/gi, '1 runda')
  .replace(/\b1 minute\b/gi, '1 minuta')
  .replace(/\b1 hour\b/gi, '1 godzina')
  .replace(/\b1 day\b/gi, '1 dzień')
  .replace(/\b24 hours\b/gi, '24 godziny')
  .replace(/\brounds?\b/gi, 'rund')
  .replace(/\bminutes?\b/gi, 'minut')
  .replace(/\bhours?\b/gi, 'godzin')
  .replace(/\bdays?\b/gi, 'dni')
  .replace(/\buntil dispelled\b/gi, 'do rozproszenia')
  .replace(/\bor triggered\b/gi, 'lub do wystąpienia warunku')
  .replace(/\bConcentration\b/gi, 'Koncentracja')
  .replace(/\bup to\b/gi, 'do');
const metadata = (html, label, transform = value => value) => {
  const match = html.match(new RegExp(`<strong>${label}:<\\/strong>\\s*([\\s\\S]*?)(?:<br\\s*\\/?\\s*>|<\\/p>)`, 'i'));
  if (!match) throw new Error(`Missing ${label}`);
  return transform(text(match[1]));
};
function spellText(html, complete = false) {
  const content = html.slice(html.indexOf('<div id="page-content">'));
  if (complete) {
    // Preserve named effects, lists and summoned-creature statistics in supplements.
    const body = content.slice(content.indexOf('</p>', content.indexOf('<strong>Duration:</strong>')) + 4).split('</div>')[0];
    const upgradePattern = /<p\b[^>]*>\s*<strong>(?:Using a Higher-Level Spell Slot|Cantrip Upgrade|At Higher Levels)[^<]*<\/strong>[\s\S]*?<\/p>/i;
    const upgrade = body.match(upgradePattern)?.[0] ?? '';
    return {
      description: body.replace(upgradePattern, '').split(/<\/p>|<\/tr>|<\/li>/i).map(text).filter(Boolean).join('\n\n'),
      upgrade: text(upgrade).replace(/^(?:Using a Higher-Level Spell Slot|Cantrip Upgrade|At Higher Levels)\.\s*/i, '')
    };
  }
  const paragraphs = [...content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => match[1]);
  const metadataIndex = paragraphs.findIndex(paragraph => paragraph.includes('<strong>Duration:</strong>'));
  const body = paragraphs.slice(metadataIndex + 1);
  const upgrade = body.find(paragraph => /<strong>[^<]*(?:Upgrade|Higher Levels)[^<]*<\/strong>/i.test(paragraph));
  const descriptionParagraphs = body.filter(paragraph => paragraph !== upgrade && !paragraph.includes('<strong>'));
  return {
    description: descriptionParagraphs.map(text).filter(Boolean).join('\n\n'),
    upgrade: upgrade ? text(upgrade).replace(/^(Cantrip Upgrade|At Higher Levels)\.\s*/i, '') : ''
  };
}
const rows = table => [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(cell => text(cell[1])));
const tables = html => [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map(match => rows(match[1]));
async function page(path) {
  const file = new URL(`${path.replaceAll(':', '-')}.html`, cache);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const response = await fetch(`${origin}/${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  const html = await response.text();
  if (!html.includes('id="page-content"')) throw new Error(`Missing content: ${path}`);
  writeFileSync(file, html);
  return html;
}
async function mapLimited(entries, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (next < entries.length) { const index = next++; await fn(entries[index], index); } }));
}
const catalog = new Map();
const all = await page('spell:all');
for (const section of all.split(/<div id="wiki-tab-0-/).slice(1)) {
  const level = Number(section.match(/^(\d+)"/)[1]);
  for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const link = row[1].match(/href="\/(spell:[^"]+)"[^>]*>(.*?)<\/a>/);
    if (!link) continue;
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => text(cell[1]));
    const id = link[1].slice(6);
    catalog.set(id, { id, name: text(link[2]), level, classes: cells[2].toLowerCase().split(',').map(value => value.trim()), castingTime: cells[3], url: `${origin}/${link[1]}` });
  }
}
// The Warlock list also includes supplements; retain them when rebuilding the catalog.
const warlockList = await page('warlock:spell-list');
const warlockIds = new Set();
for (const section of warlockList.split(/<div id="wiki-tab-0-/).slice(1)) {
  const level = Number(section.match(/^(\d+)"/)[1]);
  for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const link = row[1].match(/href="\/(spell:[^"]+)"[^>]*>(.*?)<\/a>/);
    if (!link) continue;
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => text(cell[1]));
    const id = link[1].slice(6);
    warlockIds.add(id);
    catalog.set(id, { id, name: text(link[2]), level, classes: cells[2].toLowerCase().split(',').map(value => value.trim()), castingTime: cells[3], url: `${origin}/${link[1]}` });
  }
}
if (warlockIds.size < 123) throw new Error(`Incomplete Warlock list: ${warlockIds.size}`);
await mapLimited([...catalog.values()], async spell => {
  const html = await page(`spell:${spell.id}`);
  const source = text(html.slice(html.indexOf('id="page-content"'))).match(/Source:\s*(.*?)(?:Cantrip|Level \d|\d(?:st|nd|rd|th)[ -]level)/i)?.[1] ?? '';
  spell.phb = source.includes("Player's Handbook");
  if (!spell.phb && warlockIds.has(spell.id)) spell.source = source.trim();
  spell.range = metadata(html, 'Range', polishRange);
  spell.duration = metadata(html, 'Duration', polishDuration);
  Object.assign(spell, spellText(html, !spell.phb && warlockIds.has(spell.id)));
});
const spells = [...catalog.values()].filter(spell => spell.phb || warlockIds.has(spell.id)).map(({ phb, ...spell }) => spell).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
if (spells.length < 380) throw new Error(`Incomplete PHB catalog: ${spells.length}`);
const classes = {};
const subclasses = {};
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const spellByName = new Map(spells.map(spell => [normalize(spell.name), spell.id]));
for (const entry of characterOptions.classes) {
  const id = entry.name.match(/\(([^)]+)\)/)?.[1].toLowerCase() ?? entry.name.toLowerCase();
  const html = await page(`${id}:main`);
  const progression = tables(html).find(table => table[0]?.includes('Prepared Spells'));
  if (progression) {
    const header = progression[0];
    classes[id] = { name: entry.name, url: `${origin}/${id}:main`, levels: progression.slice(1).map(row => {
      const get = label => { const i = header.indexOf(label); return i < 0 ? 0 : Number(row[i]) || 0; };
      return { level: Number(row[0]), cantrips: get('Cantrips'), prepared: get('Prepared Spells'), slotLevel: get('Slot Level'), slots: id === 'warlock' ? [get('Spell Slots')] : ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'].map(get) };
    }) };
  }
  for (const name of entry.subclasses) {
    const link = [...html.matchAll(/href="\/([^"#]+)"[^>]*>(.*?)<\/a>/g)].find(match => text(match[2]) === name);
    if (!link) throw new Error(`Missing subclass link: ${name}`);
    const subHtml = await page(link[1]);
    const subTables = tables(subHtml).filter(table => table[0]?.some(cell => /Spell|Cantrip/.test(cell)));
    if (['Eldritch Knight', 'Arcane Trickster'].includes(name)) {
      const table = subTables[0];
      classes[name] = { name, url: `${origin}/${link[1]}`, levels: table.slice(1).map(row => ({ level: Number(row[0]), cantrips: Number(row[0]) >= 10 ? 3 : 2, prepared: Number(row[1]), slotLevel: 0, slots: [...row.slice(2).map(value => Number(value) || 0), 0, 0, 0, 0, 0] })) };
    } else {
      const variants = subTables.map(table => table.slice(1).map(row => {
        const spellIds = row[1].split(' , ').map(spellName => {
          const spellId = spellByName.get(normalize(spellName));
          if (!spellId) throw new Error(`Unknown spell: ${name}: ${spellName}`);
          return spellId;
        });
        return { level: Number(row[0]), spells: spellIds };
      }));
      subclasses[name] = { classId: id, url: `${origin}/${link[1]}`, variants };
    }
  }
}
writeFileSync(new URL('../shared/spell-catalog.json', import.meta.url), JSON.stringify({ source: origin, edition: 'Player’s Handbook 2024 + Warlock supplements', spells }, null, 2) + '\n');
writeFileSync(new URL('../shared/spell-progression.json', import.meta.url), JSON.stringify(classes, null, 2) + '\n');
writeFileSync(new URL('../shared/subclass-spells.json', import.meta.url), JSON.stringify(subclasses, null, 2) + '\n');
console.log(`${spells.length} spells (PHB + Warlock supplements); ${Object.keys(classes).length} class progressions`);
