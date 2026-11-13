# Synchronizacja po zatwierdzonym zapisie — 13 listopada 2026

## Co się zmienia

Poprzedni etap zmniejszał koszt odpowiedzi na pytanie „czy coś się zmieniło?”.
Ten etap zastępuje regularne pytania powiadomieniem „zapisano zmianę”.

1. Transakcja zapisuje dane i rewizję root atomowo, jak dotychczas.
2. Firebase Admin SDK nasłuchuje `dnd_rnr/main` przez `onSnapshot`.
3. Każda instancja mająca aktywnych odbiorców otrzymuje sygnał z Firestore,
   również jeśli zapis pochodzi z innej instancji albo skryptu używającego adaptera.
4. Serwer sprawdza sesje odbiorców w transakcji i wysyła przez SSE pusty komunikat.
5. Przeglądarka odświeża aktywne widoki przez dotychczasowe autoryzowane API.

Nie dodano brokera, nowej kolekcji, Firebase Auth ani dostępu do Firestore z przeglądarki.
Nie zmieniono reguł bezpieczeństwa. Cały dostęp do danych nadal przechodzi przez serwer.

## Pliki i zachowanie

- `server/firestore.mjs`: `watchChanges`, metryki watchStarts/watchStops/watchReads.
  Listener jest zatrzymywany także przy zamknięciu adaptera.
- `server/game-events.mjs`: jeden listener root na instancję z odbiorcami, wspólny
  heartbeat bez zapytań do bazy, reautoryzacja przed powiadomieniem, obsługa błędów.
  Sygnały w trakcie odświeżania wymuszają kolejne przejście; nie są ignorowane.
  Efekty sieciowe następują po zatwierdzeniu transakcji, poza callbackiem retry.
- `server/index.mjs`: nowy `/api/sync/events` dla zalogowanych użytkowników.
  Przy Firestore nie publikuje drugi raz po HTTP POST — źródłem sygnału jest commit.
  Dla SQLite bez `watchChanges` zachowany jest sygnał po udanym POST.
- `src/lib/live-sync.ts`: jedno połączenie SSE na kartę przeglądarki, współdzielone
  przez widoki; pierwszy load, odświeżenie po ready/change, focus i powrocie do karty.
  Nie nakłada odczytów; zapamiętuje sygnał, który nadszedł podczas trwającego odczytu.
- Dołączone widoki: walka, uczestnictwo, lista postaci, karta postaci, ekwipunek,
  statystyki, zasoby i snapshot GM. Aktualizacja zapisanych statystyk nie zmienia
  niezapisanego lokalnego draftu formularza. Pozostałe jednorazowe formularze
  zachowują swój cykl życia; ta zmiana nie zamienia wszystkich formularzy w edytory live.
- `server/request-listener.mjs` i `api/index.mjs`: invocation czeka do zakończenia
  lub zerwania SSE. Błąd autoryzacji nie zostawia oczekującego handlera.
- `vercel.json`: maksymalny czas funkcji 60 s. Serwer zamyka stream po 45 s,
  pozostawiając czas na inicjalizację i zakończenie; klient wznawia połączenie.
  Gdy inicjalizacja trwa dłużej lub platforma przerwie połączenie wcześniej,
  reconnect i fallback pozostają aktywne.

Stary endpoint SSE GM pozostaje kompatybilny, ale aktualny frontend już go nie otwiera.
Zamiast `poll.ts` i testu poll używane są `live-sync.ts` i `live-sync.test.mjs`.

## Zerwanie połączenia i bezpieczeństwo

Przeglądarka zamyka SSE w ukrytej karcie i odtwarza je po powrocie. Ostatni
odbiorca w instancji zwalnia listener Firestore oraz timery. Każde wznowienie
potwierdzone komunikatem ready powoduje świeży odczyt widoków: nie potrzeba
trwałego dziennika zdarzeń ani odtwarzania każdej pominiętej zmiany.

Przy niedostępnym SSE klient próbuje reconnect z odstępem 1, 2, 4… do 30 s;
fallback odświeża dane co 30 s. Przy zdrowym połączeniu zabezpieczenie ma odstęp
120 s, liczony od ostatniego odświeżenia. Reconnect może ten termin przesunąć,
bo sam wykonuje świeży load. W żadnym z tych przypadków nie ma timera 2/5/10 s.
Brak obsługi EventSource w przeglądarce także uruchamia fallback 30 s.

Przekazywane są wyłącznie `ready`, `change` lub `expired` z `data: {}`.
Nie wysyła się rewizji, nazw tabel, tokenów ani treści dokumentów. Użytkownik
otrzymuje ogólne powiadomienie o zapisie w aplikacji, a nie prywatne dane innej gry.
Na potrzeby jednej drużyny jest to celowo ogólny sygnał: zmiana może odświeżyć
także widoki użytkownika, którego nie dotyczy. Przy wielu niezależnych drużynach
należy ograniczyć routing sygnałów do drużyny/użytkownika, także ze względu na
możliwość obserwacji samego faktu występowania zapisów.

Sesja jest sprawdzana przy otwieraniu strumienia oraz przed powiadomieniem.
Wygaśnięcie cookies sesyjnych ma dodatkowy timer zamknięcia; usunięcie sesji
w bazie wywołuje expired i zamknięcie. Przeglądarka wraca wtedy do logowania.
Niezależnie od kanału SSE każdy GET/POST nadal osobno autoryzuje dostęp.
Pusty sygnał nie uprawnia do odczytu jakichkolwiek danych.

