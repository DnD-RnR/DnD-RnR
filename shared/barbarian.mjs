import { isIncapacitated } from './conditions.mjs';

export function rageProfile(character) {
  const level = character?.class?.includes('Barbarian') ? character.level : 0;
  return {
    berserker: level >= 3 && character.subclass === 'Path of the Berserker',
    wildHeart: level >= 3 && character.subclass === 'Path of the Wild Heart',
    worldTree: level >= 3 && character.subclass === 'Path of the World Tree',
    zealot: level >= 3 && character.subclass === 'Path of the Zealot',
    fastMovement: level >= 5, feralInstinct: level >= 7,
    brutalDice: level >= 17 ? 2 : level >= 9 ? 1 : 0,
    brutalEffects: level >= 17 ? 2 : level >= 9 ? 1 : 0,
    indomitable: level >= 18,
    max: level ? level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : level >= 3 ? 3 : 2 : 0,
    damage: level ? level >= 16 ? 4 : level >= 9 ? 3 : 2 : 0,
    dangerSense: level >= 2, recklessAttack: level >= 2,
    primalKnowledge: level >= 3, instinctivePounce: level >= 7,
    relentless: level >= 11, persistent: level >= 15,
  };
}
export function barbarianSaveAdvantage(fighter, ability) {
  return Boolean(fighter.barbarianPresence || ability === 'str' && fighter.rage || ability === 'dex' && fighter.rageProfile?.dangerSense
    && !isIncapacitated(fighter) && fighter.hp > 0);
}
export function barbarianAttackAdvantage(actor, target, ability) {
  return Boolean(actor.barbarianPresence || target?.recklessActive || actor.recklessActive && ability === 'str');
}
export const indomitableTotal = (fighter, ability, total) => fighter.rageProfile?.indomitable && ability === 'str' ? Math.max(total, fighter.strengthScore ?? 0) : total;
export const mindlessImmune = (fighter, condition) => Boolean(fighter.rage && fighter.rageProfile?.berserker && fighter.level >= 6 && ['charmed', 'frightened'].includes(condition));
export const brutalSaveDisadvantage = fighter => Boolean(fighter.brutalEffects?.some(e => e.kind === 'stagger-save'));
export const consumeBrutalSave = fighter => { fighter.brutalEffects = (fighter.brutalEffects ?? []).filter(e => e.kind !== 'stagger-save'); };
export function lionDisadvantage(b, actor, target) {
  return b.fighters.some(f => f.rage?.power === 'lion' && f.rage.lionTargets?.includes(actor.id) && target?.id !== f.id && target?.rage?.power !== 'lion');
}
export const dangerSenseDescription = 'Danger Sense: od 2. poziomu masz ułatwienie rzutów obronnych na Zręczność, chyba że jesteś Obezwładniony (również podczas Nieprzytomności). Nie wymaga Szału.';
export const recklessAttackDescription = 'Reckless Attack: od 2. poziomu przy pierwszym rzucie na atak we własnej turze możesz zdecydować się na brawurowy atak. Do początku twojej następnej tury rzuty na atak oparte na Sile mają ułatwienie, ale wszystkie rzuty na atak przeciwko tobie również mają ułatwienie. Nie wymaga Szału ani dodatkowej akcji.';
export const primalSkills = ['acrobatics', 'intimidation', 'perception', 'stealth', 'survival'];
export const barbarianFeatureDescriptions = {
  'Fast Movement': 'Od 5. poziomu: +10 stóp szybkości bez ciężkiej zbroi.',
  'Feral Instinct': 'Od 7. poziomu: inicjatywa z ułatwieniem; w kreatorze walki możesz podać dwie k20.',
  'Brutal Strike': 'Raz we własnej turze zrezygnuj z ułatwienia ataku STR przy Reckless Attack, bez utrudnienia. Trafienie dodaje 1k10 i opcjonalny efekt: odepchnięcie 15 stóp z własnym ruchem do połowy szybkości albo spowolnienie celu o 15 stóp do początku następnej tury.',
  'Improved Brutal Strike': 'Od 13. poziomu dostępne są Staggering Blow (utrudnienie następnego rzutu obronnego i brak ataków okazyjnych) oraz Sundering Blow (+5 do następnego ataku innej istoty). Od 17. poziomu: 2k10 i do dwóch różnych efektów.',
  'Indomitable Might': 'Od 18. poziomu wynik testu lub rzutu obronnego STR może być równy wartości Siły, jeśli normalny wynik jest niższy.',
  'Mindless Rage': 'Podczas Szału od 6. poziomu Berserker nie podlega Charmed ani Frightened; aktywacja kończy te stany.',
  Retaliation: 'Od 10. poziomu Berserker może po otrzymaniu obrażeń od istoty w 5 stopach zużyć reakcję na atak wręcz przeciw niej.',
  'Intimidating Presence': 'Akcja dodatkowa od 14. poziomu: wybrane istoty w 30 stopach wykonują WIS przeciw 8 + STR + biegłość. Porażka: Frightened przez minutę, z powtórnym rzutem na koniec każdej tury. Raz na długi odpoczynek; użycie Szału może odnowić zdolność.',
  'Aspect of the Wilds': 'Od 6. poziomu wybierz Owl (Darkvision +60 stóp), Panther (szybkość wspinaczki równą szybkości) albo Salmon (analogiczna szybkość pływania). Zmiana po długim odpoczynku.',
  'Power of the Wilds': 'Od 14. poziomu przy aktywacji Szału wybierz Falcon (lot bez pancerza), Lion (utrudnienie ataków pobliskich wrogów przeciw innym celom) albo Ram (powalenie celu najwyżej Large po trafieniu wręcz).',
  'Vitality of the Tree': 'Szał daje tymczasowe PW równe poziomowi. Na początku własnej tury w Szale inna istota w 10 stopach może otrzymać k6 w liczbie równej premii obrażeń Szału; pozostałe PW tej istoty znikają wraz z tym Szałem.',
  'Branches of the Tree': 'Od 6. poziomu: reakcja na początek tury widzianej istoty w 30 stopach. Porażka STR przeciw 8 + STR + biegłość teleportuje ją obok barbarzyńcy; można zatrzymać jej ruch do końca bieżącej tury.',
  'Battering Roots': 'Od 10. poziomu we własnej turze zasięg broni wręcz Heavy lub Versatile jest większy o 10 stóp. Trafienie pozwala użyć dodatkowego Push albo Topple.',
  'Travel along the Tree': 'Od 14. poziomu teleportacja 60 stóp przy aktywacji Szału albo akcją dodatkową w Szale. Raz na Szał: 150 stóp i do sześciu chętnych pasażerów z 10 stóp; miejsce docelowe w 10 stopach od celu teleportacji.',
  'Divine Fury': 'W Szale pierwsze trafienie bronią lub bez broni we własnej turze zadaje dodatkowe 1k6 + połowę poziomu (w dół). Wybierz Necrotic albo Radiant.',
  'Warrior of the Gods': 'Akcja dodatkowa: wydaj własne k12 leczenia. Pula 4 kości, potem 5/6/7 na poziomach 6/12/17; odnowienie po długim odpoczynku.',
  'Fanatical Focus': 'Od 6. poziomu raz na aktywny Szał: po nieudanym rzucie obronnym przerzuć k20, dodając premię obrażeń Szału. Nowy wynik jest wiążący.',
  'Zealous Presence': 'Od 10. poziomu akcją dodatkową daj do dziesięciu innym istotom w 60 stopach ułatwienie ataków i rzutów obronnych do początku następnej tury. Raz na długi odpoczynek; można odnowić użyciem Szału.',
  'Rage of the Gods': 'Od 14. poziomu raz na długi odpoczynek przy aktywacji Szału: boska forma na minutę lub do 0 PW, lot z zawisem i odporność na Necrotic/Psychic/Radiant. Reakcja i użycie Szału mogą pozostawić istotę w 30 stopach na PW równych poziomowi zamiast 0.',
};
export const rageDamageTypes = ['obuchowe', 'kłute', 'cięte', 'bludgeoning', 'piercing', 'slashing'];
export function rageDescription(character) {
  const p = rageProfile(character);
  if (!p.max) return '';
  return `Szał: ${p.max} użycia; odzyskujesz 1 po krótkim i wszystkie po długim odpoczynku. Wchodzisz w Szał akcją dodatkową, bez ciężkiej zbroi. Odporność na obrażenia obuchowe, kłute i cięte; +${p.damage} do obrażeń ataków bronią i bez broni opartych na Sile; ułatwienie testów i rzutów obronnych na Siłę. Nie możesz rzucać czarów, a koncentracja zostaje przerwana. ${p.persistent ? 'Persistent Rage: trwa 10 minut bez przedłużania; kończy się przy Nieprzytomności lub założeniu ciężkiej zbroi. Przy inicjatywie możesz odzyskać wszystkie użycia raz na długi odpoczynek.' : 'Trwa do końca następnej tury. Atak na wroga (również chybiony), wymuszenie na wrogu rzutu obronnego lub akcja dodatkowa przedłużają go do końca następnej tury, maksymalnie do 10 minut. Kończy się przez Obezwładnienie lub ciężką zbroję.'}${p.primalKnowledge ? ' Primal Knowledge: w Szale możesz używać Siły do Akrobatyki, Zastraszania, Percepcji, Skradania się i Sztuki przetrwania, zachowując biegłość i ułatwienie.' : ''}${p.instinctivePounce ? ' Instinctive Pounce: przy aktywacji możesz poruszyć się do połowy Szybkości.' : ''}${p.relentless ? ` Relentless Rage: spadek do 0 PW bez natychmiastowej śmierci pozwala wykonać rzut obronny na Kondycję (ST 10, +5 przy każdym kolejnym użyciu; reset po krótkim lub długim odpoczynku). Sukces daje ${2 * character.level} PW zamiast 0.` : ''}`;
}

