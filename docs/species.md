# Gatunki — SRD 5.2 i Aasimar 2024

Podstawa: [SRD 5.2.1, s. 84–86](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf), [katalog gatunków](https://dnd2024.wikidot.com/species:all), [Aasimar](https://dnd2024.wikidot.com/species:aasimar). Aasimar jest rozszerzeniem z Player’s Handbook, poza listą gatunków SRD.

## Zakres

| Gatunek | Obsługa |
| --- | --- |
| Aasimar | Small/Medium, Humanoid, szybkość 30, Darkvision 60, odporności Necrotic/Radiant, Light z CHA, Healing Hands PBk4 jako akcja Magia, trzy warianty Celestial Revelation od poziomu 3. |
| Dragonborn | Dziesięciu smoczych przodków; zapisane wcześniej wybory typu obrażeń nadal działają. Odporność, Darkvision 60, oddech zastępujący jeden atak: DEX, skalowanie k10, połowa przy sukcesie, PB użyć. Draconic Flight od poziomu 5. |
| Dwarf | Darkvision 120, odporność Poison, ułatwienie przeciw Poisoned, premia maksymalnych PW, Stonecunning z limitem PB i Tremorsense 60 przez 10 minut przy kontakcie z kamieniem. |
| Elf | Drow/High/Wood, cecha czarowania INT/WIS/CHA, czary na poziomach 1/3/5, darmowe użycia wyższych czarów, wymienna sztuczka High Elf. Drow widzi w ciemności na 120 stóp, Wood Elf ma szybkość 35. Keen Senses, Fey Ancestry, Trance i niewrażliwość na magiczny sen są opisane na karcie. |
| Gnome | Small, Darkvision 60, ułatwienie wszystkich rzutów INT/WIS/CHA. Forest: Minor Illusion i Speak with Animals PB razy bez slotu. Rock: Mending, Prestidigitation i rejestr maksymalnie trzech urządzeń. |
| Goliath | Szybkość 35, sześciu przodków, efekty przy trafieniu oraz reakcje, limit PB. Large Form od poziomu 5: Large, +10 szybkości, ułatwienie testów STR. Powerful Build: podwojony udźwig i ułatwienie ucieczki z Grappled. |
| Halfling | Small, szybkość 30, Brave, opcjonalny przerzut k20 z wynikiem 1. Halfling Nimbleness i Naturally Stealthy opisane na karcie; dostępna akcja Hide po potwierdzeniu osłony. |
| Human | Small/Medium, Skillful, Versatile, Resourceful. Inspiracja odnawia się po długim odpoczynku i może zostać zużyta z zapisaniem nowego wyniku k20. |
| Orc | Darkvision 120, Adrenaline Rush PB razy na krótki lub długi odpoczynek, Zryw i tymczasowe PW. Relentless Endurance raz na długi odpoczynek. |
| Tiefling | Small/Medium, trzy dziedzictwa, odpowiednie odporności, czary z wybraną cechą czarowania i osobnymi darmowymi użyciami oraz Thaumaturgy. |

## Obsługa w aplikacji

Wybory gatunkowe są częścią formularza cech. Zdolności aktywne są dostępne w panelu **Zdolności gatunku** podczas walki i w **Zasobach gatunku** na karcie postaci. Efekty przodka Goliata i dodatkowe obrażenia Aasimara wybiera się przy rozliczaniu obrażeń broni lub czaru. Dodatkowy efekt czaru dotyczy jednego wskazanego celu.

MG potwierdza geometrię: obszar oddechu, cele w promieniu 10 stóp, zasięg reakcji, wolne pole teleportacji, miejsce na Large Form, kontakt z kamieniem oraz osłonę większej istoty. Aplikacja nie przechowuje współrzędnych uczestników. Po wybraniu celów oddechu używany jest wspólny mechanizm rzutów obronnych, odporności i obrażeń. Inner Radiance wymaga świeżego potwierdzenia celów przez MG na koniec każdej tury; obejmuje także sojuszników i samego Aasimara, jeśli znajdują się w obszarze.

Healing Hands poza walką automatycznie leczy własną postać. Dotyk innych uczestników i rzuty obronne przeciw Necrotic Shroud obsługuje panel walki. Wynik Stealth dla Naturally Stealthy jest wynikiem rozstrzygniętym z MG; aplikacja zapisuje koszt akcji i ST ukrycia, a sukces daje osobne źródło Invisible. Atak, czar z komponentem werbalnym lub Incapacitated usuwa to źródło; znalezienie postaci, hałas i opuszczenie osłony potwierdza się przez zakończenie Hide. Przechodzenie przez pola większych istot, skutki urządzeń Gnoma, sen i medytację rozstrzyga MG na podstawie opisów. Trance wskazuje czterogodzinny odpoczynek; aplikacja nie odmierza obowiązkowego czasu snu.

Inspirację zużywa się oddzielnie, a zapisany nowy wynik należy podać w rozstrzyganym teście. Luck Niziołka ma osobne pola pierwszej i drugiej k20; serwer odrzuca przerzut innego wyniku niż 1. W testach gatunkowych przeciw stanom należy wskazać Charmed, Frightened albo Poisoned, aby odpowiednie ułatwienie zastosowało się automatycznie. W pozostałych formularzach ręczny wybór ułatwienia i wpisanie wyniku po przerzucie pozostają dostępne.

## Trwałość i czas

Liczniki i efekty znajdują się w zasobach postaci, przechodzą przez eksport/import Firestore i nie odnawiają się przy rozpoczęciu kolejnej walki. API poza walką sprawdza właściciela, wersję zasobów i brak aktywnej walki. Niepoprawne kości lub cele wycofują całą operację.

Efekty wygasają według czasu rzeczywistego lub rund. Przejście między kartą a walką zachowuje pozostały czas. Kontrolka MG przesuwająca czas gry uwzględnia również efekty gatunkowe i ośmiogodzinną trwałość urządzeń Gnoma. Draconic Flight kończy się dodatkowo po Incapacitated. Wygaśnięcie lotu korzysta z istniejących kontrolek upadku. Zakończenie efektu nie zwraca jego użycia.

## Weryfikacja

`node --test server/species.test.mjs` obejmuje wybory linii, progi poziomów, czary i darmowe użycia, odpoczynki, eksport/import zasobów, dziesięciu przodków Smokowca, oddech i lot, odporność Krasnoluda, sześciu przodków Goliata, objawienia i leczenie Aasimara, inspirację Człowieka, urządzenia Gnoma oraz Luck Niziołka. Testy gatunków są też częścią `npm test`.