## Koszty: nie ma darmowych, wiecznych połączeń

Heartbeat w otwartym streamie nie wykonuje żadnych operacji Firestore. Listener
root kosztuje odczyt początkowy i odczyty zmienionego dokumentu; obejmuje wyłącznie
root, nie wszystkie kolekcje. Przy sygnale dochodzi jedna transakcja odświeżająca
cache i sprawdzająca sesje na instancję oraz żądania aktywnych widoków klientów.
Selektywne pobieranie kolekcji z pierwszego etapu nadal działa.

SSE na Vercel ma ograniczony czas życia. **Wznowienia nadal generują odczyty**:
autoryzację połączenia, ponowne sprawdzenie stanu i odświeżenie widoków. Jeśli
instancja nie ma wtedy innych odbiorców, otwiera też ponownie listener root.
To nie jest obietnica zerowego zużycia podczas czterech godzin bezczynności.

Test frontendowy modeluje 4 h bez zapisów, 7 identycznych widocznych kart, po 4
subskrybowane widoki, stream 45 s i reconnect 1 s. Wynik:

| Miara | Model |
| --- | ---: |
| Stare trzy timery 2/5/20 s, wszystkie karty | 75 600 GET |
| Nowe cztery widoki: start i odtworzenie stanu po reconnect | 8 820 GET |
| Otwarcia SSE | 2 198 |

To deterministyczny model klienta z fałszywym zegarem, nie pomiar sieci ani billingu.
Układ identycznych kart służy porównaniu mechanizmu, a nie odwzorowaniu GM + 6 graczy.
Nowy czwarty widok obejmuje ekwipunek, który wcześniej nie miał osobnego pollingu.
Same GET spadły o ok. 88%; otwarć SSE nie wolno pomijać przy szacowaniu całego kosztu.

W pesymistycznym modelu 7 oddzielnych, ale ciepłych instancji do 8 820 odczytów
root dla GET dochodzi ok. 3 × 2 198 odczytów sterujących połączeniami, czyli razem
ok. **15 400 odczytów przy braku zapisów**, plus starty aplikacji i kolekcje pobrane
przy zimnym starcie. Nie jest to prognoza gwarantowana: liczba widoków, instancji,
zimnych startów, zapisów i retry zmienia wynik. Gdy każda nowa funkcja jest zimna,
koszt pełnego pobrania bazy może nadal być duży.

Dla realnej sesji doliczyć:
`listenerReads po commit + transakcje reautoryzacji + GET po zmianach + selektywne
odczyty kolekcji + mutacje + retry + zimne starty`.
Nie należy mnożyć poprzedniej oszczędności 91,8% przez obecne 88% i nazywać wyniku
gwarantowaną redukcją billingu — są to różne syntetyczne scenariusze.

Otwarte funkcje SSE mogą też zużywać limity Vercel związane z czasem/memory.
Nie uruchomiono płatnej usługi i nie zmieniono planu, ale przesunięcie części kosztu
z częstych zapytań na utrzymywane połączenia trzeba zweryfikować przed wdrożeniem.

## Weryfikacja i wdrożenie

`npm.cmd test`: 213 testów, wszystkie przeszły. `npm.cmd run build`: sukces,
z istniejącymi ostrzeżeniami o chunkach i atrybutach importu JSON.

Testy obejmują zapis w innej instancji, brak powiadomienia po rollback,
brak odczytów na heartbeat, jeden listener dla kilku odbiorców, reautoryzację,
zerwanie watch, zwalnianie listenerów, zakończenie streamu przed deadline,
commit w trakcie dostarczania poprzedniego sygnału, brak danych prywatnych w SSE,
autoryzację endpointu, wspólny transport klienta, wolne GET, reconnect, fallback,
ukryte karty, wygaśnięcie sesji i czas życia invocation Vercel.

Test adaptera korzysta z transakcyjnego modelu Firestore i mocka onSnapshot.
Nie przeprowadzono testu prawdziwego połączenia gRPC na Vercel ani pomiaru
Firebase/Vercel w chmurze. **Nie wdrożono kodu i nie połączono się z produkcyjną bazą.**
Przed zatwierdzonym wdrożeniem sprawdzić ten sam scenariusz na izolowanym projekcie:
7 użytkowników, druga instancja zapisująca, zerwanie sieci, wylogowanie, bezczynność,
częste mutacje, wznowienia streamu i liczniki obu platform.

`DND_METRICS=1` pokazuje także watchReads/watchStarts/watchStops; documentReads
zawiera już watchReads, więc nie dodawać ich ponownie. Zachowują zastosowanie
zasady agregacji per instance z audytu. Wszystkie metryki aplikacji są diagnostyczne;
rzeczywiste rozliczenie należy porównać z wykresami dostawcy.

Reguła blokująca automatyczny deployment gałęzi audytowej nadal obowiązuje.
Nie wykonywać migracji ani zmiany reguł Firestore do uruchomienia tej funkcji.

Źródła: [Firestore: koszt listenerów](https://firebase.google.com/docs/firestore/pricing),
[Node SDK: preferRest i listener korzystający z gRPC](https://github.com/googleapis/nodejs-firestore/blob/main/dev/src/index.ts),
[Vercel streaming](https://vercel.com/docs/functions/streaming-functions),
[Vercel maxDuration](https://vercel.com/docs/functions/configuring-functions/duration).
