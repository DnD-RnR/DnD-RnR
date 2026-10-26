# DnD-RnR

## Usuwanie ekwipunku przez GM

W panelu gry rozwiń **Postać i ekwipunek**, a przy przedmiocie wybierz
**Usuń przedmiot**. Wskaż liczbę sztuk i potwierdź operację. Usunięcie części
zmniejsza ilość, a usunięcie wszystkich sztuk usuwa pozycję z ekwipunku.
Dotyczy to również przedmiotów założonych; częściowe usunięcie zachowuje ich
założenie. API sprawdza aktualną ilość oraz zaakceptowaną przynależność postaci
do gry prowadzonej przez tego GM. Nie jest wymagany udział w aktywnej sesji.
Zmiana nie usuwa wzoru z katalogu i powiadamia otwarte panele GM przez SSE.

## Aktualizacje panelu GM

Panel GM odbiera powiadomienia SSE z `/api/games/:id/events` zamiast pobierać dane
co 15 sekund. Po udanym zapisie przez API serwer porównuje bieżący widok gry
z poprzednim i wysyła sygnał tylko wtedy, gdy zmieniły się dane tej gry lub katalog
przedmiotów. Dotyczy to m.in. udziału w sesji, statystyk, ekwipunku i członkostwa.
Sygnał nie zawiera danych postaci; aktualne dane są pobierane przez istniejące API.

Po przerwaniu połączenia przeglądarka automatycznie łączy się ponownie i pobiera
aktualny stan, zachowując rozwinięte karty. Nadal działa „Odśwież drużynę” oraz
odświeżenie po powrocie do karty. Połączenie wymaga sesji prowadzącego GM;
serwer ponownie sprawdza dostęp przy zmianach i sygnałach podtrzymania połączenia.
Reverse proxy powinno wyłączać buforowanie dla strumienia SSE.

Powiadomienia obejmują zapisy przez ten proces API. Ręczne zmiany SQLite lub
zapisy przez inny proces wymagają ręcznego odświeżenia. Lista postaci i widok
gracza nadal sprawdzają stan co 5 sekund.

## Statystyki drużyny dla GM

Postacie w panelu gry są ułożone w zwartej siatce: na komputerze trzy kolumny
(sześć postaci w dwóch rzędach), na bardzo szerokim ekranie sześć kolumn,
a na mniejszych ekranach dwie lub jedna kolumna, bez przewijania w bok.
Szczegóły postaci i ekwipunek są rozwijane. Karty koncentrują się na podróży i eksploracji:
szybkość, pasywna Percepcja, premie do Atletyki, Akrobatyki, Skradania się,
Percepcji, Sztuki przetrwania, Śledztwa, Przyrody, Opieki nad zwierzętami oraz
poziom wyczerpania. Statystyki walki (PW, KP, inicjatywa, rzuty obronne i magia)
nie są pokazywane w tym widoku; pozostają zapisane na karcie postaci.

Wartości są wyprowadzane z zapisanej karty postaci i tego samego modułu cech,
który obsługuje widok gracza, z uwzględnieniem automatycznych biegłości i premii.
Brak danych oznacza kreskę. Nie są automatycznie naliczane efekty przedmiotów
ani warunkowe efekty stanów. Zmiany są pobierane przy odświeżeniu drużyny.
API udostępnia GM podsumowanie liczbowe tylko postaci należących do jego gry
po akceptacji zaproszenia, bez prywatnych notatek. Ekwipunek, przydzielanie
przedmiotów i wyrzucanie z sesji pozostają dostępne.

## Wyrzucanie z sesji przez GM

Przy postaci w bieżącej sesji GM ma przycisk **Wyrzuć z sesji**. Po potwierdzeniu
postać kończy udział w tej sesji, zachowując przynależność do gry, ekwipunek
i statystyki. Pozostali uczestnicy i sama sesja pozostają aktywni. Widok gracza
wykrywa usunięcie przy kolejnym odświeżeniu stanu (do 5 sekund).
Wyrzucenie nie jest blokadą: właściciel może ponownie wybrać **Wejdź do gry**.
Operacja wymaga uprawnień prowadzącego GM i dotyczy wskazanej aktywnej sesji.

## Przynależność do gry i udział w sesji

Zaakceptowane zaproszenie przypisuje postać do jednej gry. Samo przypisanie nie
oznacza udziału w sesji. GM na podstronie gry wybiera **Rozpocznij sesję** lub
**Zakończ sesję**. W jednej grze może trwać tylko jedna sesja.

