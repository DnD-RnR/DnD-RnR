import { SpellResources } from './SpellResources';
import { Card } from '../../components/ui/Card';
import { useEffect, useMemo, useState } from 'react';
import { api, type Character, type CharacterStatistics, type InventoryItem } from '../../api';
import { spellById, spellcastingProfile, type Spell } from '../../../shared/spellcasting.mjs';
import { weaponDamage } from '../../lib/weapons';
import { characterTraits } from '../../../shared/character-traits.mjs';
import { masteryProperties } from '../../../shared/weapon-mastery.mjs';
import { fightingStyleAttackBonus, fightingStyleDamageBonus, unarmedStrikeProfile } from '../../../shared/fighting-style.mjs';

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
const isMeleeWeapon = (item: InventoryItem) => ['wręczna', 'melee'].includes(item.weapon?.type.toLowerCase() ?? '');
const isLightWeapon = (item: InventoryItem) => hasProperty(item, 'lekka', 'light');
const isTwoHandedWeapon = (item: InventoryItem) => hasProperty(item, 'dwuręczna', 'two-handed');
const qualifiesForGreatWeaponFighting = (item: InventoryItem) => item.grip === 'two' && isMeleeWeapon(item)
  && hasProperty(item, 'dwuręczna', 'two-handed', 'wszechstronna', 'versatile');

const characterSize = (species: string) => ['Gnom (Gnome)', 'Niziołek (Halfling)'].includes(species) ? 'Mała' : 'Średnia';
const weaponDisplayOrder = (item: InventoryItem) => item.slot === 'main-hand' ? 0 : item.weapon?.type === 'dystansowa' ? 1 : item.slot === 'off-hand' ? 2 : 3;

function UnarmedStrike({ character, statistics, equippedItems }: { character: Character; statistics: CharacterStatistics | null; equippedItems: readonly InventoryItem[] }) {
  if (!statistics) return <p className="combat-weapon-empty">Wczytywanie danych ciosu bez użycia broni…</p>;
  const weapons = equippedItems.filter(item => item.weapon);
  const modifier = (ability: string) => statistics.values[ability] == null ? null : Math.floor((statistics.values[ability]! - 10) / 2);
  const strength = modifier('str');
  const attackBonus = strength === null ? null : strength + statistics.proficiency;
  const unarmed = strength === null ? null : unarmedStrikeProfile(statistics.choices?.fightingStyle, weapons, equippedItems.some(item => item.armor?.category === 'shield'), strength);
  const savingThrowDC = strength === null ? null : 8 + strength + statistics.proficiency;
  const mainHand = weapons.find(item => item.slot === 'main-hand');
  const offHand = weapons.find(item => item.slot === 'off-hand');
  const hasTwoHandedWeapon = weapons.some(item => item.grip === 'two');
  const hasFreeHand = !hasTwoHandedWeapon && (!mainHand || !offHand);
  const value = (number: number | null) => number === null ? 'brak danych' : signed(number);
  const calculatedValue = (number: number | null) => number === null ? 'brak danych' : String(number);
  const size = characterSize(character.species);

  return <details className="unarmed-strike">
    <summary>Cios bez broni</summary>
    <div className="unarmed-strike-content">
      <p>Zamiast używać broni do wykonania ataku wręcz, możesz wykonać cios pięścią, kopnięcie, uderzenie głową lub podobne, mocne uderzenie. W terminologii gry jest to cios bez użycia broni — atak wręcz, w którym używasz swojego ciała, aby zranić, schwytać lub odepchnąć cel znajdujący się w odległości do 5 stóp.</p>
      <p>Za każdym razem, gdy wykonujesz cios bez użycia broni, wybierz jeden z poniższych efektów.</p>
      <ul className="combat-action-list unarmed-options">
        <li><details><summary>Obrażenia</summary>
          <p>Wykonujesz rzut na atak przeciwko celowi. Twoja premia do rzutu wynosi modyfikator Siły plus premia z biegłości: <strong>{value(attackBonus)}</strong>.</p>
          <p>Przy trafieniu cel otrzymuje obrażenia obuchowe: <strong>{unarmed ? `${unarmed.dice}k${unarmed.sides} ${signed(unarmed.damageBonus)}` : 'brak danych'}</strong>.</p>
        </details></li>
        {hasFreeHand && <li><details><summary>Pochwycenie</summary>
          <p>Cel musi wykonać udany rzut obronny na Siłę lub Zręczność (wybiera cel), w przeciwnym razie otrzymuje stan Pochwycony. ST rzutu obronnego i prób ucieczki wynosi 8 plus modyfikator Siły i premia z biegłości: <strong>{calculatedValue(savingThrowDC)}</strong>.</p>
          <p>To pochwycenie jest możliwe tylko wtedy, gdy cel jest najwyżej o jeden rozmiar większy od ciebie. Twoja wielkość to <strong>{size}</strong>. Musisz mieć wolną rękę.</p>
          {statistics.choices?.fightingStyle === 'unarmed-fighting' && <p>Na początku każdej swojej tury możesz zadać 1k4 obrażeń obuchowych jednej istocie, która jest przez ciebie pochwycona.</p>}
        </details></li>}
        <li><details><summary>Odepchnięcie</summary>
          <p>Cel musi wykonać udany rzut obronny na Siłę lub Zręczność (wybiera cel), w przeciwnym razie odpychasz go o 5 stóp albo nadajesz mu stan Powalony. ST rzutu obronnego wynosi 8 plus modyfikator Siły i premia z biegłości: <strong>{calculatedValue(savingThrowDC)}</strong>.</p>
          <p>To odepchnięcie jest możliwe tylko wtedy, gdy cel jest najwyżej o jeden rozmiar większy od ciebie. Twoja wielkość to <strong>{size}</strong>.</p>
        </details></li>
      </ul>
    </div>
  </details>;
}

