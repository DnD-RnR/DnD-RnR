import catalog from './spell-catalog.json' with { type: 'json' };
import options from './trait-options.json' with { type: 'json' };
import subclassSpells from './subclass-spells.json' with { type: 'json' };
import { eligibleOriginFeats } from './origin-feats.mjs';

export const invocationSource = 'https://dnd2024.wikidot.com/warlock:eldritch-invocation';
const entry = (id, name, level = 1, requires = '', target = '', source = 'PHB 2024') => ({ id, name, level, requires, target, source });
export const invocations = [
  entry('agonizing-blast', 'Agonizing Blast', 2, '', 'damage'),
  entry('armor-of-shadows', 'Armor of Shadows'),
  entry('ascendant-step', 'Ascendant Step', 5),
  entry('devils-sight', 'Devil’s Sight', 2),
  entry('devouring-blade', 'Devouring Blade', 12, 'thirsting-blade'),
  entry('eldritch-mind', 'Eldritch Mind'),
  entry('eldritch-smite', 'Eldritch Smite', 5, 'pact-of-the-blade'),
  entry('eldritch-spear', 'Eldritch Spear', 2, '', 'range'),
  entry('fiendish-vigor', 'Fiendish Vigor', 2),
  entry('gaze-of-two-minds', 'Gaze of Two Minds', 5),
  entry('gift-of-the-depths', 'Gift of the Depths', 5),
  entry('gift-of-the-protectors', 'Gift of the Protectors', 9, 'pact-of-the-tome'),
  entry('investment-of-the-chain-master', 'Investment of the Chain Master', 5, 'pact-of-the-chain'),
  entry('lessons-of-the-first-ones', 'Lessons of the First Ones', 2, '', 'feat'),
  entry('lifedrinker', 'Lifedrinker', 9, 'pact-of-the-blade'),
  entry('mask-of-many-faces', 'Mask of Many Faces', 2),
  entry('master-of-myriad-forms', 'Master of Myriad Forms', 5),
  entry('misty-visions', 'Misty Visions', 2),
  entry('one-with-shadows', 'One with Shadows', 5),
  entry('otherworldly-leap', 'Otherworldly Leap', 2),
  entry('pact-of-the-blade', 'Pact of the Blade'),
  entry('pact-of-the-chain', 'Pact of the Chain'),
  entry('pact-of-the-tome', 'Pact of the Tome'),
  entry('repelling-blast', 'Repelling Blast', 2, '', 'attack'),
  entry('thirsting-blade', 'Thirsting Blade', 5, 'pact-of-the-blade'),
  entry('visions-of-distant-realms', 'Visions of Distant Realms', 9),
  entry('whispers-of-the-grave', 'Whispers of the Grave', 7),
  entry('witch-sight', 'Witch Sight', 15),
  ...[
    ['call-of-the-void', 'Call of the Void', 5, 'pact-of-the-legion'],
    ['curse-of-corruption', 'Curse of Corruption', 2],
    ['expendable-minions', 'Expendable Minions', 9],
    ['health-funnel', 'Health Funnel', 2],
    ['legion-summoning', 'Legion Summoning', 9, 'pact-of-the-legion'],
    ['master-demonologist', 'Master Demonologist', 5],
    ['pact-of-the-legion', 'Pact of the Legion', 1],
  ].map(([id, name, level, requires]) => entry(id, name, level, requires, '', 'World of Warcraft')),
];
export const invocationCount = character => !character.class?.includes('(Warlock)') ? 0
  : character.level >= 18 ? 10 : character.level >= 15 ? 9 : character.level >= 12 ? 8
    : character.level >= 9 ? 7 : character.level >= 7 ? 6 : character.level >= 5 ? 5 : character.level >= 2 ? 3 : 1;
const attacks = ['chill-touch', 'eldritch-blast', 'poison-spray', 'true-strike', 'fire-bolt', 'ray-of-frost', 'shocking-grasp', 'thorn-whip', 'produce-flame', 'sorcerous-burst', 'starry-wisp'];
const damaging = [...attacks, 'mind-sliver', 'thunderclap', 'toll-the-dead', 'acid-splash', 'sacred-flame', 'vicious-mockery', 'word-of-radiance'];

export function invocationOptions(character, stats) {
  if (!invocationCount(character)) return [];
  const chosen = stats.traits?.invocations ?? [];
  const tome = chosen.includes('pact-of-the-tome') ? stats.traits?.tomeCantrips ?? [] : [];
  const known = new Set([...(stats.spells?.selections?.cantrips ?? []), ...tome]);
  return invocations.filter(i => character.level >= i.level && (!i.requires || chosen.includes(i.requires))).flatMap(i => {
    const label = `${i.name}${i.source === 'World of Warcraft' ? ' [World of Warcraft]' : ''}`;
    if (!i.target) return [{ id: i.id, label }];
    if (i.target === 'feat') return eligibleOriginFeats(character).map(feat => ({ id: `${i.id}:${feat.name}`, label: `${label} — ${feat.name}` }));
    const eligible = i.target === 'attack' ? attacks : damaging;
    return catalog.spells.filter(s => known.has(s.id) && eligible.includes(s.id)
      && (i.target !== 'range' || Number(s.range?.match(/^\d+/)?.[0] ?? 0) >= 10))
      .map(s => ({ id: `${i.id}:${s.id}`, label: `${label} — ${s.name}` }));
  });
}

export function tomeOptions(character, stats) {
  const prepared = new Set(Object.values(stats.spells?.selections ?? {}).flat());
  for (const row of subclassSpells[character.subclass]?.variants?.[0] ?? []) if (character.level >= row.level) row.spells.forEach(id => prepared.add(id));
  if (character.level >= 9) prepared.add('contact-other-plane');
  return catalog.spells.filter(s => !prepared.has(s.id) && (s.level === 0 || s.level === 1 && s.castingTime.endsWith('or R')));
}
