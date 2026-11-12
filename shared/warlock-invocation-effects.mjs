import catalog from './spell-catalog.json' with { type: 'json' };
import { invocations, invocationOptions, invocationSource } from './warlock-invocations.mjs';

// Sheet information only: these entries never spend resources or resolve combat.
export const invocationDescriptions = {
  'agonizing-blast': 'Dodajesz modyfikator Charyzmy do rzutów obrażeń wybranej sztuczki.',
  'armor-of-shadows': 'Mage Armor na siebie, bez miejsca na czar. Podczas działania, bez zbroi: KP 13 + modyfikator Zręczności.',
  'ascendant-step': 'Levitate na siebie bez miejsca na czar; koncentracja zgodnie z czarem.',
  'devils-sight': 'Widzisz normalnie w słabym świetle i ciemności, również magicznej, do 120 stóp.',
  'devouring-blade': 'Akcja Ataku bronią paktu daje łącznie trzy ataki zamiast dwóch z Thirsting Blade.',
  'eldritch-mind': 'Ułatwienie rzutów obronnych na Kondycję wykonywanych w celu utrzymania koncentracji.',
  'eldritch-smite': 'Raz na turę po trafieniu bronią paktu wydaj miejsce Pact Magic: dodatkowe (1 + krąg miejsca)k8 obrażeń Force. Możesz powalić cel rozmiaru Huge lub mniejszego.',
  'eldritch-spear': 'Zasięg wybranej sztuczki zwiększa się o 30 stóp za każdy poziom Warlocka.',
  'fiendish-vigor': 'False Life na siebie bez miejsca na czar. Kości tymczasowych PW dają maksymalny wynik: 12 tymczasowych PW przy rzuceniu z 1. kręgu.',
  'gaze-of-two-minds': 'Akcją dodatkową dotykasz chętnej istoty i korzystasz z jej zmysłów do końca swojej następnej tury. Kolejne akcje dodatkowe podtrzymują więź na tej samej płaszczyźnie. Korzystasz z jej specjalnych zmysłów; gdy dzieli was najwyżej 60 stóp, możesz rzucać czary ze swojego lub jej miejsca.',
  'gift-of-the-depths': 'Oddychasz pod wodą i masz szybkość pływania równą swojej Szybkości. Water Breathing bez miejsca raz na długi odpoczynek.',
  'gift-of-the-protectors': 'W Księdze Cieni możesz zapisać za zgodą istot ich imiona: limit równy modyfikatorowi CHA, minimum 1. Spadek zapisanej istoty do 0 PW bez natychmiastowej śmierci pozostawia ją na 1 PW. Wspólne użycie odnawia długi odpoczynek. Dotykając strony, akcją Magic możesz wymazać imię.',
  'investment-of-the-chain-master': 'Chowaniec z Find Familiar otrzymuje lot lub pływanie 40 stóp. Akcją dodatkową wydajesz rozkaz Ataku. Jego obrażenia fizyczne możesz zamienić na Necrotic lub Radiant; używa twojego ST czarów. Reakcją nadajesz mu odporność na otrzymywane obrażenia.',
  'lessons-of-the-first-ones': 'Otrzymujesz wybrany atut pochodzenia. Każdy kolejny wybór tej inwokacji wymaga innego atutu.',
  'lifedrinker': 'Raz na turę trafienie bronią paktu może zadać dodatkowe 1k6 Necrotic, Psychic albo Radiant. Możesz też wydać kość wytrzymałości: leczysz wynik + modyfikator KON, minimum 1 PW.',
  'mask-of-many-faces': 'Disguise Self bez miejsca na czar.',
  'master-of-myriad-forms': 'Alter Self bez miejsca na czar; koncentracja zgodnie z czarem.',
  'misty-visions': 'Silent Image bez miejsca na czar; koncentracja zgodnie z czarem.',
  'one-with-shadows': 'W słabym świetle lub ciemności możesz rzucić Invisibility na siebie bez miejsca na czar.',
  'otherworldly-leap': 'Jump na siebie bez miejsca na czar.',
  'pact-of-the-blade': 'Akcją dodatkową przywołujesz prostą lub żołnierską broń do walki wręcz albo wiążesz dotykaną broń magiczną. Nie może być dostrojona do innej istoty ani związana z innym Warlockiem. Masz biegłość w związanej broni i używasz jej jako fokusu; możesz używać CHA do ataku i obrażeń oraz wybrać zwykły typ obrażeń albo Necrotic, Psychic lub Radiant. Więź kończy ponowne użycie, śmierć lub ponad minuta w odległości większej niż 5 stóp; przywołana broń wtedy znika.',
  'pact-of-the-chain': 'Poznajesz Find Familiar i rzucasz go akcją Magic bez miejsca. Oprócz zwykłych form: Imp, Pseudodragon, Quasit, Skeleton, Slaad Tadpole, Sphinx of Wonder, Sprite, Venomous Snake. W akcji Ataku możesz zrezygnować z jednego własnego ataku, aby chowaniec zaatakował reakcją.',
  'pact-of-the-tome': 'Po krótkim lub długim odpoczynku możesz przywołać Księgę Cieni: wybierz 3 sztuczki i 2 rytuały 1. kręgu z dowolnych list, których nie masz przygotowanych. Gdy masz księgę przy sobie, są przygotowanymi czarami Warlocka. Księga jest fokusem; znika po przywołaniu kolejnej lub twojej śmierci.',
  'repelling-blast': 'Trafiając wybraną sztuczką, możesz odepchnąć cel rozmiaru Large lub mniejszego do 10 stóp prosto od siebie.',
  'thirsting-blade': 'W akcji Ataku możesz wykonać dwa ataki bronią paktu. Dotyczy wyłącznie broni paktu.',
  'visions-of-distant-realms': 'Arcane Eye bez miejsca na czar; koncentracja zgodnie z czarem.',
  'whispers-of-the-grave': 'Speak with Dead bez miejsca na czar.',
  'witch-sight': 'Prawdziwe widzenie (Truesight) do 30 stóp.',
  'call-of-the-void': 'Pact of the Legion pozwala wybrać Fel Imp lub Voidwalker. Akcją dodatkową rozkazujesz chowańcowi atakować; używa twojej premii ataku czarem. Reakcją nadajesz Voidwalkerowi odporność na otrzymywane obrażenia.',
  'curse-of-corruption': 'Wróg rozpoczynający turę pod klątwą twojego czaru Warlocka, np. Hex, wykonuje rzut obronny na CHA. Porażka: obrażenia Necrotic równe twojemu modyfikatorowi CHA.',
  'expendable-minions': 'Gdy twój chowaniec lub kontrolowana przywołana istota ginie, ty albo inna istota do 60 stóp odzyskuje PW równe poziomowi Warlocka + modyfikatorowi CHA.',
  'health-funnel': 'Akcją dodatkową wydajesz dowolną liczbę niewydanych kości wytrzymałości. Do wyniku każdej dodajesz CHA; suma daje tymczasowe PW twojemu chowańcowi lub innemu dowodzonemu Fiendowi.',
  'legion-summoning': 'Raz na długi odpoczynek rzucasz Planar Binding bez miejsca, przywołując jako cel Felguard, Felhound, Incubus albo Succubus.',
  'master-demonologist': 'Dowodzone przez ciebie Fiendy dodają obrażenia przeciw celowi twojego Hex tak jak ty.',
  'pact-of-the-legion': 'Poznajesz Find Familiar i rzucasz go akcją Magic bez miejsca, przywołując Fel Imp. W akcji Ataku możesz oddać jeden atak chowańcowi, który wykonuje go reakcją.',
};
const grantedSpells = {
  'armor-of-shadows': ['mage-armor'], 'ascendant-step': ['levitate'], 'fiendish-vigor': ['false-life'],
  'gift-of-the-depths': ['water-breathing'], 'mask-of-many-faces': ['disguise-self'],
  'master-of-myriad-forms': ['alter-self'], 'misty-visions': ['silent-image'], 'one-with-shadows': ['invisibility'],
  'otherworldly-leap': ['jump'], 'pact-of-the-chain': ['find-familiar'], 'pact-of-the-legion': ['find-familiar'],
  'visions-of-distant-realms': ['arcane-eye'], 'whispers-of-the-grave': ['speak-with-dead'], 'legion-summoning': ['planar-binding'],
};
export function invocationSheet(character, stats) {
  const available = new Set(invocationOptions(character, stats).map(i => i.id));
  return (stats.traits?.invocations ?? []).filter(id => available.has(id)).map(value => {
    const [id, target] = value.split(':');
    const invocation = invocations.find(i => i.id === id);
    const targetName = catalog.spells.find(s => s.id === target)?.name ?? target;
    const cha = stats.values?.cha == null ? null : Math.floor((stats.values.cha - 10) / 2);
    const details = [];
    if (id === 'eldritch-spear') details.push(`Premia zasięgu: +${30 * character.level} stóp.`);
    if (id === 'agonizing-blast' && cha !== null) details.push(`Modyfikator obrażeń: ${cha >= 0 ? '+' : ''}${cha}.`);
    if (id === 'gift-of-the-protectors' && cha !== null) details.push(`Limit imion: ${Math.max(1, cha)}.`);
    if (id === 'expendable-minions' && cha !== null) details.push(`Leczenie: ${character.level + cha} PW.`);
    if (id === 'eldritch-smite') details.push(`Pact Magic: ${(character.level >= 9 ? 5 : character.level >= 7 ? 4 : character.level >= 5 ? 3 : character.level >= 3 ? 2 : 1) + 1}k8 Force.`);
    const ids = id === 'pact-of-the-tome' ? [...(stats.traits?.tomeCantrips ?? []), ...(stats.traits?.tomeRituals ?? [])] : grantedSpells[id] ?? [];
    return { id: value, name: invocation.name + (targetName ? ` — ${targetName}` : ''), source: invocation.source,
      url: invocationSource + '#' + invocation.name.replaceAll(' ', '-'),
      description: invocationDescriptions[id], details,
      spells: ids.map(id => catalog.spells.find(s => s.id === id)).filter(Boolean),
    };
  });
}