Na liście postaci dostępne są dwa przyciski:

- **Podgląd** otwiera dotychczasowy ekran ekwipunku i statystyk, także bez gry
  i bez rozpoczętej sesji. Nie zgłasza udziału postaci.
- **Wejdź do gry** zgłasza udział właściciela wybraną postacią w bieżącej sesji.
  Jest dostępny dopiero po zaakceptowaniu zaproszenia i rozpoczęciu sesji przez GM.
  Dla postaci już uczestniczącej ma etykietę **Wróć do sesji**.

GM widzi osobno postacie w bieżącej sesji oraz rozwijaną listę bohaterów należących
do gry poza sesją. Wgląd w ekwipunek i przydzielanie przedmiotów działają również
dla członków poza sesją. U gracza przycisk **Opuść sesję** kończy tylko udział
w sesji. Powrót do listy postaci, zamknięcie karty lub wylogowanie nie usuwa
zgłoszonego udziału — pozostaje on do opuszczenia sesji lub zakończenia jej przez GM.
To lista uczestników sesji, nie wskaźnik połączenia online.

Zakończenie sesji wyłącza udział wszystkich postaci, zachowując przynależność,
statystyki i ekwipunek. Nowa sesja zaczyna się z pustą listą uczestników i wymaga
ponownego wejścia. Usunięcie z gry usuwa też udział w sesji; ponowne zaproszenie
nie przywraca go automatycznie. API sprawdza właściciela postaci, prowadzącego GM,
przynależność i identyfikator aktywnej sesji, aby stare żądania nie dołączały do
nowej sesji ani jej nie kończyły.

Stan jest zapisany w SQLite (`game_sessions`, `session_participants`) i przetrwa
restart API. Migracja dodaje tabele bez zmiany obecnych przypisań postaci.
Lista postaci i widok gracza sprawdzają stan co 5 sekund, a panel GM odbiera powiadomienia o zmianach.

## Statystyki postaci

### Automatyczne wpisy z zasad 2024

Karta wyprowadza z klasy, poziomu, podklasy i pochodzenia biegłości w rzutach
obronnych, szkolenie w pancerzach i broni, stałe narzędzia, umiejętności
pochodzenia, atut pochodzenia, kość wytrzymałości, zasoby z tabeli klasy i listę
dostępnych zdolności (z odnośnikami do zasad). Języki obejmują Common oraz
klasowe Druidic / Thieves’ Cant. Dwa języki standardowe i dodatkowe języki
klasowe wybiera gracz; gatunek Elf nie dopisuje automatycznie języka Elvish.

W edycji dostępne są ograniczone listy umiejętności klasy, ekspertyz, narzędzi,
instrumentów i języków oraz wybory Skilled, Crafter i Musician. Obsługiwane są
także dodatkowe biegłości Human, Elf, College of Lore, Fey Wanderer i Assassin.
API sprawdza liczbę wyborów, duplikaty, uprawnienia i zależności ekspertyzy od
biegłości. Niekompletny wybór można zapisać; karta pokazuje, co zostało do uzupełnienia.

Wyniki testów uwzględniają automatyczne biegłości, wybrane ekspertyzy, Jack of
All Trades, premie Thaumaturge / Magician i Otherworldly Glamour. Monk na poziomie
14 otrzymuje wszystkie rzuty obronne, a Rogue na poziomie 15 Mądrość i Charyzmę.
Alert zwiększa inicjatywę. Na 1. poziomie maksymalne PW mogą być wyliczone
z klasy i Kondycji, z premiami Dwarf i Tough; ręcznie wpisane maksymalne PW mają
pierwszeństwo. Szybkość bazowa i podstawowe zmysły / odporności gatunku są pokazane
osobno od efektów warunkowych i wariantów gatunku.

Stałe dane są wyprowadzane na bieżąco, bez nadpisywania dotychczasowych notatek,
ręcznych wartości i dodatkowych biegłości. W `character_statistics` zapisywane są
wybory `traits`, niezależnie od `spells`. Po zmianie klasy lub pochodzenia stary
niepasujący wybór jest oznaczony i wymaga poprawienia. Atuty przy awansie,
multiclassing, warianty gatunku i warunkowe efekty wymagają osobnego uzupełnienia.