function weaponSectionLabel(item: InventoryItem) {
  return item.slot === 'main-hand' ? 'Ręka główna' : item.weapon?.type === 'dystansowa' ? 'Broń zasięgowa' : 'Broń w off-hand';
}

function WeaponList({ weapons, character, statistics, showMastery = false, grouped = false }: { weapons: readonly InventoryItem[]; character: Character; statistics: CharacterStatistics | null; showMastery?: boolean; grouped?: boolean }) {
  const [finesseAbilities, setFinesseAbilities] = useState<Record<number, 'str' | 'dex'>>({});
  if (!weapons.length) return <p className="combat-weapon-empty">Brak założonej broni — możesz wykonać cios bez użycia broni.</p>;
  if (!statistics) return <p className="combat-weapon-empty">Wczytywanie statystyk broni…</p>;
  const traits = characterTraits(character, statistics);
  const orderedWeapons = [...weapons].sort((a, b) => weaponDisplayOrder(a) - weaponDisplayOrder(b));
  const modifier = (ability: string) => statistics.values[ability] == null ? null : Math.floor((statistics.values[ability]! - 10) / 2);
  const strength = modifier('str');
  const dexterity = modifier('dex');
  return <ul className="combat-weapon-list">
    {orderedWeapons.map(item => {
      const finesse = hasProperty(item, 'finezyjna', 'finesse');
      const ability = finesse ? finesseAbilities[item.id] ?? 'dex' : hasProperty(item, 'miotana', 'thrown') && item.weapon?.type !== 'dystansowa' ? 'str' : item.weapon?.type === 'dystansowa' ? 'dex' : 'str';
      const abilityModifier = ability === 'str' ? strength : dexterity;
      const proficient = traits.weapons.some(value => value.toLowerCase().includes(item.weapon!.category === 'simple' ? 'simple' : 'martial'));
      const attackBonus = abilityModifier === null ? null : abilityModifier + (proficient ? statistics.proficiency : 0) +
        fightingStyleAttackBonus(statistics.choices?.fightingStyle, item.weapon);
      const styleDamageBonus = fightingStyleDamageBonus(statistics.choices?.fightingStyle,
        item.weapon ? { ...item.weapon, slot: item.slot, grip: item.grip } : null, weapons, abilityModifier ?? 0);
      const damageBonus = abilityModifier === null ? null : (item.slot === 'off-hand' ? styleDamageBonus : abilityModifier + styleDamageBonus);
      const heavyDisadvantage = hasProperty(item, 'ciężka', 'heavy') &&
        ((item.weapon?.type === 'dystansowa' && (statistics.values.dex === null || (statistics.values.dex ?? 0) < 13)) ||
         (item.weapon?.type !== 'dystansowa' && (statistics.values.str === null || (statistics.values.str ?? 0) < 13)));
      const selectedMasteries = statistics.choices?.weaponMastery ?? [];
      const masterySelected = showMastery && item.weapon &&
        selectedMasteries.some(value => value === item.weapon!.id || value === item.weapon!.name);
      const weaponDetails = <>
        <strong className={item.slot === 'main-hand' ? 'combat-weapon-main-hand' : 'combat-weapon-off-hand'}>{item.name} <small>{item.slot === 'main-hand' ? 'Główna ręka' : item.slot === 'off-hand' ? 'Druga ręka' : ''}</small></strong>
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
        {statistics.choices?.fightingStyle === 'great-weapon-fighting' && qualifiesForGreatWeaponFighting(item) &&
          <small>Gdy rzucasz na obrażenia za pomocą broni wręcz trzymanej oburącz, możesz traktować wynik 1 lub 2 na kości obrażeń jako 3.</small>}
        {hasProperty(item, 'zasięg', 'reach') && <small>+5 stóp zasięgu.</small>}
        {hasProperty(item, 'miotana', 'thrown') && <small>Rzut tą bronią używa tego samego modyfikatora co atak wręcz.</small>}
        {item.weapon?.type === 'dystansowa' && item.weapon.range && <small>Poza normalnym zasięgiem ({item.weapon.range.split('/')[0]} stóp): utrudnienie.</small>}
        {hasProperty(item, 'lekka', 'light') && <small>{statistics.choices?.fightingStyle === 'two-weapon-fighting' ? 'Walka dwiema broniami pozwala dodać modyfikator cechy do obrażeń ataku drugą lekką bronią.' : 'Atak drugą lekką bronią nie dodaje modyfikatora cechy.'}</small>}
        {item.slot === 'off-hand' && <small>Druga ręka: po ataku główną ręką.</small>}
        {item.slot === 'off-hand' && item.weapon?.mastery === 'Nick' && <small>Nick: ten dodatkowy atak możesz wykonać w ramach Akcji zamiast Akcji bonusowej.</small>}
        {masterySelected && item.weapon && <div className="combat-weapon-mastery"><strong>{item.weapon.mastery}</strong><span>Weapon Mastery · {item.name}</span><small>{masteryProperties[item.weapon.mastery] ?? 'Właściwość mistrzostwa tej broni.'}</small></div>}
      </>;
      return <li key={item.id}>{grouped
        ? <details className="weapon-attack-group"><summary>{weaponSectionLabel(item)}<small>{item.name}</small></summary><div className="weapon-attack-content">{weaponDetails}</div></details>
        : weaponDetails}</li>;
    })}
  </ul>;
}

