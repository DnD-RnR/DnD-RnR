# Konflikty zapisu statystyk

Pełny formularz statystyk korzysta z kontroli wersji. Edycja otwarta przed nowszym
zapisem nie może zastąpić aktualnych PW, notatek, wyborów ani pozostałych pól karty.

## Kontrakt API

- `GET /api/characters/:id/statistics` zwraca `{ statistics, revision }`.
- Przy rozpoczęciu edycji klient kopiuje `statistics` oraz zapamiętuje tę samą
  `revision`. Powiadomienia live mogą aktualizować zapisany podgląd, ale nie wersję
  ani zawartość otwartego draftu.
- `POST` na ten sam endpoint przyjmuje dotychczasowe pola oraz `expectedRevision`.
  Sukces zwraca `{ statistics, revision }` z wersją po zapisie.
- Brak lub niepoprawny format wersji: `428`; starsze strony trzeba przeładować.
- Inna wersja: `409`, bez zmiany danych. Klient zachowuje draft i pozwala jawnie
  odrzucić go oraz pobrać aktualną kartę. Nie ponawia zapisu z nową wersją automatycznie.

Wersja jest hashem zapisanych statystyk, danych postaci i danych zbroi wpływających
na wyliczenia formularza. Obejmuje też zmiany wykonane przez walkę, rozwój, wybory
oraz istniejące skrypty korzystające z adaptera. Nie wymaga nowej kolumny,
migracji Firestore, zmian reguł ani dodatkowych odczytów chmurowych: hash powstaje
z lokalnego snapshotu w już wykonywanej transakcji. Przy retry Firestore warunek
jest sprawdzany ponownie na aktualnym stanie.

## Weryfikacja

`server/statistics-concurrency.test.mjs` sprawdza przez HTTP odrzucony stary
formularz, dwa równoczesne zapisy, brak/niepoprawną wersję, autoryzację, zmiany
innych źródeł oraz pierwsze zapisanie pustej karty. Test w `server/firestore.test.mjs`
sprawdza dwa adaptery i ponowienie konfliktującej transakcji bez częściowego zapisu.

Kontrola wersji chroni dane; nie usuwa ograniczeń przepustowości wspólnego dokumentu
root ani limitu pięciu prób transakcji Firestore. Testy adaptera używają modelu
transakcyjnego i nie zastępują pomiaru obciążenia produkcyjnej usługi.
