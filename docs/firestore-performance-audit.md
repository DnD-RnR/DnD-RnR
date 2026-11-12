# Audyt Firebase / Vercel — 12 listopada 2026

## Zakres i wniosek

Zbadano lokalny `master` acd33c1 i zdalny draft [PR #2](https://github.com/DnD-RnR/DnD-RnR/pull/2),
head c4aeab5. Prace: `perf/firestore-sync-audit`. Nie wykonywano zapytań do produkcyjnej
bazy, skryptów administracyjnych, migracji ani zmian reguł. Nie odczytywano sekretów.

Potwierdzony mechanizm nadmiernego zużycia to globalna invalidacja całej bazy po
każdej zmianie, niezależne cache instancji oraz polling również poza walką.
**Nie można przypisać historycznych 25 000 / 18 000 odczytów konkretnej operacji
bez logów z tego przedziału.** Same zbiorcze liczniki Firebase tego nie rozstrzygają.
Nie należy przedstawiać hipotezy jako ustalonego przebiegu incydentu.

## PR #2

Zmiana dwóch transakcji startowych w jedną jest poprawna: `run` najpierw hydratuje
bazę, dopiero potem wykonuje `initializeDatabase(db)`. Retry ponawia całą operację
na świeżym stanie, odpowiedź HTTP czeka na commit. PR nie dodawał testów.
Oszczędność: jeden odczyt root na zimny start, bez zmiany kosztu pobierania kolekcji.
Rozwiązanie zawarto w tym PR wraz z testem jednej transakcji startowej.

## Operacje Firestore i priorytety

| Miejsce | Operacje i konsekwencje |
| --- | --- |
| `server/firestore.mjs:readRows` | Zapytanie każdej z 18 kolekcji. Koszt pełnego pobrania N = suma max(1, liczba dokumentów w kolekcji), także dla pustych kolekcji. |
| `openFirestoreDatabase/run` | Każde żądanie aplikacji i publikacja SSE czyta root transakcyjnie. Wcześniej zmiana globalnej rewizji wymuszała N kolejnych odczytów. Retry powtarza odczyty. |
| Ten sam adapter | Po porównaniu SQLite zapisuje tylko zmienione wiersze, usuwa tylko usunięte wiersze i aktualizuje root raz. Nie zapisuje całej bazy przy każdej mutacji. Limit 450 zmian pozostaje. |
| `api/index.mjs` | `listenerPromise` współdzieli inicjalizację jedynie w danej instancji. Nowa instancja = nowy cache i pełne pobranie. Ciepły health nie pyta ponownie bazy; zimny health inicjalizuje aplikację i może uruchomić inicjalizację katalogów. |
| `server/game-events.mjs` | Po POST i co 20 s odświeża bazę. Wcześniej osobny timer na klienta; wszystkie instancje miały osobny zestaw subskrybentów. Fingerprint oblicza się w SQLite, nie jest samodzielnym zapytaniem Firestore. |
| `scripts/check-firestore.mjs` | Root + pełny odczyt w transakcji. Nie jest tanim pingiem; nie używać jako cyklicznego monitora. |
| `scripts/migrate-firestore.mjs` | Pełny odczyt celu, ewentualne create wierszy i root, potem ponowna pełna weryfikacja. Skrypt nie został uruchomiony. |
| `scripts/seed-origin-feats.mjs` | Root + katalog Origin; set zmienionych featów + root. Starszy protokół rewizji obsługiwany przez fallback. |
| Pozostałe skrypty administracyjne i `server/create-admin.mjs` | Korzystają z adaptera, więc otwarcie oznacza pełne pobranie i inicjalizację. Dotyczy również skryptów inspect/check, heal, reset wyposażenia, seed potworów i zasobów. Żaden nie został uruchomiony. |

Ścieżka danych: `dnd_rnr/main/{table}/{rowId}`. Kolekcje: users, sessions, characters,
games, game_members, game_sessions, session_participants, weapon_catalog,
armor_catalog, item_catalog, character_items, character_statistics, game_monsters,
game_monster_entries, session_battles, character_spell_resources, origin_feat_catalog,
character_advancements. Frontend nie korzysta bezpośrednio z Firebase SDK.

Największy mnożnik przed zmianą: `liczba zaobserwowanych rewizji × liczba instancji × N`.
Przykładowo N=200 i 90 pełnych przeładowań daje 18 000 odczytów, ale nie dowodzi,
że tak wyglądał incydent. Inne źródła do sprawdzenia: zimne starty, preview korzystające
z tej samej bazy, ruch anonimowy, skrypty kontrolne, konsola Firebase i retry.

## HTTP, React i synchronizacja

| Widok / plik | Przed zmianą | Po zmianie |
| --- | --- | --- |
| `LiveBattle.tsx/useBattle` | GET battle co 2 s, także podczas eksploracji | 2 s podczas walki, 10 s poza walką; niezmieniona odpowiedź zachowuje referencję stanu React |
| `PlayerSessionPage.tsx` | Status uczestnictwa co 5 s | Ta sama częstotliwość, bez nakładających się cyklicznych odczytów |
| `CharactersPage.tsx` | Lista co 5 s + focus, brak ochrony przed overlap/unmount | Ta sama częstotliwość, ochrona cyklu życia |
| `GamePage.tsx` | Lista postaci co 20 s + focus | Ta sama częstotliwość, jeden odczyt w locie |
| `SpellResources.tsx` | Zasoby co 10 s + focus | Ta sama częstotliwość, jeden odczyt w locie |
| Wszystkie powyższe | Odpytują również ukryte karty | `lib/poll.ts`: pauza w tle, świeży odczyt przy widoczności/focus; kolejny termin po zakończeniu poprzedniego odczytu |
| `GameSessionPage.tsx` | Każde load: games + items + armors (3 żądania / transakcje) | Jeden autoryzowany `/games/:id/snapshot`, spójny snapshot w jednej transakcji |
| Panel GM / SSE | Reconnect i focus, brak osobnego fallbacku | Dodatkowy fallback co 20 s przy rozłączonym SSE |

Kompromis: rozpoczęcie walki przez inną osobę może zostać wykryte po ok. 10 s,
plus czas odpowiedzi. Po wykryciu aktywnej walki pozostaje 2 s plus czas odpowiedzi.
Własny zapis aktualizuje UI od razu po odpowiedzi. Nie usunięto funkcji gry.

Nie ma potwierdzonej nieskończonej pętli efektów. `MilestoneControls` zależy od
`members`, więc nowe dane sesji ponawiają odczyt historii; nie usunięto tej zależności,
bo odpowiada też za aktualność awansów. Klucz `GamePage` w `PlayerSessionPage`
przemontowuje kartę po zmianie HP — dodatkowe odczyty, ale zapewnia aktualne dane
obrażeń. Zamknięte HTML details nadal montuje komponenty; nie jest lazy loadingiem.
React StrictMode może podwajać startowe efekty w development; nie wyjaśnia sam
tysięcy odczytów na produkcji. Formularze statystyk nie są automatycznie nadpisywane
przez polling. Cache HTTP odpowiedzi użytkowników pozostaje `no-store`.

## Implementacja i bezpieczeństwo danych

Root otrzymuje `tableRevisions` i `trackedRevision` przy następnym zwykłym zapisie.
Nie potrzeba migracji ani nowych kolekcji. Każda transakcja nadal sprawdza aktualny
root. Zmieniają się tylko zapytania odświeżające cache: pobierane są kolekcje, których
wersja się zmieniła, a pozostałe pochodzą ze spójnego lokalnego snapshotu.
Obsługiwane są pominięte rewizje i usunięcia, bez dziennika tombstone.

Brak metadanych, stary writer zwiększający tylko revision lub niezgodny marker
powodują pełny odczyt. Następny nowy zapis unieważnia wtedy wszystkie starsze wersje
tabel. Stare deploymenty nadal działają, choć same nie korzystają z oszczędności.
Bezpośrednie zapisy bez zwiększenia globalnej rewizji pozostają nieobsługiwane,
tak jak wcześniej; nie wykonywać ich poza protokołem adaptera.

Kandydat SQLite trafia do cache wyłącznie po commit. Retry buduje nowego kandydata,
nie powiela zużytego HTTP body. Root pozostaje wspólnym punktem serializacji zapisów.
Nie użyto TTL dla autoryzacji ani zapisu na podstawie niezweryfikowanego cache.
Ponowna inicjalizacja używa istniejącej aplikacji Firebase zamiast błędu duplicate-app.

SSE ma jeden timer na instancję; równoległe publish są łączone. Fingerprint startowy
powstaje w serializowanym kontekście adaptera. Zdarzenia i zamknięcia po reautoryzacji
następują dopiero po sukcesie transakcji, aby retry nie publikował niezatwierdzonego stanu.
Publikacja z innej instancji jest wykrywana przez heartbeat; nie ma wspólnego brokera.
Po wygaśnięciu funkcji przeglądarka reconnectuje; fallback zabezpiecza odczyt GM.

Pozostałe ryzyka: globalny root powoduje contention, SQLite jest wciąż odtwarzany dla
każdej operacji, zimny start nadal czyta N dokumentów, timeout po commit może dać
niepewność klientowi. Wersja walki chroni przed starymi akcjami. Pełne formularze
statystyk nie mają powszechnego optimistic concurrency token — zapis starego formularza
może zastąpić nowsze pola; transakcja adaptera sama tego nie naprawia. To istniejące
ograniczenie, wymagające osobnej zmiany kontraktu formularzy i testów. Lokalny limiter
logowania też nie jest współdzielony przez instancje; nie zmieniano zabezpieczeń w tym PR.

## Testy i pomiar lokalny

Node 22.16.0 / Windows. `npm.cmd test`: **203/203**, 0 błędów; ok. 14,2 s.
`npm.cmd run build`: **sukces**. PowerShell blokuje npm.ps1, dlatego użyto npm.cmd.
Build wymagał wyjścia poza sandbox z powodu odczytu katalogów nadrzędnych przez esbuild.
Pozostają ostrzeżenia o rozmiarach chunków i mieszanych atrybutach importu JSON.

Nowe testy obejmują jedną transakcję startową, brak odczytów kolekcji bez zmiany,
pominięte rewizje, selektywne odczyty, usunięcia, starszych writerów, jednoczesne
zapisy dwóch instancji z retry, siedem instancji, SSE po błędzie i scalanie publish,
autoryzację wspólnego snapshotu oraz polling ukrytych kart i cleanup. Istniejące testy
sprawdzają restart, atomowość walki/statystyk/zasobów i rollback błędów commit.

`npm run perf:firestore` odtwarza 7 instancji, 30 mutacji i 210 kontrolnych odczytów.
Test double ma snapshot transakcji i optimistic conflict/retry. Nie jest emulatorem
Firestore ani testem limitów, blokad, opóźnień i billingów prawdziwej usługi.
Wariant „przed” odtwarza starą globalną invalidację przez brak markera śledzenia;
oba warianty korzystają z jednej transakcji startowej. Oryginalny master miałby
jeszcze 7 dodatkowych odczytów root. Nie jest to porównanie z produkcyjnym ruchem.

| Miara | Globalna invalidacja | Selektywne kolekcje |
| --- | ---: | ---: |
| Transakcje / próby | 247 / 247 | 247 / 247 |
| Odczyty dokumentów, wraz z minimum pustych zapytań | 33 159 | 2 709 |
| Zapytania kolekcji | 3 366 | 408 |
| Pełne przeładowania | 187 | 13 |
| Częściowe przeładowania | 0 | 174 |
| Zapisy dokumentów (w tym root) | 60 | 60 |
| Usunięcia / błędy | 0 / 0 | 0 / 0 |
| Czas ścienny scenariusza | 3 124 ms | 2 978 ms |

Odczyty spadły o **91,8%** w tym scenariuszu. Czas lokalnego SQLite i fake transportu
nie prognozuje opóźnienia prawdziwego Firestore. Nie ma pomiaru produkcyjnego p95.
Panel GM: z kodu i testu równości payloadów wynika redukcja 3 żądań do 1 na load;
nie przeprowadzono testu obciążeniowego przeglądarek siedmiu rzeczywistych graczy.

## Prognoza czterech godzin (nie pomiar)

Założenia: 1 GM + 6 graczy, jedna widoczna karta na osobę, bez błędów/reconnect,
polling przez pełne 4 h. Przybliżenia pomijają czas odpowiedzi i startowe efekty.

| Składnik | Przed | Po: 1 h walki + 3 h eksploracji |
| --- | ---: | ---: |
| 7 obserwatorów battle | 50 400 | 20 160 |
| 6 statusów uczestnictwa co 5 s | 17 280 | 17 280 |
| 6 kart postaci co 20 s | 4 320 | 4 320 |
| Jeden heartbeat GM co 20 s (odczyty bez HTTP) | 720 | 720 |
| Suma bazowych odczytów root | **72 720** | **42 480** |

Zasoby czarów dodają do 8 640 żądań, jeśli zakładka z `SpellResources` jest zamontowana
u wszystkich sześciu graczy przez całe 4 h. Własne akcje, snapshoty GM po zmianach,
publish po POST, zimne starty, reconnecty i retry dochodzą osobno. Liczba uczestników
nie jest liczbą instancji Vercel: jedna instancja może obsługiwać wiele kart.

Model całkowity po zmianie:
`R ≈ rootRequests + startupTransactions + fullReloads*N + Σ(partialQueriesCost) + retries`.
Przed zmianą zamiast częściowych zapytań każde odświeżenie po rewizji kosztowało N.

Przykład warunkowy: N=200, 3 ciepłe instancje, 200 mutacji, średnio 10 dokumentów
na zmienione kolekcje i 2 inne instancje odświeżające każdy zapis: ok. 4 000 odczytów
przyrostowych. Pięć pełnych pobrań to kolejne 1 000; ok. 600 operacji root dla akcji,
publish i snapshotów GM daje razem ok. **48 100 odczytów**. Bez stale otwartej zakładki
zasobów, dodatkowych kart i retry taki scenariusz mieści się blisko limitu.
Siedem instancji lub częstsze akcje może podnieść wynik ponad 60 000.
Cztery godziny ciągłej walki przekraczają darmowy limit samym pollingiem walki.
Nie ma podstaw do gwarantowania bezpłatności każdej sesji na tej architekturze.

Dla 200 mutacji zmieniających średnio 3 wiersze: ok. **800 zapisów** (wraz z root),
plus logowania/startowa inicjalizacja. Usunięcia zależą od konkretnych akcji.
To model, nie odtworzenie historycznych 159 zapisów / 8 usunięć.

## Pomiar po zatwierdzeniu zmian

1. Najpierw izolowany projekt testowy / emulator i konfiguracja preview niezależna
   od produkcji. Nie uruchamiać `db:migrate` jako testu wydajności.
2. `DND_METRICS=1` włącza JSON logi zakończonych żądań `createApp`: instance,
   metoda, znormalizowana trasa bez query, status, durationMs i kumulatywne db.metrics().
   Bez tokenów, cookies, body i treści dokumentów. Zmienna jest domyślnie wyłączona.
3. Liczyć wiersze api_request per trasa/status; p50/p95 z durationMs. SSE mierzy czas
   połączenia do zamknięcia, więc oddzielić `/events` od zwykłych odpowiedzi. Health
   obsługiwany przez wrapper Vercel nie wchodzi do tych logów. Użyć też liczników
   żądań platformy dla pełnego obrazu, w tym błędów inicjalizacji.
4. Dla każdego instance brać najwyższe wartości kumulatywne (nie sumować snapshotów!),
   potem sumować instancje. Pełne/częściowe przeładowania i odczyty uwzględniają retry.
   Zapisy/usunięcia liczone po potwierdzonym commit; błędy sieci mogą pozostawić
   niepewność co do faktycznego zatwierdzenia. Końcowy heartbeat może nie mieć kolejnego
   request logu. To instrumentacja diagnostyczna, nie dokładny rachunek billingowy.
5. Porównać ten sam scenariusz na starej i nowej wersji oraz wykresy dokument reads,
   writes, deletes w Cloud Monitoring/Firebase dla tej samej bazy i przedziału UTC.
   Oddzielić sesję od skryptów, konsoli i preview. Logów historycznych nie da się
   odtworzyć, jeśli wcześniej nie były zbierane.

## Blaze i dalsze kroki

Firestore Standard ma dziennie 50 000 darmowych odczytów, 20 000 zapisów i 20 000
usunięć; jest też limit miejsca i transferu. Limity resetują się według czasu Pacific,
więc jedna sesja miesięcznie nie daje miesięcznej puli operacji do wykorzystania naraz.
Źródło: [oficjalny cennik Firebase](https://firebase.google.com/docs/firestore/pricing).

**Nie ma dowodu, że Blaze jest potrzebny już teraz.** 25 000 odczytów na dobę samo
w sobie nie przekracza darmowego limitu. Zmiany istotnie ograniczają mnożnik kolekcji,
ale obecny polling może nadal przekroczyć limit dnia sesji. Decyzję oprzeć na pomiarze
izolowanego scenariusza, później jednej sesji po zaakceptowanym wdrożeniu.
Nie włączano planu płatnego. Blaze nie naprawia źródła niepotrzebnych odczytów.

Jeśli margines jest niewystarczający: następny krok to wspólny snapshot gracza
(battle + uczestnictwo + dane karty), aby usunąć niezależne timery, oraz lazy mount
zamkniętych kart. Dopiero potem rozważyć wspólny kanał powiadomień lub odczyty
pojedynczych zmienionych dokumentów. Nie dodano dziennika zmian, brokera ani nowej bazy.

Gałąź ma `git.deploymentEnabled["perf/firestore-sync-audit"]=false`, aby publikacja
PR nie uruchamiała automatycznego preview. Reguła dotyczy tylko tej gałęzi, nie master.
Przed świadomym wdrożeniem trzeba zweryfikować rozdzielenie baz Preview/Production.
Źródła: [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration),
[czas działania funkcji](https://vercel.com/docs/functions/configuring-functions/duration),
[współbieżność instancji](https://vercel.com/docs/functions/concurrency-scaling).
