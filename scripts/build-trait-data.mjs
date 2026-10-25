// Extract factual PHB 2024 trait metadata; descriptions remain linked at the source.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import options from '../shared/character-options.json' with { type: 'json' };
const origin = 'https://dnd2024.wikidot.com';
const cache = new URL('../.local-preview/spell-sources/', import.meta.url);
mkdirSync(cache, { recursive: true });
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&#0?39;|&apos;|&#8217;|’/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
async function page(path) {
  const file = new URL(`${path.replaceAll(':', '-')}.html`, cache);
  if (!existsSync(file)) {
    const response = await fetch(`${origin}/${path}`);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    writeFileSync(file, await response.text());
  }
  return readFileSync(file, 'utf8').split('id="page-content"')[1]?.split('<!--')[0] ?? '';
}
const rows = table => [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(cell => cell[1]));
const classTraits = {};
const subclassTraits = {};
for (const entry of options.classes) {
  const id = entry.name.match(/\(([^)]+)\)/)?.[1].toLowerCase() ?? entry.name.toLowerCase();
  const path = `${id}:main`;
  const html = await page(path);
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map(match => rows(match[1]));
  const core = Object.fromEntries(tables[0].filter(row => row.length === 2 && text(row[0]) !== 'Starting Equipment').map(row => row.map(text)));
  const features = [];
  for (const table of tables) {
    const column = table[0].findIndex(cell => /^(Class )?Features$/.test(text(cell)));
    if (column < 0) continue;
    for (const row of table.slice(1)) {
      const level = Number(text(row[0]));
      if (!Number.isInteger(level) || level < 1 || level > 20) continue;
      for (const match of row[column].matchAll(/<a href="([^\"]+)"[^>]*>(.*?)<\/a>/g)) {
        const name = text(match[2]);
        if (/subclass/i.test(name)) continue;
        features.push({ level, name, url: new URL(match[1], `${origin}/${path}`).href });
      }
    }
  }
  const resourceColumns = new Set(['Rages', 'Rage Damage', 'Bardic Die', 'Channel Divinity', 'Wild Shape', 'Sorcery Points', 'Focus Points', 'Second Wind', 'Weapon Mastery', 'Sneak Attack', 'Martial Arts', 'Unarmored Movement', 'Eldritch Invocations', 'Favored Enemy']);
  const resources = [];
  for (const table of tables) for (const [column, heading] of table[0].entries()) if (resourceColumns.has(text(heading))) {
    resources.push({ name: text(heading), levels: table.slice(1).filter(row => Number(text(row[0])) >= 1 && Number(text(row[0])) <= 20).map(row => ({ level: Number(text(row[0])), value: text(row[column] ?? '') })) });
  }
  classTraits[id] = { name: entry.name, url: `${origin}/${path}`, core, features, resources };
  for (const name of entry.subclasses) {
    const link = [...html.matchAll(/href="\/([^"#]+)"[^>]*>(.*?)<\/a>/g)].find(match => text(match[2]) === name);
    if (!link) throw new Error(`Missing subclass: ${name}`);
    const subHtml = await page(link[1]);
    const features = [...subHtml.matchAll(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/g)].map(match => text(match[1])).filter(value => /^Level \d+:/.test(value)).map(value => ({ level: Number(value.match(/^Level (\d+)/)[1]), name: value.replace(/^Level \d+:\s*/, ''), url: `${origin}/${link[1]}` }));
    subclassTraits[name] = { url: `${origin}/${link[1]}`, features };
  }
}
const backgrounds = {};
await Promise.all(options.backgrounds.map(async name => {
  const id = name.match(/\(([^)]+)\)/)[1].toLowerCase();
  const path = `background:${id}`;
  const html = await page(path);
  const fields = Object.fromEntries([...html.matchAll(/<strong>([^<]+):<\/strong>([\s\S]*?)(?=<br\s*\/?>|<\/p>)/g)].map(match => [text(match[1]), text(match[2])]));
  if (!fields['Skill Proficiencies'] || !fields.Feat) throw new Error(`Incomplete background: ${id}`);
  delete fields.Equipment;
  backgrounds[id] = { name, url: `${origin}/${path}`, ...fields };
}));
writeFileSync(new URL('../shared/trait-data.json', import.meta.url), JSON.stringify({ source: origin, classes: classTraits, subclasses: subclassTraits, backgrounds: Object.fromEntries(Object.entries(backgrounds).sort()) }, null, 2) + '\n');
console.log(`${Object.keys(classTraits).length} classes; ${Object.keys(subclassTraits).length} subclasses; ${Object.keys(backgrounds).length} backgrounds`);