function ActionList({ entries, spells, weapons, character, statistics, equippedItems }: { entries: readonly (readonly [string, string])[]; spells?: readonly Spell[]; weapons?: readonly InventoryItem[]; character?: Character; statistics?: CharacterStatistics | null; equippedItems?: readonly InventoryItem[] }) {
  const hasMagicEntry = entries.some(([name]) => name === 'Magia');
  return (
    <>
      <ul className="combat-action-list">
        {entries.map(([name, description]) => (
          <li key={name}>
            <details>
              <summary className="combat-action-summary">{name}</summary>
              <p>{description}</p>
              {name === 'Atak' && weapons && character && statistics !== undefined && <>
                <WeaponList weapons={weapons} character={character} statistics={statistics} showMastery grouped />
                <UnarmedStrike character={character} statistics={statistics} equippedItems={equippedItems ?? weapons ?? []} />
              </>}
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

export function CombatTab({ character, active: isActive, equippedItems }: { character: Character; active: boolean; equippedItems: readonly InventoryItem[] }) {
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
      .flatMap(([, selected]) => selected), ...(statistics.choices?.fightingStyle === 'arcane-warrior' ? statistics.choices.arcaneWarrior?.cantrips ?? [] : [])];
    const unique = [...new Set(ids)].map(id => spellById.get(id)).filter((spell): spell is Spell => Boolean(spell));
    return unique.reduce((groups, spell) => {
      const category = castingTimeCategory(spell.castingTime);
      if (category) groups[category].push(spell);
      return groups;
    }, { action: [], bonus: [], reaction: [] } as Record<'action' | 'bonus' | 'reaction', Spell[]>);
  }, [character, statistics]);
  const equippedWeapons = equippedItems.filter(item => item.weapon);
  const mainHand = equippedWeapons.find(item => item.slot === 'main-hand');
  const offHand = equippedWeapons.find(item => item.slot === 'off-hand');
  const dualWield = Boolean(mainHand && offHand && isMeleeWeapon(mainHand) && isMeleeWeapon(offHand) &&
    isLightWeapon(mainHand) && isLightWeapon(offHand) &&
    mainHand.grip !== 'two' && offHand.grip !== 'two' &&
    !isTwoHandedWeapon(mainHand) && !isTwoHandedWeapon(offHand));
  const actionWeapons = equippedWeapons.filter(item => item.slot !== 'off-hand' || item.weapon?.mastery === 'Nick');
  const bonusWeapons: InventoryItem[] = dualWield && offHand && offHand.weapon?.mastery !== 'Nick' ? [offHand] : [];

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
          <ActionList entries={actions} spells={combatSpells.action} weapons={actionWeapons} character={character} statistics={statistics} equippedItems={equippedItems} />
        </Card>
        <Card title="Akcja bonusowa" eyebrow="TURA">
          <ActionList entries={[]} spells={combatSpells.bonus} />
          {!!bonusWeapons.length && <WeaponList weapons={bonusWeapons} character={character} statistics={statistics} showMastery />}
          {!combatSpells.bonus.length && !bonusWeapons.length && <p className="statistics-help">Brak czarów lub ataków z czasem wykonania „Akcja bonusowa”.</p>}
        </Card>
        <Card title="Reakcja" eyebrow="POZA TURĄ">
          <ActionList entries={[
            ['Atak okazyjny', 'Możesz wykonać atak okazyjny, gdy widziana przez ciebie istota opuszcza twój zasięg, wykorzystując do tego akcję, akcję bonusową, reakcję lub jedną ze swoich Szybkości. Aby wykonać atak okazyjny, użyj reakcji i wykonaj jeden atak wręcz bronią lub cios bez użycia broni przeciwko prowokującej istocie. Atak następuje bezpośrednio przed opuszczeniem przez nią twojego zasięgu.'],
            ...(statistics?.choices?.fightingStyle === 'interception'
              ? [['Interception (Przechwycenie)', `Gdy widziana przez ciebie istota trafia inną istotę w odległości do 1,5 metra od ciebie, możesz użyć reakcji, aby zmniejszyć zadane obrażenia o 1k10 ${signed(statistics.proficiency)}. Musisz trzymać tarczę albo broń prostą lub wojenną.`] as const]
              : []),
            ...(statistics?.choices?.fightingStyle === 'protection'
              ? [['Protection (Ochrona)', 'Gdy widziana przez ciebie istota atakuje pobliskiego sojusznika, możesz użyć reakcji i trzymając tarczę narzucić utrudnienie na ten atak. Efekt trwa, dopóki pozostajesz obok chronionego sojusznika.'] as const]
              : []),
          ]} />
          {!!combatSpells.reaction.length && <SpellList spells={combatSpells.reaction} />}
        </Card>
      </div>
    </div>
  );
}
