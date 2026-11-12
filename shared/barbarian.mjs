export function rageProfile(character) {
  const level = character?.class?.includes('Barbarian') ? character.level : 0;
  return {
    max: level ? level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : level >= 3 ? 3 : 2 : 0,
    damage: level ? level >= 16 ? 4 : level >= 9 ? 3 : 2 : 0,
    dangerSense: level >= 2, recklessAttack: level >= 2,
    primalKnowledge: level >= 3, instinctivePounce: level >= 7,
    relentless: level >= 11, persistent: level >= 15,
  };
}
export function barbarianSaveAdvantage(fighter, ability) {
  return Boolean(ability === 'str' && fighter.rage || ability === 'dex' && fighter.rageProfile?.dangerSense
    && !fighter.incapacitated && !fighter.unconscious && fighter.hp > 0);
}
export function barbarianAttackAdvantage(actor, target, ability) {
  return Boolean(target?.recklessActive || actor.recklessActive && ability === 'str');
}
export const dangerSenseDescription = 'Danger Sense: od 2. poziomu masz ułatwienie rzutów obronnych na Zręczność, chyba że jesteś Obezwładniony (również podczas Nieprzytomności). Nie wymaga Szału.';
export const recklessAttackDescription = 'Reckless Attack: od 2. poziomu przy pierwszym rzucie na atak we własnej turze możesz zdecydować się na brawurowy atak. Do początku twojej następnej tury rzuty na atak oparte na Sile mają ułatwienie, ale wszystkie rzuty na atak przeciwko tobie również mają ułatwienie. Nie wymaga Szału ani dodatkowej akcji.';
export const primalSkills = ['acrobatics', 'intimidation', 'perception', 'stealth', 'survival'];
export const rageDamageTypes = ['obuchowe', 'kłute', 'cięte', 'bludgeoning', 'piercing', 'slashing'];
export function rageDescription(character) {
  const p = rageProfile(character);
  if (!p.max) return '';
  return `Szał: ${p.max} użycia; odzyskujesz 1 po krótkim i wszystkie po długim odpoczynku. Wchodzisz w Szał akcją dodatkową, bez ciężkiej zbroi. Odporność na obrażenia obuchowe, kłute i cięte; +${p.damage} do obrażeń ataków bronią i bez broni opartych na Sile; ułatwienie testów i rzutów obronnych na Siłę. Nie możesz rzucać czarów, a koncentracja zostaje przerwana. ${p.persistent ? 'Persistent Rage: trwa 10 minut bez przedłużania; kończy się przy Nieprzytomności lub założeniu ciężkiej zbroi. Przy inicjatywie możesz odzyskać wszystkie użycia raz na długi odpoczynek.' : 'Trwa do końca następnej tury. Atak na wroga (również chybiony), wymuszenie na wrogu rzutu obronnego lub akcja dodatkowa przedłużają go do końca następnej tury, maksymalnie do 10 minut. Kończy się przez Obezwładnienie lub ciężką zbroję.'}${p.primalKnowledge ? ' Primal Knowledge: w Szale możesz używać Siły do Akrobatyki, Zastraszania, Percepcji, Skradania się i Sztuki przetrwania, zachowując biegłość i ułatwienie.' : ''}${p.instinctivePounce ? ' Instinctive Pounce: przy aktywacji możesz poruszyć się do połowy Szybkości.' : ''}${p.relentless ? ` Relentless Rage: spadek do 0 PW bez natychmiastowej śmierci pozwala wykonać rzut obronny na Kondycję (ST 10, +5 przy każdym kolejnym użyciu; reset po krótkim lub długim odpoczynku). Sukces daje ${2 * character.level} PW zamiast 0.` : ''}`;
}
