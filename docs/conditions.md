# Wspólny mechanizm stanów — SRD 5.2

Źródło: przekazany plik `C:/Users/micha/Desktop/DnD/SRD_CC_v5.2.pdf`, Rules Glossary: Blinded 177, Deafened 181, Incapacitated 184, Paralyzed/Petrified/Poisoned/Prone 186, Restrained 187, Stunned 189, Unconscious 191. Reguły zaklęć: Blindness/Deafness 113, Color Spray 116, Hold Monster/Hold Person 140–141, Lesser Restoration 144, Power Word Stun 154.

## Stan i jego źródła

`shared/conditions.mjs` oblicza aktywne stany z ręcznych źródeł MG, aktywnych efektów czasowych, starszych wpisów zaklęć oraz 0 PW. Ta sama definicja służy serwerowi i formularzom rzutów. Każde źródło pozostaje niezależne, stan nie sumuje się sam ze sobą, a wygaśnięcie jednego źródła nie usuwa pozostałych.

Obsługiwane stany: Blinded, Deafened, Incapacitated, Paralyzed, Petrified, Poisoned, Prone, Restrained, Stunned, Unconscious.

- Paralyzed, Petrified, Stunned i Unconscious dają Incapacitated oraz automatyczną porażkę rzutów STR/DEX. Incapacitated i Stunned same nie zerują szybkości; pozostałe trzy ją zerują.
- Restrained zeruje szybkość, daje utrudnienie ataków i rzutów DEX oraz ułatwienie ataków przeciw celowi.
- Blinded wpływa na ataki i testy wymagające wzroku. Deafened wpływa tylko na testy wymagające słuchu. Wymagany zmysł wskazuje się przy teście, zgodnie z ustaleniem MG.
- Poisoned daje utrudnienie ataków i testów cech. Petrified zapewnia odporność na wszystkie obrażenia i niewrażliwość na Poisoned; nie daje automatycznego krytyka.
- Prone wymusza czołganie (podwójny koszt ruchu) albo wstanie za połowę szybkości, zaokrągloną w dół. Wstanie nie jest akcją. Przy szybkości 0 nie można wstać. Prone daje utrudnienie własnych ataków; ataki przeciw celowi mają ułatwienie do 5 stóp i utrudnienie dalej.
- Unconscious pozostawia Prone po odzyskaniu przytomności. Trafienia w Unconscious lub Paralyzed są krytyczne tylko z odległości do 5 stóp, którą potwierdza MG. Wszystkie niezależne ułatwienia i utrudnienia znoszą się zgodnie ze zwykłymi zasadami D20.

Utrata koncentracji jest rozliczana natychmiast, również kiedy nowy stan przerwie koncentrację rzucającego i trzeba usunąć jego efekty z innych uczestników. Relentless Rage jest rozstrzygane przed zastosowaniem następstw rzeczywistego pozostania na 0 PW.

Ręczne stany i pozostanie Prone są zapisywane w zasobach postaci. MG może usunąć ręczne źródło, ale nie usunie tym stanu nałożonego przez nadal działające zaklęcie. Lesser Restoration usuwa wybrany stan ze wszystkich jego źródeł na celu. Widoczne stany potworów są udostępniane graczom do poprawnego przygotowania rzutów; statystyki, KP i PW potworów pozostają ukryte.

## Zaklęcia

- Color Spray: obszar wskazuje MG, początkowy rzut CON, Blinded do końca następnej tury rzucającego. Nie używa puli PW z wersji 2014 i nie wymaga koncentracji.
- Blindness/Deafness: wybór jednego stanu, CON, minuta bez koncentracji; dodatkowy cel za wyższy krąg, powtórny CON na końcu każdej tury.
- Hold Monster: WIS, Paralyzed, koncentracja do minuty; dodatkowy cel za wyższy krąg, powtórny WIS na końcu tury. Nie ma ograniczenia do Humanoidów.
- Hold Person: przeniesiony do tego samego rejestru; zachowuje ograniczenie do Humanoidów, WIS i skalowanie liczby celów.
- Power Word Stun: bez początkowego rzutu obronnego. Do 150 bieżących PW włącznie nakłada Stunned do udanego powtórnego CON; nie ma wymyślonego limitu jednej minuty. Powyżej 150 PW tylko zeruje szybkość do początku następnej tury rzucającego. Skutek nie jest koncentracją ani czarem czasowym możliwym do dobrowolnego odwołania przez rzucającego.
- Lesser Restoration: akcja bonusowa, kończy jeden wybrany stan Blinded/Deafened/Paralyzed/Poisoned na dotkniętym celu. Nie leczy Stunned ani Petrified.

Powtórne rzuty są wymagane przed przejściem do następnej tury. Ich wykonanie zamyka możliwość dalszego działania we własnej turze. Śledzenie wykonania rzutu jest zerowane przy nowej walce. Efekty o nieokreślonym czasie pozostają zapisane do właściwego zakończenia, również między walkami.

## Granice

Charmed, Frightened, Grappled, Invisible i Exhaustion 2024 są opisane w [uzupełnieniu stanów](source-conditions.md), razem z zależnościami od źródeł i granicami automatyzacji. Pozycje, szczególne zmysły (np. Blindsight), upuszczanie i podnoszenie przedmiotów, zmiana wagi i starzenie przy Petrified pozostają rozstrzygnięciem MG. Nie modelujemy ich jako ukończonej automatyzacji.

Obsługiwane są typowe ataki, testy, rzuty obronne i ruch w silniku walki; szczególne zdolności i ich własne wyjątki nadal wymagają osobnych definicji. Wrogie efekty poza walką rozstrzyga MG. Ręczne operacje MG służą również odtworzeniu skutków źródeł, których aplikacja jeszcze nie obsługuje.
