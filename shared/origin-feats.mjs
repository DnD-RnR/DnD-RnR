import catalog from './origin-feats.json' with { type: 'json' };
import spells from './spell-catalog.json' with { type: 'json' };
import data from './trait-data.json' with { type: 'json' };

export const originFeats = catalog.flatMap(f => f.id === 'magic-initiate'
  ? ['Cleric', 'Druid', 'Wizard'].map(list => ({ ...f, name: `Magic Initiate (${list})`, list: list.toLowerCase() }))
  : [{ ...f, ...(f.id === 'arcane-undertaker' ? { cantrips: ['chill-touch','spare-the-dying','toll-the-dead'] } : {}) }]);
export const originFeatNames = catalog.flatMap(f => f.id === 'magic-initiate' ? ['Cleric', 'Druid', 'Wizard'].map(list => `Magic Initiate (${list})`) : [f.name]);
export const originFeatForName = name => catalog.find(f => f.name === name || f.id === 'magic-initiate' && /^Magic Initiate \((Cleric|Druid|Wizard)\)$/.test(name));
export const eligibleOriginFeatNames = character => originFeatNames.filter(name => !originFeatForName(name).humanOnly || character.species === 'Człowiek (Human)');
export const eligibleOriginFeats = character => originFeats.filter(f => !f.humanOnly || character.species === 'Człowiek (Human)');
const prefix = name => `origin:${name}`;

export function selectedOriginFeats(character, traits = {}) {
  const names = new Set();
  const background = Object.values(data.backgrounds).find(b => b.name === character.background);
  if (background) names.add(background.Feat);
  if (character.species === 'Człowiek (Human)') for (const name of traits.humanFeat ?? []) names.add(name);
  if (character.class?.includes('(Warlock)') && character.level >= 2) for (const value of traits.invocations ?? []) {
    if (value.startsWith('lessons-of-the-first-ones:')) names.add(value.split(':')[1]);
  }
  return eligibleOriginFeats(character).filter(f => names.has(f.name));
}

export function originSpellGrants(feats, traits = {}) {
  return feats.flatMap(f => {
    const key = prefix(f.name);
    const allowed = spells.spells.filter(s => f.list ? s.classes.includes(f.list) && s.level <= 1 : f.cantrips?.includes(s.id));
    const chosen = [...(traits[`${key}:cantrips`] ?? []), ...(traits[`${key}:spell`] ?? [])].filter(id => allowed.some(s => s.id === id));
    return [...(f.spells ?? []), ...chosen].map(id => ({ id, reason: f.name, ability: traits[`${key}:ability`]?.[0] ?? '', freeCast: Boolean(f.list && spells.spells.find(s => s.id === id)?.level === 1 || f.name === 'Familiar Friend') }));
  });
}

export function originFeatSheet(names, character, stats) {
  const proficiency = 2 + Math.floor((character.level - 1) / 4);
  return names.map(name => {
    const feat = originFeatForName(name);
    if (!feat) return null;
    const key = prefix(name), chosen = stats.traits ?? {};
    const ability = chosen[`${key}:ability`]?.[0] ?? '';
    const score = stats.values?.[ability];
    const mod = score == null ? null : Math.floor((score - 10) / 2);
    const ids = [...feat.spells, ...(chosen[`${key}:cantrips`] ?? []), ...(chosen[`${key}:spell`] ?? [])];
    const details = [];
    if (feat.resource) details.push(`Limit: ${feat.resource.maximum === 'proficiency' ? proficiency : feat.resource.maximum}; odnowienie po ${feat.resource.rest === 'short' ? 'krótkim lub długim' : 'długim'} odpoczynku.`);
    if (feat.id === 'alert') details.push(`Premia inicjatywy: +${proficiency}.`);
    if (feat.id === 'tough') details.push(`Premia maksymalnych PW: +${2 * character.level}.`);
    if (feat.id === 'familiar-friend') details.push(`Premia PW chowańca: +${2 * character.level}.`);
    if (feat.id === 'child-of-the-sea' && stats.values?.con != null) details.push(`Wstrzymanie oddechu: ${Math.max(1, 2 + Math.floor((stats.values.con - 10) / 2))} min.`);
    if (feat.id === 'vampire-hunter') details.push(`Vitality Ward: ${proficiency}k6 redukcji Necrotic.`);
    if (feat.id === 'cult-of-the-dragon-initiate' && stats.values?.wis != null) details.push(`Dragon’s Terror — ST ${8 + proficiency + Math.floor((stats.values.wis - 10) / 2)}.`);
    return { ...feat, name, ability, spellAttack: mod === null ? null : proficiency + mod, spellDc: mod === null ? null : 8 + proficiency + mod,
      details, spells: [...new Set(ids)].map(id => spells.spells.find(s => s.id === id)).filter(Boolean) };
  }).filter(Boolean);
}
