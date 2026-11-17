# Katalog i pokrycie mechanik czarów

Indeks odniesienia: https://dnd2024.wikidot.com/spell:all

Katalog zawiera wszystkie 525 pozycji indeksu sprawdzonego 16 listopada 2026, w tym dodatki i materiały World of Warcraft. Poprzednia wersja zawierała 423 czary; poprzedni generator filtrował całość do PHB oraz listy Warlocka. Brakowało 102 pozycji. Pełny indeks nie oznacza, że wszystkie czary są dostępne wszystkim klasom: listy klasowe i ograniczenia podklas nadal obowiązują.

## Aktualizacja i sprawdzanie

- `npm run spells:sync`: aktualny indeks oraz opisy, komponenty, źródła, szkoły, zasięgi, czasy i skalowanie wszystkich czarów. Pobieranie stron ograniczone do czterech jednocześnie; katalog jest zapisywany dopiero po udanym odczytaniu wszystkich danych.
- `npm run spells:check`: porównanie aktualnego publicznego indeksu z katalogiem; brakujące/dodatkowe identyfikatory i rozbieżne kręgi powodują niezerowy kod zakończenia.
- `npm run spells:audit`: lokalny raport `docs/spell-coverage.json`, z osobną pozycją dla każdego czaru i liczbami mechanik silnika oraz rozstrzygnięć MG.
- `node scripts/sync-spell-catalog.mjs --check --offline`: kontrola względem ostatnio pobranego indeksu, bez sieci.

`shared/spell-index.json` jest wersjonowanym zapisem sprawdzonej listy. Testy nie potrzebują sieci. Importer zachowuje nazwane efekty i tabele, obsługuje zarówno `Component`, jak i `Components`, a skrypty reklamowe oraz nawigację wyklucza z opisu.

## Co oznacza pokrycie

Pole `engine-with-gm-confirmation` oznacza zdefiniowany mechanizm w `shared/combat-spells.mjs`: rzuty, skalowanie, zasoby i rozliczenie według możliwości silnika. Zasięg, geometria i komponenty wymagają potwierdzenia MG. Dodatkowe uwagi są w polu `gmNote`. Pole to nie oznacza pełnej symulacji każdego efektu w świecie.

`dedicated-handler` oznacza osobny kod (obecnie Hex). `gm` oznacza brak automatycznego rozstrzygnięcia efektu. Nie zaliczamy samej obecności opisu ani formularza wydawania zasobu jako automatyzacji czaru.

Rozpraszanie trwających efektów: [Dispel Magic](dispel-magic.md).

Przerywanie rzucania i reakcje: [Counterspell](counterspell.md).

Upadki, lądowanie i ochrona: [Spadanie oraz Feather Fall](falling.md).

Ochrona przed zerem PW i śmiercią: [Death Ward oraz Power Word Kill](death-ward.md).

Efekty użytkowe: [Protection from Energy, Darkvision i Spider Climb](utility-protection-spells.md).

Eldritch Blast oraz Scorching Ray wybierają cel dla każdego promienia, a każdy promień ma osobny atak, krytyk i obrażenia. Zasób i akcja są wydawane jeden raz. Agonizing Blast dodaje CHA do wybranej sztuczki; przesunięcie z Repelling Blast wymaga ustalenia pozycji przez MG.

Poza walką dostępny jest formularz rzucania czarów i rytuałów. Obsługuje długie czasy rzucania, kontrolę wersji zasobów, historię ostatnich 50 rzuceń, odblokowane źródła i koncentrację. Wizard może wykonać rytuał zapisany w księdze bez przygotowania; nie może wydać slotu na nieprzygotowany rytuał. Efekty poza walką rozstrzyga MG. Nie można używać tego formularza do omijania akcji aktywnej walki.

## Pozostała praca

Raport jawnie wskazuje czary bez mechaniki: między innymi obrażenia opóźnione, utrzymywane strefy, przywołania, przemiany, modyfikatory statystyk, kontrczary i efekty w świecie. To nie są ukończone automatyzacje. Ich poprawna implementacja wymaga kolejnych mechanizmów silnika; nie zastępujemy ich zgadywaniem reguł z angielskiego opisu w trakcie gry.

Ice Storm, Flame Strike i Meteor Swarm korzystają z osobnych komponentów obrażeń, oddzielnych odporności i wspólnego zdarzenia obrażeń dla koncentracji. Reguły i granice automatyzacji: [spell-damage.md](spell-damage.md).

Melf's Acid Arrow i Vitriolic Sphere obsługują początkowe oraz jednorazowe późniejsze obrażenia przez [kolejkę końca następnej tury celu](delayed-spells.md). Samo późniejsze zadanie obrażeń nie zużywa kolejnego zasobu, nie ponawia ataku ani rzutu obronnego, ale ponownie sprawdza aktualną odporność i może wymagać nowego testu koncentracji.

Cloudkill i Incendiary Cloud mają [cykliczne efekty chmur](spell-zones.md): wyzwalacze wejścia, przesunięcia i końca tury, limit raz na turę, obowiązkowy ruch na początku tury rzucającego, czas i koncentrację. MG ustala pozycje oraz widoczność w silnie przesłoniętym obszarze.

Moonbeam i Flaming Sphere mają [ruch aktywowany przez rzucającego](movable-spell-zones.md), odpowiednio za akcję Magic i akcję bonusową. Obsługują odrębne wyzwalacze, skalowanie oraz cofnięcie znanego Wild Shape i blokadę przemiany Moonbeam; inne przemiany oraz pozycje pozostają rozstrzygnięciem MG.

[Spirit Guardians i Wall of Fire](aura-and-wall-spells.md) rozliczają wyłączone cele, typ obrażeń według charakteru, połowę szybkości wewnątrz emanacji oraz wybór gorącej strony ściany. Wall of Fire używa DEX tylko przy utworzeniu ściany; późniejsze wejście i koniec tury mają osobne wyzwalacze bez rzutu obronnego.

[Witch Bolt, Heat Metal i Spiritual Weapon](repeat-spells.md) mają ponawianie efektu akcją bonusową bez kolejnego slotu. Heat Metal rozlicza dodatkowo CON, upuszczenie albo utrudnienie ataków i testów; fizyczny ekwipunek aktualizuje MG.

[Haste i Slow](temporal-spells.md) zmieniają szybkość, KP, rzuty DEX oraz dostępne działania. Haste ma osobną ograniczoną akcję i letarg po zakończeniu; Slow ma powtórne WIS, blokadę reakcji oraz 25% szansy niepowodzenia czaru z S.

[Fly i Enlarge/Reduce](flight-and-size-spells.md) dodają osobną szybkość lotu i zawis, współdzielony ruch chodem/lotem, zmianę rozmiaru, modyfikatory STR oraz kości obrażeń broni i Unarmed Strikes. Upadki i fizyczne zmiany przedmiotów rozstrzyga MG.

[Entangle i Web](binding-spell-zones.md) nakładają niezależne źródła Restrained, rozliczają Athletics ucieczki oraz trudny teren. Web ma osobne wyzwalacze początku tury/pierwszego wejścia, kontrolę zakotwiczenia i płonące fragmenty z 2k4 Fire oraz wypaleniem po rundzie.

[Armor of Agathys, Fire Shield i Sanctuary](protective-spells.md) dodają kolejkę obrażeń po potwierdzonym trafieniu oraz WIS przed kierowanym atakiem lub czarem z obrażeniami. Sanctuary pozwala zmienić cel lub stracić próbę i nie chroni przed obszarami; Armor of Agathys działa z dowolną pozostałą pulą tymczasowych PW według wersji 2024.