Metadane: `shared/trait-data.json`, opcje: `shared/trait-options.json`, wspólne
obliczenia i walidacja: `shared/character-traits.mjs`. Metadane można odtworzyć
przez `node scripts/build-trait-data.mjs` (wiki i pamięć podręczna jak przy czarach).
Podstawa zasad: [klasy](https://www.dndbeyond.com/sources/dnd/br-2024/character-classes)
i [języki](https://www.dndbeyond.com/sources/dnd/br-2024/creating-a-character).

Ekran postaci ma zakładki „Ekwipunek” i „Statystyki”. Statystyki obejmują sześć
cech, rzuty obronne, 18 umiejętności z biegłością lub ekspertyzą, PW, KP, inicjatywę,
szybkość, kości wytrzymałości, rzuty przeciw śmierci, wyczerpanie, inspirację,
doświadczenie i parametry magii. Ataki, zasoby, zdolności, odporności,
języki i inne biegłości zapisuje się w polach opisowych.

### Wybór czarów (PHB 2024)

W edycji statystyk sztuczki i czary wybiera się z list rozwijanych. Katalog zawiera
391 czarów z Player’s Handbook 2024: nazwy angielskie, kręgi, listy klasowe i linki
do opisów w [wiki](https://dnd2024.wikidot.com/spell:all), bez kopiowania opisów.
Ten sam moduł sprawdza w przeglądarce i API dostęp do listy, kręgu, duplikaty,
limit sztuczek i limit czarów przygotowanych na poziomach 1–20.

Obsługiwane są klasy czarujące oraz Eldritch Knight i Arcane Trickster,
czary przyznane przez podklasy, wybór krainy Circle of the Land, boski/pierwotny
porządek, Blessed Warrior i Druidic Warrior, Magical Secrets i Magical Discoveries.
Czary zawsze przygotowane są oddzielone od zwykłego limitu. Czarodziej wybiera
przygotowane czary z księgi; nie ograniczamy liczby wpisów w księdze, ponieważ
może kopiować znalezione czary. Spell Mastery i Signature Spells mają osobny wybór.
Mystic Arcanum czarnoksiężnika ma oddzielne limity dla kręgów 6–9.

Można zapisać niekompletny wybór, ale nie przekroczyć limitów. Aplikacja nie
śledzi czasu odpoczynków, historii wymiany czarów przy awansie, kosztów kopiowania,
zużytych komórek ani multiclassingu. Czary z gatunku, atutów, inwokacji i przedmiotów
nie są jeszcze częścią tego wyboru klasowego. Dotychczasowy tekst czarów pozostaje
dostępny jako archiwalne notatki; nie jest automatycznie interpretowany jako lista.
Cecha magii klasy jest ustalana automatycznie. Po zmianie klasy, podklasy lub
poziomu niepoprawny stary wybór jest oznaczony błędem i wymaga poprawienia przed zapisem.

Dane katalogu i progresji są przechowywane w `shared/`; można je odtworzyć
poleceniem `node scripts/build-spell-data.mjs` (wymaga internetu). Skrypt korzysta
z pamięci podręcznej w `.local-preview/spell-sources/`; aktualizacja danych źródłowych
wymaga odświeżenia odpowiednich plików tej pamięci. Zasady przygotowania i limitów:
[Character Classes 2024](https://www.dndbeyond.com/sources/dnd/br-2024/character-classes).

Właściciel uzupełnia kartę przez „Uzupełnij / edytuj”. Brakujące wartości są
oznaczone kreską. Modyfikatory cech, premia z biegłości, rzuty, podstawowa pasywna
Percepcja i parametry magii są przeliczane z zapisanych danych według
[zasad 2024](https://www.dndbeyond.com/sources/dnd/br-2024/creating-a-character).
KP, PW i pozostałe wartości wpisuje się ręcznie; aplikacja nie nalicza automatycznie
wpływu przedmiotów, stanów, wyczerpania ani warunkowych zdolności klasowych.
Zapis trafia do `character_statistics` w SQLite. Migracja tworzy tabelę przy
starcie API, a istniejące postacie otrzymują pustą kartę bez nadpisania danych.

## Usuwanie postaci z gry

W panelu **Edytuj grę → Postacie w grze** prowadzący GM może wybrać
**Usuń z gry** i potwierdzić operację. Usuwany jest wyłącznie udział w tej grze:
postać i jej ekwipunek pozostają na koncie właściciela. GM traci dostęp do karty
i możliwość przydzielania przedmiotów. Postać może dołączyć do innej gry;
powrót do poprzedniej wymaga nowego zaproszenia i akceptacji właściciela.

## Podstrona gry GM

Przycisk **Gry → Otwórz grę** przechodzi do podstrony wybranej gry w tej samej karcie.
Na głównym ekranie znajdują się karty postaci, które zaakceptowały udział:
właściciel, poziom, podstawy bohatera, podgląd ekwipunku i przydzielanie przedmiotów.
Zaproszenia są dostępne w osobnym panelu **Edytuj grę**, otwieranym z listy gier
lub z podstrony gry. Panel pozwala zapraszać bohaterów i sprawdzać status wszystkich
wysłanych zaproszeń. Przycisk „Wróć” przywraca poprzedni widok.
Panel aktualizuje dane po powiadomieniu o zmianie, po powrocie do karty i po wybraniu
„Odśwież drużynę”. Uczestnictwo oznacza zaakceptowany udział, a nie obecność online.

Adres zawiera `?gmGame=ID`, więc odświeżenie strony zachowuje wybraną grę.
Przycisk „Wróć do gier” wraca do listy; działa również przycisk Wstecz przeglądarki.
Podstrona korzysta z bieżącej sesji; po jej wygaśnięciu wymaga ponownego logowania.
Dostęp do danych nadal sprawdza API: tylko GM prowadzący tę grę.

## Tworzenie postaci przez graczy i GM

Każde konto gracza i GM ma przycisk **Postacie → Utwórz postać**.
Postać zostaje przypisana do zalogowanego konta. Gracz tworzy bohatera wyłącznie
na poziomie 1; GM wybiera poziom 1–20, z podklasą wymaganą od poziomu 3.
API sprawdza poziom i właściciela niezależnie od formularza. Administrator nadal
może tworzyć i edytować postacie graczy i GM w swoim panelu.
Postacie GM mogą być zapraszane do gier i wymagają akceptacji właściciela
tak samo jak postacie graczy. Nadal obowiązuje jedna gra na postać.

## Katalog i przydzielanie przedmiotów

W panelu **Administracja → Katalog przedmiotów** administrator ręcznie dodaje
nazwę, opis i miejsce noszenia przedmiotu. „Tylko plecak” służy przedmiotom,
których nie można zakładać. Katalog jest początkowo pusty i jest zapisywany
w tabeli `item_catalog` w tej samej bazie SQLite co konta i postacie.

GM otwiera **Gry → Otwórz grę**, a przy bohaterze wybiera przedmiot z katalogu
i liczbę sztuk 1–9999 w formularzu **Przydziel ekwipunek**. Przedmiot trafia do
plecaka, bez automatycznego zakładania. Każde przydzielenie tworzy osobną pozycję;
katalog jest zbiorem wzorów i nie ma limitu zapasów.

API pozwala przydzielać przedmioty wyłącznie GM prowadzącemu daną grę i tylko
bohaterom z zaakceptowanym udziałem. Gracze nie mogą sami dodawać przedmiotów
ani uzupełniać katalogu. Nowe wpisy katalogu pojawiają się po otwarciu gry lub
wybraniu „Odśwież drużynę”. Gracz zobaczy przydział po ponownym otwarciu ekwipunku.
Przydział kopiuje nazwę, opis i slot z katalogu; późniejsze zmiany lub usunięcie
wpisu katalogu bezpośrednio w bazie nie zmieniają już wydanych przedmiotów.

Katalog można też uzupełniać ręcznie przez SQL, po uruchomieniu migracji API:

```sql
INSERT INTO item_catalog (name, description, slot)
VALUES ('Lina', 'Lina konopna, 15 metrów.', 'backpack');
```

Dozwolone sloty: `backpack` oraz identyfikatory z `shared/equipment-slots.json`.
Zmiana katalogu nie wymaga restartu API. Pierwsze uruchomienie nowej wersji API
automatycznie tworzy tabelę katalogu bez zmieniania istniejącego ekwipunku.

## Katalog broni

Dane broni są przechowywane w tabeli `weapon_catalog`, która jest tworzona
i synchronizowana przy uruchomieniu API na podstawie pliku
`shared/weapon-catalog.json`. Katalog odpowiada tabeli ze źródła i obejmuje
nazwę, kategorię (simple/martial), typ (wręczna/dystansowa), kość obrażeń, typ obrażeń,
zasięg, wagę, koszt, właściwości oraz Mastery.
Endpoint `GET /api/weapons` udostępnia te dane każdemu zalogowanemu użytkownikowi;
właściwości są zwracane jako tablica. Przy starcie wpisy istniejące w bazie są
aktualizowane, a wpisy usunięte ze źródła są usuwane z tabeli.

## Konta GM i gry

Administrator tworzy konto GM w panelu Administracja, wybierając typ konta
„GM — Gamemaster”. Konto GM można edytować i usuwać tak jak konto gracza;
usunięcie GM usuwa również jego gry i zaproszenia.

W zakładce „Gry” GM tworzy grę z nazwą i opisem, otwiera ją i zaprasza
konkretnych bohaterów. Lista wyboru pokazuje imiona bohaterów i ich właścicieli.
Gracz w tej samej zakładce akceptuje lub odrzuca zaproszenie dla swojej postaci.
Po akceptacji gra pojawia się na jego liście, a GM uzyskuje podgląd podstawowych
danych postaci i całego ekwipunku. GM może też przydzielać nowe przedmioty z katalogu
do plecaka bohatera; zakładanie, zdejmowanie i usuwanie pozostaje po stronie gracza.
Przycisk „Odśwież drużynę” pobiera aktualne decyzje i dane bohaterów.

Zaproszenie może mieć stan oczekujący, zaakceptowany lub odrzucony. Dla danej
pary gra–bohater istnieje jedno zaproszenie. Bohater może uczestniczyć tylko w jednej
grze na raz. Może otrzymać kilka zaproszeń przed dołączeniem, ale zaakceptowanie
jednego blokuje akceptację pozostałych. Bohaterowie będący już w grze nie pojawiają
się na liście do zaproszenia. API i unikalny indeks SQLite wymuszają ten limit.
Jeśli starsza baza zawiera kilka zaakceptowanych udziałów jednej postaci, migracja
zachowuje najwcześniejszy udział, a pozostałe przywraca do stanu oczekującego.
Zmiana właściciela postaci przez administratora usuwa jej dotychczasowe
zaproszenia i udziały w grach, aby nowy właściciel mógł sam wyrazić zgodę.
Migracja SQLite przy starcie API zachowuje istniejące konta, postacie i sesje.

Projekt DnD-RnR.
I am reading 




## Uruchomienie aplikacji

Wymagania: Node.js 24 LTS i npm.

```sh
npm install
npm run dev
```

W drugim terminalu uruchom API:

```sh
npm run server
```

Podczas pracy nad aplikacją używaj `npm run server:dev`, aby API automatycznie
uruchamiało się ponownie po zmianach kodu i wczytywało aktualny zapis postaci.
Po aktualizacji kodu serwera działającego przez `npm run server` trzeba go ponownie
uruchomić. Migracje bazy (w tym gatunek i pochodzenie) wykonują się przy starcie API.

Otwieraj aplikację przez `http://127.0.0.1:5173` (ten adres jest domyślnym
`APP_ORIGIN`). Opcjonalnie skopiuj `.env.example` do `.env` i ustaw adres aplikacji.
Vite przekazuje `/api` do lokalnego serwera na porcie 3001; przy zmianie portu API
zmień również proxy w `vite.config.ts`. Sam `npm run preview` nie udostępnia API.

## Pierwszy administrator

Nie ma domyślnego konta ani publicznej rejestracji. W PowerShell ustaw hasło
bez wpisywania go wprost w historii poleceń:

```powershell
$adminSecret = Read-Host 'Hasło administratora (minimum 12 znaków)' -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $adminSecret).Password
npm run admin:create
Remove-Item Env:ADMIN_PASSWORD
```

Polecenie zapyta o login i imię. Następnie zaloguj się w aplikacji, wybierz
„Administracja”, utwórz konto gracza i przypisz mu postać. Login i hasło przekaż
graczowi prywatnie. Gracz po zalogowaniu zobaczy „Moje postacie”.

Konta, przypisania postaci i sesje są zapisywane w `data/dnd.sqlite` (plik poza Git).
Hasła są haszowane funkcją scrypt; losowe sesje są przechowywane jako skróty
i przekazywane przez cookie HttpOnly, SameSite=Strict. Sesja wygasa po 8 godzinach.
API wymusza uprawnienia administratora i filtruje postacie według zalogowanego
użytkownika. Logowanie ma limit 10 prób na adres IP na 15 minut (licznik w pamięci
procesu). Testy integracyjne: `npm test`.

Przed udostępnieniem w internecie skonfiguruj HTTPS, `NODE_ENV=production`,
`APP_ORIGIN` z właściwą domeną oraz reverse proxy przekazujące `/api` do serwera
i serwujące `dist/`. Przy `NODE_ENV=production` cookie otrzymuje atrybut Secure.
Obecnie odzyskiwanie i zmiana hasła oraz zarządzanie istniejącymi kontami nie mają
jeszcze interfejsu.

Adres lokalnego serwera pojawi się w terminalu. Weryfikacja typów i kompilacja produkcyjna:

```sh
npm run build
npm run preview
```

## Struktura

```text
public/                    # Pliki statyczne
src/
  app/                     # Główny komponent i definicja nawigacji
  components/
    layout/                # Wspólny układ, menu i nawigacja
    ui/                    # Komponenty wielokrotnego użytku
  features/
    auth/                  # Ekran logowania
    admin/                 # Tworzenie graczy i przypisywanie postaci
    characters/            # Moduł postaci
  styles/                  # Style globalne i zmienne motywu
  main.tsx                 # Punkt wejścia
server/                    # API, SQLite, tworzenie admina i testy uprawnień
```

Projekt korzysta z React, TypeScript i Vite. Każdy moduł zawiera swój widok;
związane z nim komponenty, hooki i typy należy dodawać w jego katalogu w miarę rozwoju.
Elementy współdzielone trafiają do `components/`.

## Zakres szkieletu

- Responsywny układ: panel boczny na komputerze i rozwijane menu na telefonie.
- Widok postaci gracza oraz panel administratora z działającą nawigacją.
- Wspólne komponenty `AppLayout`, `Card` i `EmptyState`.
- Ciemny motyw ze zmiennymi CSS, obsługa klawiatury i odnośnik do głównej treści.

Nawigacja działa w pamięci aplikacji; odświeżenie wraca do widoku postaci.
Logowanie, konta graczy i podstawowe przypisania postaci korzystają z API i SQLite.
Kolejne moduły będą dodawane w miarę potrzeb.

## Zarządzanie kontami i postaciami

W panelu Administracja można edytować login i imię gracza oraz ustawić nowe hasło.
Puste pole hasła zachowuje dotychczasowe hasło; zmiana hasła kończy sesje gracza.
Postacie można edytować (imię, klasa, poziom 1–20 i właściciel) oraz usuwać.
Usunięcie konta gracza usuwa również wszystkie jego postacie i sesje.
Usuwanie wymaga potwierdzenia w interfejsie. Te operacje są dostępne tylko dla administratora.

## Podstawy postaci · D&D 2024

Administrator wybiera gracza, imię, gatunek (rasę), pochodzenie, klasę i poziom 1–20. Od poziomu 3 wymagana jest podklasa pasująca do klasy. Katalog obejmuje 10 gatunków, 16 pochodzeń i 12 klas z 48 podklasami z Player’s Handbook 2024, według https://dnd2024.wikidot.com/. Angielskie nazwy podklas odpowiadają wiki; polskie etykiety są pomocnicze. Dodatki i opcje homebrew nie są jeszcze uwzględnione.

Wybory są sprawdzane przez API, zapisywane w SQLite i widoczne na karcie gracza. Baza automatycznie otrzymuje nowe kolumny; istniejące postacie zachowują dane, a nowe pola należy uzupełnić przy edycji. Ten etap zapisuje podstawy postaci; nie wylicza jeszcze cech, biegłości, atutów, zaklęć ani wyposażenia.

## Ekran gry i ekwipunek

Przycisk „Podgląd” na karcie postaci otwiera ekran z zakładką „Ekwipunek”.
Sylwetka pokazuje 11 slotów; wybranie slotu wyświetla opis założonego przedmiotu.
Plecak pokazuje przedmioty przypisane do postaci. Gracz może zakładać i zdejmować
przedmioty, usuwać je z plecaka oraz przekazywać innym postaciom. GM przydziela
nowe przedmioty z katalogu w panelu swojej gry.
Założenie nowego przedmiotu odkłada poprzedni z tego slotu do plecaka.
Dane są zapisywane w SQLite, a API pozwala korzystać tylko z ekwipunku własnych
postaci. Sloty służą do ewidencji: aplikacja nie wylicza statystyk postaci,
premii ani ograniczeń używania przedmiotów, takich jak broń dwuręczna czy dostrojenie.

Przycisk „Przekaż” w plecaku pozwala wybrać inną postać i liczbę sztuk.
Przedmiot trafia do plecaka odbiorcy; założone przedmioty trzeba najpierw zdjąć.
