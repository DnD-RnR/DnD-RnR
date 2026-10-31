import { SpellResources } from './SpellResources';
import { Card } from '../../components/ui/Card';
import { useEffect, useMemo, useState } from 'react';
import { api, type Character, type CharacterStatistics, type InventoryItem } from '../../api';
import { spellById, spellcastingProfile, type Spell } from '../../../shared/spellcasting.mjs';
import { weaponDamage } from '../../lib/weapons';
import { characterTraits } from '../../../shared/character-traits.mjs';
import { masteryProperties, weaponById } from '../../../shared/weapon-mastery.mjs';

const actions = [
  ['Atak', 'Wykonaj atak bronią lub cios bez użycia broni.'],
  ['Zryw', 'Do końca tej tury zyskaj dodatkowy ruch równy twojej Szybkości.'],
  ['Wycofanie', 'Twój ruch do końca tej tury nie prowokuje ataków okazyjnych.'],
  ['Unik', 'Do początku swojej następnej tury ataki przeciwko tobie mają utrudnienie, a rzuty obronne na Zręczność wykonujesz z ułatwieniem. Tracisz tę korzyść, jeśli jesteś Obezwładniony lub twoja Szybkość wynosi 0.'],
  ['Pomoc', 'Pomóż innej istocie w teście cechy lub rzucie na atak albo udziel jej pierwszej pomocy.'],
  ['Ukrycie', 'Wykonaj test Zręczności (Skradanie się).'],
  ['Magia', 'Rzuć czar, użyj magicznego przedmiotu lub magicznej zdolności.'],
  ['Użycie przedmiotu', 'Użyj niemagicznego przedmiotu.'],
] as const;

function SpellList({ spells }: { spells: readonly Spell[] }) {
  return <ul className="combat-spell-list">
    {spells.map(spell => <li key={spell.id}>
      <a href={spell.url} target="_blank" rel="noreferrer">{spell.name} ↗</a>
      <small>{spell.level === 0 ? 'Sztuczka' : `${spell.level}. krąg`} · {spell.castingTime}</small>
    </li>)}
  </ul>;
}

const signed = (value: number) => value >= 0 ? `+${value}` : String(value);
const hasProperty = (item: InventoryItem, ...names: string[]) => item.weapon?.properties.some(property => names.some(name => property.toLowerCase().startsWith(name))) ?? false;

function WeaponList({ weapons, character, statistics }: { weapons: readonly InventoryItem[]; character: Character; statistics: CharacterStatistics | null }) {
  const [finesseAbilities, setFinesseAbilities] = useState<Record<number, 'str' | 'dex'>>({});
  if (!weapons.length) return <p className="combat-weapon-empty">Brak założonej broni — możesz wykonać cios bez użycia broni.</p>;
  if (!statistics) return <p className="combat-weapon-empty">Wczytywanie statystyk broni…</p>;
  const traits = characterTraits(character, statistics);
  const proficiency = 2 + Math.floor((character.level - 1) / 4);
  const modifier = (ability: string) => statistics.values[ability] == null ? null : Math.floor((statistics.values[ability]! - 10) / 2);
  const strength = modifier('str');
  const dexterity = modifier('dex');
  return <ul className="combat-weapon-list">
    {weapons.map(item => {
      const finesse = hasProperty(item, 'finezyjna', 'finesse');
      const ability = finesse ? finesseAbilities[item.id] ?? 'dex' : hasProperty(item, 'miotana', 'thrown') && item.weapon?.type !== 'dystansowa' ? 'str' : item.weapon?.type === 'dystansowa' ? 'dex' : 'str';
      const abilityModifier = ability === 'str' ? strength : dexterity;
      const proficient = traits.weapons.some(value => value.toLowerCase().includes(item.weapon!.category === 'simple' ? 'simple' : 'martial'));
      const attackBonus = abilityModifier === null ? null : abilityModifier + (proficient ? proficiency : 0);
      const damageBonus = abilityModifier === null ? null : abilityModifier;
      const heavyDisadvantage = hasProperty(item, 'ciężka', 'heavy') &&
        ((item.weapon?.type === 'dystansowa' && (statistics.values.dex === null || (statistics.values.dex ?? 0) < 13)) ||
         (item.weapon?.type !== 'dystansowa' && (statistics.values.str === null || (statistics.values.str ?? 0) < 13)));
      return <li key={item.id}>
        <strong>{item.name}</strong>
        <span>{weaponDamage(item)} {damageBonus === null ? '' : `${signed(damageBonus)} obrażeń`} {item.weapon?.damageType ? `· ${item.weapon.damageType}` : ''}</span>
        <span>Atak: {attackBonus === null ? 'brak danych' : signed(attackBonus)} · {proficient ? 'biegłość' : 'brak biegłości'}</span>
        <small>{item.grip === 'two' ? 'dwie ręce' : item.grip === 'none' ? 'broń dystansowa' : 'jedna ręka'}</small>
        {finesse && <label className="combat-weapon-choice">Modyfikator finezyjny:
          <select value={ability} onChange={event => setFinesseAbilities(previous => ({ ...previous, [item.id]: event.target.value as 'str' | 'dex' }))}>
            <option value="str">Siła ({strength === null ? '—' : signed(strength)})</option>
            <option value="dex">Zręczność ({dexterity === null ? '—' : signed(dexterity)})</option>
          </select>
        </label>}
        {heavyDisadvantage && <small className="combat-weapon-warning">Utrudnienie do ataku: zbyt niska cecha dla broni ciężkiej.</small>}
        {hasProperty(item, 'zasięg', 'reach') && <small>+5 stóp zasięgu.</small>}
        {hasProperty(item, 'miotana', 'thrown') && <small>Rzut tą bronią używa tego samego modyfikatora co atak wręcz.</small>}
        {item.weapon?.type === 'dystansowa' && item.weapon.range && <small>Poza normalnym zasięgiem ({item.weapon.range.split('/')[0]} stóp): utrudnienie.</small>}
        {hasProperty(item, 'lekka', 'light') && <small>Atak bonusowy inną lekką bronią nie dodaje modyfikatora cechy (chyba że jest ujemny).</small>}
      </li>;
    })}
    {(statistics.choices?.weaponMastery ?? []).filter(id => weapons.some(item => item.weapon?.id === id)).map(id => {
      const weapon = weaponById(id);
      if (!weapon) return null;
      return <li key={`mastery-${id}`}><strong>{weapon.mastery}</strong><span>Weapon Mastery · {weapon.name}</span><small>{masteryProperties[weapon.mastery] ?? 'Właściwość mistrzostwa tej broni.'}</small></li>;
    })}
  </ul>;
}