export const wildHeartAnimals = ['bear', 'eagle', 'wolf'];
export const barbarianLevel3Features = {
  primalKnowledge: { level: 3, skillChoices: ['animalHandling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'], strengthSkills: primalSkills },
  berserker: { level: 3, name: 'Frenzy', description: 'Podczas Szału i Reckless Attack pierwsze trafienie atakiem z Siły we własnej turze dodaje k6 w liczbie równej premii obrażeń Szału. Typ obrażeń pozostaje taki sam; krytyk podwaja kości.' },
  wildHeart: { level: 3, name: 'Rage of the Wilds', options: [
    { id: 'bear', description: 'Odporność na wszystkie typy obrażeń poza force, necrotic, psychic i radiant podczas Szału.' },
    { id: 'eagle', description: 'Dash i Disengage przy aktywacji Szału oraz razem jako akcja dodatkowa podczas Szału.' },
    { id: 'wolf', description: 'Sojusznicy mają ułatwienie wszystkich ataków przeciw twoim wrogom w odległości 5 stóp od ciebie podczas Szału.' },
  ], rituals: ['beast-sense', 'speak-with-animals'], spellcastingAbility: 'wis' },
};
const bearDamageTypes = ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder', 'kwas', 'zimno', 'ogień', 'błyskawice', 'trucizna', 'grom'];
export function barbarianResistance(fighter, type) {
  const damageType = type?.toLowerCase();
  return Boolean(fighter?.rage && (rageDamageTypes.includes(damageType)
    || fighter.rage.animal === 'bear' && bearDamageTypes.includes(damageType)))
    || Boolean(fighter?.epicNightSpirit && fighter.epicDim && !['psychic', 'radiant', 'psychiczne', 'promieniste'].includes(damageType))
    || Boolean(fighter?.divineForm && ['necrotic', 'psychic', 'radiant', 'nekrotyczne', 'psychiczne', 'promieniste'].includes(damageType));
}
export function wolfAttackAdvantage(battle, actor, target) {
  return Boolean(target && battle.fighters.some(f => f.id !== actor.id && Boolean(f.characterId) === Boolean(actor.characterId)
    && f.rage?.animal === 'wolf' && f.hp > 0 && !f.incapacitated && !f.unconscious
    && f.rage.wolfTargets?.includes(target.id)));
}
export function frenzyDice(battle, actor, ability) {
  return actor.rageProfile?.berserker && actor.rage && actor.recklessActive && !actor.frenzyUsed
    && ability === 'str' && battle.fighters[battle.turn]?.id === actor.id ? actor.rageProfile.damage : 0;
}
