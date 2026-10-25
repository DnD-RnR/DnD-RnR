# DnD-RnR

## Statystyki postaci

Ekran postaci ma zakładki „Ekwipunek” i „Statystyki”. Statystyki obejmują sześć
cech, rzuty obronne, 18 umiejętności z biegłością lub ekspertyzą, PW, KP, inicjatywę,
szybkość, kości wytrzymałości, rzuty przeciw śmierci, wyczerpanie, inspirację,
doświadczenie i parametry magii. Ataki, czary, zasoby, zdolności, odporności,
języki i inne biegłości zapisuje się w polach opisowych.

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
Panel odświeża dane co 15 sekund, po powrocie do karty i po wybraniu
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

## Firebase

Aplikacja jest połączona z projektem Firebase `dnd-rnr`. Inicjalizacja SDK znajduje
się w [src/lib/firebase.ts](src/lib/firebase.ts); kolejne usługi Firebase można
dodawać przez import z tego modułu.

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

Przycisk „Wejdź do gry” na karcie postaci otwiera ekran z zakładką „Ekwipunek”.
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
