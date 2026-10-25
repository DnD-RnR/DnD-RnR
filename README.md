# DnD-RnR

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
