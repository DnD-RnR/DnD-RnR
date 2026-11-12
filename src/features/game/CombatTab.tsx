import { combatOtherAbilities } from './combatOtherAbilities';
import { psiResources } from '../../../shared/psi-warrior.mjs';
import definitions from '../../../shared/statistics.json' with { type: 'json' };
import { rageProfile, rageDescription, primalSkills, dangerSenseDescription } from '../../../shared/barbarian.mjs';
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

const weaponDisplayOrder = (item: InventoryItem) => item.slot === 'main-hand' ? 0 : item.weapon?.type === 'dystansowa' ? 1 : item.slot === 'off-hand' ? 2 : 3;

function UnarmedStrike({ character, statistics, equippedItems }: { character: Character; statistics: CharacterStatistics | null; equippedItems: readonly InventoryItem[] }) {
  if (!statistics) return <p className="combat-weapon-empty">Wczytywanie danych ciosu bez użycia broni…</p>;
  const weapons = equippedItems.filter(item => item.weapon);
  const modifier = (ability: string) => statistics.values[ability] == null ? null : Math.floor((statistics.values[ability]! - 10) / 2);
  const strength = modifier('str');
  const attackBonus = strength === null ? null : strength + statistics.proficiency;
  const traits = characterTraits(character, statistics);
  const hasTavernBrawler = traits.feats.includes('Tavern Brawler');
  const unarmed = strength === null ? null : unarmedStrikeProfile(statistics.choices?.fightingStyle, weapons, equippedItems.some(item => item.armor?.category === 'shield'), strength, hasTavernBrawler);
  const savingThrowDC = strength === null ? null : 8 + strength + statistics.proficiency;
  const mainHand = weapons.find(item => item.slot === 'main-hand');
  const offHand = weapons.find(item => item.slot === 'off-hand');
  const hasTwoHandedWeapon = weapons.some(item => item.grip === 'two');
  const hasFreeHand = !hasTwoHandedWeapon && (!mainHand || !offHand);
  const value = (number: number | null) => number === null ? 'brak danych' : signed(number);
  const calculatedValue = (number: number | null) => number === null ? 'brak danych' : String(number);
  const size = traits.size ?? 'brak danych';

  return <details className="unarmed-strike">
    <summary>Cios bez broni</summary>
    <div className="unarmed-strike-content">
      <p>Zamiast używać broni do wykonania ataku wręcz, możesz wykonać cios pięścią, kopnięcie, uderzenie głową lub podobne, mocne uderzenie. W terminologii gry jest to cios bez użycia broni — atak wręcz, w którym używasz swojego ciała, aby zranić, schwytać lub odepchnąć cel znajdujący się w odległości do 5 stóp.</p>
      <p>Za każdym razem, gdy wykonujesz cios bez użycia broni, wybierz jeden z poniższych efektów.</p>
      <ul className="combat-action-list unarmed-options">
        <li><details><summary>Obrażenia</summary>
          <p>Wykonujesz rzut na atak przeciwko celowi. Twoja premia do rzutu wynosi modyfikator Siły plus premia z biegłości: <strong>{value(attackBonus)}</strong>.</p>
          <p>Przy trafieniu cel otrzymuje obrażenia obuchowe: <strong>{unarmed ? `${unarmed.dice}k${unarmed.sides} ${signed(unarmed.damageBonus)}` : 'brak danych'}</strong>.</p>
          {rageProfile(character).max > 0 && <p>W Szale: dodatkowe <strong>+{rageProfile(character).damage}</strong> obrażeń tego ciosu (premia nie jest podwajana przy trafieniu krytycznym).</p>}
          {hasTavernBrawler && <><p><strong>Enhanced Unarmed Strike:</strong> zamiast normalnych obrażeń ciosu bez broni zadajesz 1k4 + modyfikator Siły obrażeń obuchowych.</p><p><strong>Damage Rerolls:</strong> gdy na kości obrażeń ciosu bez broni wypadnie 1, możesz przerzucić tę kość, ale musisz użyć nowego wyniku.</p><p><strong>Push:</strong> gdy trafisz istotę ciosem bez broni w ramach akcji Atak, możesz zadać jej obrażenia i dodatkowo odepchnąć ją o 5 stóp. Możesz użyć tego efektu tylko raz na turę.</p></>}
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

function WeaponList({ weapons, character, statistics, showMastery = false, grouped = false, opportunity = false }: { weapons: readonly InventoryItem[]; character: Character; statistics: CharacterStatistics | null; showMastery?: boolean; grouped?: boolean; opportunity?: boolean }) {
  const [finesseAbilities, setFinesseAbilities] = useState<Record<number, 'str' | 'dex'>>({});
  if (!weapons.length) return <p className="combat-weapon-empty">Brak założonej broni — możesz wykonać cios bez użycia broni.</p>;
  if (!statistics) return <p className="combat-weapon-empty">Wczytywanie statystyk broni…</p>;
  const traits = characterTraits(character, statistics);
  const orderedWeapons = weapons.filter(item => !opportunity || isMeleeWeapon(item)).sort((a, b) => weaponDisplayOrder(a) - weaponDisplayOrder(b));
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
      const styleDamageBonus = fightingStyleDamageBonus(opportunity && ['two-weapon-fighting', 'thrown-weapon-fighting'].includes(statistics.choices?.fightingStyle ?? '') ? '' : statistics.choices?.fightingStyle,
        item.weapon ? { ...item.weapon, slot: item.slot, grip: item.grip } : null, weapons, abilityModifier ?? 0);
      const damageBonus = abilityModifier === null ? null : (item.slot === 'off-hand' && !opportunity ? styleDamageBonus : abilityModifier + styleDamageBonus);
      const heavyDisadvantage = hasProperty(item, 'ciężka', 'heavy') &&
        ((item.weapon?.type === 'dystansowa' && (statistics.values.dex === null || (statistics.values.dex ?? 0) < 13)) ||
         (item.weapon?.type !== 'dystansowa' && (statistics.values.str === null || (statistics.values.str ?? 0) < 13)));
      const selectedMasteries = statistics.choices?.weaponMastery ?? [];
      const masterySelected = showMastery && item.weapon &&
        selectedMasteries.some(value => value === item.weapon!.id || value === item.weapon!.name);
      const weaponDetails = <>
        <strong className={item.slot === 'main-hand' ? 'combat-weapon-main-hand' : 'combat-weapon-off-hand'}>{item.name} <small>{item.slot === 'main-hand' ? 'Główna ręka' : item.slot === 'off-hand' ? 'Druga ręka' : ''}</small></strong>
        <span>{weaponDamage(item)} {damageBonus === null ? '' : `${signed(damageBonus)} obrażeń`} {item.weapon?.damageType ? `· ${item.weapon.damageType}` : ''}</span>
        {rageProfile(character).max > 0 && <small>{ability === 'str' ? `W Szale: dodatkowe +${rageProfile(character).damage} obrażeń (również druga ręka i rzut bronią oparty na Sile).` : 'Premia Szału wymaga ataku opartego na Sile.'}</small>}
        <span>Atak: {attackBonus === null ? 'brak danych' : signed(attackBonus)} · {proficient ? 'biegłość' : 'brak biegłości'}</span>
        {opportunity && <small>Trafienie: 1k20 + modyfikator {ability === 'str' ? 'Siły' : 'Zręczności'}{proficient ? ' + premia z biegłości' : ''} przeciwko KP celu. Obrażenia: kości broni + modyfikator cechy{styleDamageBonus ? ' + premia stylu walki' : ''}.</small>}
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
        {!opportunity && hasProperty(item, 'miotana', 'thrown') && <small>Rzut tą bronią używa tego samego modyfikatora co atak wręcz.</small>}
        {item.weapon?.type === 'dystansowa' && item.weapon.range && <small>Poza normalnym zasięgiem ({item.weapon.range.split('/')[0]} stóp): utrudnienie.</small>}
        {!opportunity && hasProperty(item, 'lekka', 'light') && <small>{statistics.choices?.fightingStyle === 'two-weapon-fighting' ? 'Walka dwiema broniami pozwala dodać modyfikator cechy do obrażeń ataku drugą lekką bronią.' : 'Atak drugą lekką bronią nie dodaje modyfikatora cechy.'}</small>}
        {!opportunity && item.slot === 'off-hand' && <small>Druga ręka: po ataku główną ręką.</small>}
        {!opportunity && item.slot === 'off-hand' && item.weapon?.mastery === 'Nick' && <small>Nick: ten dodatkowy atak możesz wykonać w ramach Akcji zamiast Akcji bonusowej.</small>}
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
              {name === 'Atak okazyjny' && weapons && character && statistics !== undefined && <>
                <p>Wybierz jedną z trzymanych broni wręcz albo cios bez broni. Poniższe wartości są wyliczane z aktualnych cech, biegłości, stylu walki i chwytu broni. Także przy ataku okazyjnym bronią z drugiej ręki dodajesz modyfikator cechy do obrażeń.</p>
                <WeaponList weapons={weapons} character={character} statistics={statistics} showMastery grouped opportunity />
                <UnarmedStrike character={character} statistics={statistics} equippedItems={equippedItems ?? weapons} />
              </>}
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
    const profile = spellcastingProfile(character, statistics.spells, statistics.traits);
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
  const additionalAbilities = combatOtherAbilities(character, statistics);
  const psi = psiResources(character, {});
  const psiInt = statistics?.values.int == null ? null : Math.floor((statistics.values.int - 10) / 2);
  const psiAmount = `1k${psi.psiSides} ${psiInt === null ? '+ modyfikator Inteligencji' : signed(psiInt)}`;
  const equippedWeapons = equippedItems.filter(item => item.weapon);
  const mainHand = equippedWeapons.find(item => item.slot === 'main-hand');
  const offHand = equippedWeapons.find(item => item.slot === 'off-hand');
  const dualWield = Boolean(mainHand && offHand && isMeleeWeapon(mainHand) && isMeleeWeapon(offHand) &&
    isLightWeapon(mainHand) && isLightWeapon(offHand) &&
    mainHand.grip !== 'two' && offHand.grip !== 'two' &&
    !isTwoHandedWeapon(mainHand) && !isTwoHandedWeapon(offHand));
  const actionWeapons = equippedWeapons.filter(item => item.slot !== 'off-hand' || item.weapon?.mastery === 'Nick');
  const bonusWeapons: InventoryItem[] = dualWield && offHand && offHand.weapon?.mastery !== 'Nick' ? [offHand] : [];
  const actionEntries = statistics && characterTraits(character, statistics).feats.includes('Healer')
    ? actions.map(([name, description]) => name === 'Użycie przedmiotu'
      ? [name, `${description} Jeśli masz zestaw uzdrowiciela, możesz zużyć jedno jego użycie i w ramach tej akcji opatrzyć istotę w odległości do 5 stóp od siebie. Ta istota może wydać jedną ze swoich Kości Wytrzymałości, a ty wykonujesz rzut tą kością. Istota odzyskuje liczbę Punktów Wytrzymałości równą wynikowi rzutu plus premia z biegłości: ${signed(statistics.proficiency)}.`] as const
      : [name, description] as const)
    : actions;

  return (
    <div className="combat-tab">
      <div className="inventory-section-heading">
        <div>
          <p className="eyebrow">KARTA BOHATERA</p>
          <h2>Walka</h2>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <SpellResources characterId={character.id} />
      {!!psi.psiMax && <Card title="Psionic Power"><p>Pula Psionic Energy: {psi.psiMax}k{psi.psiSides}. Te kości służą wyłącznie zdolnościom Psi Warriora. Po krótkim odpoczynku odzyskujesz jedną zużytą kość, a po długim wszystkie. Zdolność wymagająca kości jest niedostępna, gdy pula jest wyczerpana.</p></Card>}
      {rageProfile(character).dangerSense && <Card title="Zdolności barbarzyńcy"><p>{dangerSenseDescription}</p></Card>}
      <div className="combat-sections">
        <Card title="Akcja" eyebrow="TURA">
          <ActionList entries={[
            ...(character.species === 'Smokowiec (Dragonborn)' ? [['Broń Oddechowa', `Wydalasz niszczycielską energię w stożku o długości 15 stóp albo linii o długości 30 stóp i szerokości 5 stóp. Cel wykonuje rzut obronny na Zręczność lub Kondycję (ST ${statistics?.values.con == null ? '8 + premia z biegłości + modyfikator Kondycji' : 8 + statistics.proficiency + Math.floor((statistics.values.con - 10) / 2)}). Obrażenia zależą od poziomu i typu wybranego przodka; obszar i rzuty rozstrzyga GM.`] as const] : []),
            ...(psi.psiMax ? [['Telekinetic Movement', 'Akcja Magic: wybierz widoczny cel w 30 stopach — swobodny przedmiot rozmiaru Large lub mniejszy albo inną, chętną istotę. Przenieś go do 30 stóp na widoczne, niezajęte miejsce. Przedmiot Tiny możesz zamiast tego przenieść do swojej ręki lub z niej. Jedno użycie na krótki lub długi odpoczynek; kolejne możesz odzyskać, wydając kość Psionic Energy bez akcji.'] as const] : []),
            ...actionEntries,
          ]} spells={combatSpells.action} weapons={actionWeapons} character={character} statistics={statistics} equippedItems={equippedItems} />
        </Card>
        <Card title="Akcja bonusowa" eyebrow="TURA">
          <ActionList entries={[
            ...(rageProfile(character).max ? [['Szał', rageDescription(character)] as const] : []),
            ...(character.class.includes('Fighter') ? [['Drugi oddech', 'Masz ograniczony zapas fizycznej i mentalnej wytrzymałości, z którego możesz czerpać. W ramach akcji bonusowej możesz go wykorzystać, aby odzyskać punkty życia (PW) w liczbie 1k10 + poziom wojownika.'] as const] : []),
            ...(character.species === 'Ork (Orc)' ? [['Adrenaline Rush', `W ramach akcji bonusowej wykonujesz Zryw i zyskujesz tymczasowe PW równe premii z biegłości (${statistics?.proficiency ?? '—'}). Możesz użyć tej cechy ${statistics ? statistics.proficiency : 'premii z biegłości'} razy na długi odpoczynek.`] as const] : []),
            ...(character.species === 'Smokowiec (Dragonborn)' && character.level >= 5 ? [['Draconic Flight', 'W ramach akcji bonusowej zyskujesz szybkość lotu równą szybkości chodzenia na 10 minut. Możesz użyć tej cechy raz na długi odpoczynek.'] as const] : []),
          ]} spells={combatSpells.bonus} />
          {!!bonusWeapons.length && <WeaponList weapons={bonusWeapons} character={character} statistics={statistics} showMastery />}
          {!rageProfile(character).max && !combatSpells.bonus.length && !bonusWeapons.length && <p className="statistics-help">Brak czarów lub ataków z czasem wykonania „Akcja bonusowa”.</p>}
        </Card>
        <Card title="Reakcje i inne">
          <details className="combat-reactions"><summary className="combat-action-summary">Reakcje</summary>
          <ActionList entries={[
            ...(psi.psiMax ? [['Protective Field', `Gdy ty lub inna widoczna istota w 30 stopach otrzymuje obrażenia, możesz użyć reakcji i wydać jedną kość Psionic Energy. Zmniejsz te obrażenia o ${psiAmount} (minimum 1).`] as const] : []),
            ['Atak okazyjny', 'Możesz wykonać atak okazyjny, gdy widziana przez ciebie istota opuszcza twój zasięg, wykorzystując do tego akcję, akcję bonusową, reakcję lub jedną ze swoich Szybkości. Aby wykonać atak okazyjny, użyj reakcji i wykonaj jeden atak wręcz bronią lub cios bez użycia broni przeciwko prowokującej istocie. Atak następuje bezpośrednio przed opuszczeniem przez nią twojego zasięgu.'],
            ...additionalAbilities.reaction,
            ...(statistics?.choices?.fightingStyle === 'interception'
              ? [['Interception (Przechwycenie)', `Gdy widziana przez ciebie istota trafia inną istotę w odległości do 1,5 metra od ciebie, możesz użyć reakcji, aby zmniejszyć zadane obrażenia o 1k10 ${signed(statistics.proficiency)}. Musisz trzymać tarczę albo broń prostą lub wojenną.`] as const]
              : []),
            ...(statistics?.choices?.fightingStyle === 'protection'
              ? [['Protection (Ochrona)', 'Gdy widziana przez ciebie istota atakuje pobliskiego sojusznika, możesz użyć reakcji i trzymając tarczę narzucić utrudnienie na ten atak. Efekt trwa, dopóki pozostajesz obok chronionego sojusznika.'] as const]
              : []),
          ]} weapons={equippedWeapons} character={character} statistics={statistics} equippedItems={equippedItems} />
          {!!combatSpells.reaction.length && <SpellList spells={combatSpells.reaction} />}
          </details>
          <ActionList entries={[
            ...(psi.psiMax ? [
              ['Psionic Strike — bez akcji', `Raz w każdej swojej turze, bezpośrednio po trafieniu celu w 30 stopach i zadaniu mu obrażeń bronią, możesz wydać jedną kość Psionic Energy. Cel otrzymuje dodatkowe ${psiAmount} obrażeń mocy (Force). Kość nie jest podwajana przy trafieniu krytycznym.`] as const,
              ['Odnowienie Telekinetic Movement — bez akcji', 'Wydaj jedną kość Psionic Energy, aby odzyskać zużyte użycie tej zdolności. Nie rzucasz tą kością.'] as const,
            ] : []),
            ...additionalAbilities.other,
          ]} />
      {rageProfile(character).primalKnowledge && statistics && <details><summary>Primal Knowledge — testy Siły w Szale</summary><p>Możesz zastąpić zwykłą cechę Siłą, zachowując biegłość lub ekspertyzę. Te testy mają ułatwienie dzięki Szałowi.</p><dl className="gm-vitals">{definitions.skills.filter(skill => primalSkills.includes(skill.id)).map(skill => {
        const traits = characterTraits(character, statistics);
        const str = statistics.values.str;
        const extra = traits.skillBonuses[skill.id];
        const bonus = str == null || extra == null ? null : Math.floor((str - 10) / 2) + statistics.proficiency * traits.effectiveSkills[skill.id] + extra;
        return <div key={skill.id}><dt>{skill.label} (Siła)</dt><dd>{bonus == null ? '—' : signed(bonus)} · ułatwienie</dd></div>;
      })}</dl></details>}
        </Card>
      </div>
    </div>
  );
}
