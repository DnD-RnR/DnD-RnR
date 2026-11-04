const styles = [
  { id: 'arcane-warrior', name: 'Arcane Warrior (Tajemny wojownik)', description: 'Uczysz się dwóch sztuczek czarodzieja. Przy ich rzucaniu używasz Inteligencji, Mądrości albo Charyzmy jako cechy czarowania.' },
  { id: 'archery', name: 'Archery (Łucznictwo)', description: 'Zyskujesz premię +2 do rzutów na atak bronią dystansową.' },
  { id: 'blind-fighting', name: 'Blind Fighting (Walka bez wzroku)', description: 'Masz ślepowidzenie w zasięgu 3 metrów (10 stóp).' },
  { id: 'defense', name: 'Defense (Obrona)', description: 'Podczas noszenia lekkiej, średniej albo ciężkiej zbroi zyskujesz premię +1 do KP.' },
  { id: 'dueling', name: 'Dueling (Pojedynek)', description: 'Gdy trzymasz broń do walki wręcz w jednej ręce i nie trzymasz innej broni, zyskujesz premię +2 do obrażeń tą bronią.' },
  { id: 'great-weapon-fighting', name: 'Great Weapon Fighting (Walka ciężką bronią)', description: 'Przy rzucie na obrażenia bronią do walki wręcz trzymaną oburącz możesz traktować wynik 1 lub 2 na kości obrażeń jako 3. Broń musi mieć właściwość Dwuręczna albo Uniwersalna.' },
  { id: 'interception', name: 'Interception (Przechwycenie)', description: 'Reakcją zmniejszasz obrażenia zadane widocznej istocie w odległości do 1,5 metra o 1k10 + premię z biegłości, jeśli trzymasz tarczę lub broń.' },
  { id: 'pack-fighting', name: 'Pack Fighting (Walka w stadzie)', description: 'Zyskujesz +1 do obrażeń ataku wręcz przeciw istocie, gdy obok niej znajduje się nieubezwłasnowolniony sojusznik. Premia rośnie do +2, jeśli ten sojusznik ma ten sam styl.' },
  { id: 'prone-fighting', name: 'Prone Fighting (Walka leżąc)', description: 'Leżąc, nie masz utrudnienia do ataków wynikającego ze stanu Leżący, a ten stan nie daje przewagi na ataki przeciw tobie.' },
  { id: 'protection', name: 'Protection (Ochrona)', description: 'Reakcją i przy użyciu tarczy narzucasz utrudnienie na atak przeciw pobliskiemu sojusznikowi; efekt trwa, dopóki pozostajesz obok niego.' },
  { id: 'thrown-weapon-fighting', name: 'Thrown Weapon Fighting (Walka bronią miotaną)', description: 'Gdy trafisz atakiem dystansowym bronią z właściwością Miotana, zyskujesz +2 do rzutu na obrażenia.' },
  { id: 'two-weapon-fighting', name: 'Two-Weapon Fighting (Walka dwiema broniami)', description: 'Gdy wykonujesz dodatkowy atak dzięki broni z właściwością Lekka, możesz dodać modyfikator cechy do obrażeń, jeśli nie dodajesz go już w inny sposób.' },
  { id: 'unarmed-fighting', name: 'Unarmed Fighting (Walka bez broni)', description: 'Twoje trafienie bez broni może zadać 1k6 + modyfikator Siły obrażeń obuchowych (1k8 bez broni i tarczy), a na początku tury zadajesz 1k4 obrażeń istocie, którą chwytasz.' },
];

export function fightingStyleCount(character) {
  return character.class === 'Wojownik (Fighter)' ? 1 : 0;
}

export function fightingStyleChoicesValid(character, value) {
  return typeof value === 'string' && (value === '' || styles.some(style => style.id === value));
}

export { styles as fightingStyles };