function ActionList({ entries, spells, weapons, character, statistics }: { entries: readonly (readonly [string, string])[]; spells?: readonly Spell[]; weapons?: readonly InventoryItem[]; character?: Character; statistics?: CharacterStatistics | null }) {
  const hasMagicEntry = entries.some(([name]) => name === 'Magia');
  return (
    <>
      <ul className="combat-action-list">
        {entries.map(([name, description]) => (
          <li key={name}>
            <details>
              <summary>{name}</summary>
              <p>{description}</p>
              {name === 'Atak' && weapons && character && statistics !== undefined && <WeaponList weapons={weapons} character={character} statistics={statistics} />}
              {name === 'Magia' && spells && <SpellList spells={spells} />}
            </details>
          </li>
        ))}
      </ul>
      {spells && !hasMagicEntry && <SpellList spells={spells} />}
    </>
  );
}

const castingTimeCategory = (castingTime: string) => {
  const normalized = castingTime.replace(/\(\*\)/g, '').trim();
  if (normalized.startsWith('Bonus Action')) return 'bonus';
  if (normalized.startsWith('Reaction')) return 'reaction';
  if (normalized.startsWith('Action')) return 'action';
  return null;
};

export function CombatTab({ character, active: isActive, equippedWeapons }: { character: Character; active: boolean; equippedWeapons: readonly InventoryItem[] }) {
  const [statistics, setStatistics] = useState<CharacterStatistics | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isActive) return;
    let mounted = true;
    api<{ statistics: CharacterStatistics }>(`/characters/${character.id}/statistics`)
      .then(data => { if (mounted) setStatistics(data.statistics); })
      .catch(e => { if (mounted) setError(e instanceof Error ? e.message : 'Nie udało się wczytać czarów.'); });
    return () => { mounted = false; };
  }, [character.id, isActive]);

  const combatSpells = useMemo(() => {
    if (!statistics) return { action: [], bonus: [], reaction: [] } as Record<'action' | 'bonus' | 'reaction', Spell[]>;
    const profile = spellcastingProfile(character, statistics.spells);
    const ids = [...profile.automatic.map(spell => spell.id), ...Object.entries(statistics.spells.selections)
      .filter(([groupId]) => groupId !== 'book')
      .flatMap(([, selected]) => selected)];
    const unique = [...new Set(ids)].map(id => spellById.get(id)).filter((spell): spell is Spell => Boolean(spell));
    return unique.reduce((groups, spell) => {
      const category = castingTimeCategory(spell.castingTime);
      if (category) groups[category].push(spell);
      return groups;
    }, { action: [], bonus: [], reaction: [] } as Record<'action' | 'bonus' | 'reaction', Spell[]>);
  }, [character, statistics]);

  return (
    <div className="combat-tab">
      <div className="inventory-section-heading">
        <div>
          <p className="eyebrow">KARTA BOHATERA</p>
          <h2>Walka</h2>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <SpellResources characterId={character.id} /><div className="combat-sections">
        <Card title="Akcja" eyebrow="TURA">
          <ActionList entries={actions} spells={combatSpells.action} weapons={equippedWeapons} character={character} statistics={statistics} />
        </Card>
        <Card title="Akcja bonusowa" eyebrow="TURA">
          <ActionList entries={[]} spells={combatSpells.bonus} />
          {!combatSpells.bonus.length && <p className="statistics-help">Brak czarów z czasem rzucania „Akcja bonusowa”.</p>}
        </Card>
        <Card title="Reakcja" eyebrow="POZA TURĄ">
          <ActionList entries={[
            ['Atak okazyjny', 'Możesz wykonać atak okazyjny, gdy widziana przez ciebie istota opuszcza twój zasięg, wykorzystując do tego akcję, akcję bonusową, reakcję lub jedną ze swoich Szybkości. Aby wykonać atak okazyjny, użyj reakcji i wykonaj jeden atak wręcz bronią lub cios bez użycia broni przeciwko prowokującej istocie. Atak następuje bezpośrednio przed opuszczeniem przez nią twojego zasięgu.'],
          ]} />
          {!!combatSpells.reaction.length && <SpellList spells={combatSpells.reaction} />}
        </Card>
      </div>
    </div>
  );
}
