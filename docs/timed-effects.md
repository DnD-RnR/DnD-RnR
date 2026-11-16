# Efekty czasowe i koncentracja

Podstawa: lokalny dokument `C:/Users/micha/Desktop/DnD/SRD_CC_v5.2.pdf`, SRD 5.2, str. 106 (Duration, Combining Spell Effects), 179 (Concentration), 184 (Incapacitated). Zasady ośmiu wdrożonych czarów sprawdzono także w odpowiednich hasłach tego PDF: Aid 107, Bane i Barkskin 112, Bless 113, Longstrider i Mage Armor 145, Shield of Faith 162, Stoneskin 165.

## Model

`shared/timed-effects.mjs` zawiera jawne definicje oraz obliczenia modyfikatorów. `server/timed-effects.mjs` przechowuje każde rzucenie osobno, wiąże je ze źródłem, celami, kręgiem, czasem i identyfikatorem koncentracji. Efekty postaci są zapisywane w zasobach postaci; efekty potworów pozostają w stanie walki.

Różne czary łączą swoje efekty. Wielokrotne rzucenia tego samego czaru nie sumują się: działa silniejszy efekt, a przy równej sile nowszy. Słabsze rzucenia pozostają zapisane i mogą znowu działać po zakończeniu silniejszego. Zakończenie jednego rzucenia nie usuwa niezależnych źródeł.

Koncentrację kończy nowa koncentracja, nieudany rzut po obrażeniach, Incapacitated, śmierć, upływ czasu albo świadoma decyzja gracza. Rzut ma ST `min(30, max(10, floor(damage / 2)))`; obrażenia pochłonięte przez tymczasowe PW również mogą wymagać rzutu. Rozstrzygnięcie następuje przed kolejnymi działaniami. Zakończenie koncentracji nie wymaga akcji i może nastąpić podczas rozstrzygania czaru. Niedokończone rozstrzygnięcie nie może odtworzyć zakończonego efektu.

## Czas gry

Walka odlicza rundy do odpowiedniej tury rzucającego. Efekty nie wygasają od czasu spędzonego przez graczy przed komputerem. Po walce pozostały czas jest zachowywany; kolejna walka ponownie wiąże go z rundami. Poza walką MG przesuwa czas gry formularzem przy odpoczynkach. Krótki odpoczynek przesuwa czas o godzinę, długi o osiem godzin. Operacja przesuwania czasu nie odnawia zasobów i jest blokowana podczas aktywnej walki.

## Wdrożone czary

- Bless i Bane: oddzielne k4 do ataków oraz rzutów obronnych, w tym koncentracji; Bane wymaga początkowego rzutu CHA. Liczba celów skaluje się kręgiem.
- Shield of Faith: +2 KP, koncentracja do 10 minut.
- Longstrider: +10 stóp szybkości, godzina, dodatkowe cele przy wyższych kręgach.
- Stoneskin: odporność na obrażenia obuchowe, kłute i cięte, bez wielokrotnego dzielenia przez dwa.
- Barkskin: KP co najmniej 17, godzina.
- Mage Armor: alternatywna bazowa KP 13 + DEX; tarcza nie jest pancerzem wykluczającym ten czar. Założenie pancerza kończy efekt.
- Aid: zwiększenie bieżących i maksymalnych PW o 5 oraz kolejne 5 za krąg. Zmiany siły i wygaśnięcie cofają właściwą różnicę jednokrotnie. Ponowne wejście do walki nie przyznaje PW drugi raz.

Podstawowe edytowalne statystyki nie zawierają tymczasowych premii. Karta i walka pokazują obliczone KP, szybkość oraz maksymalne PW. Interfejs prezentuje źródła efektów i pozwala rzucającemu zakończyć konkretne rzucenie. Walidacja uprawnień pozostaje na serwerze.

## Granice tego etapu

Poza walką formularz stosuje obsługiwane korzystne efekty do własnej postaci; inne cele i wrogie efekty rozstrzyga MG. Potwierdzenie zasięgu, dobrowolności i komponentów nadal należy do MG. Rytuały i długie czasy rzucania są zapisywane po potwierdzeniu ich ukończenia; wieloturowe rzucanie z możliwością przerwania w trakcie nie jest jeszcze osobnym procesem.

Ten rejestr stanowi podstawę dla kolejnych modyfikatorów, rozpraszania i stref. Nie oznacza automatyzacji wszystkich czarów katalogu. Hold Person przeniesiono do niego w kolejnym etapie, razem z nowymi zaklęciami opisanymi w `docs/conditions.md`. Starsze specyficzne efekty, np. Ray of Enfeeblement, nadal korzystają z dotychczasowych wpisów, ale reagują na wspólne reguły stanów i koncentracji.

Rejestr rozróżnia skończone i nieokreślone czasy efektów oraz granicę początku/końca tury źródła. Zapisuje też, czy rzucający może odwołać czar: chwilowy czar pozostawiający dłuższy skutek (Color Spray, Power Word Stun) nie staje się przez to dobrowolnie odwoływalnym czarem czasowym.
