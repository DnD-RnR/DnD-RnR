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
    campaign/              # Pulpit kampanii
    characters/            # Moduł postaci
    sessions/              # Moduł sesji
    notes/                 # Moduł notatek
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
- Cztery widoki z działającą nawigacją i stanami pustymi.
- Wspólne komponenty `AppLayout`, `Card` i `EmptyState`.
- Ciemny motyw ze zmiennymi CSS, obsługa klawiatury i odnośnik do głównej treści.

Nawigacja działa w pamięci aplikacji; odświeżenie wraca do pulpitu kampanii.
Logowanie, konta graczy i podstawowe przypisania postaci korzystają z API i SQLite.
Kampania, sesje i notatki pozostają szkieletami do dalszego rozwoju.
