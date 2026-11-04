# Uruchomienie DnD-RnR krok po kroku

Poniższa instrukcja jest dla Windows PowerShell. Uruchomienie wymaga
**dwóch osobnych terminali**: jeden będzie zajęty przez API, a drugi przez
frontend Vite.

## 1. Sprawdź wymagania

Zainstaluj Node.js 24 LTS. Następnie otwórz PowerShell i sprawdź wersje:

```powershell
node --version
npm --version
```

Jeśli polecenie `node` nie działa, zainstaluj Node.js i uruchom PowerShell
ponownie.

## 2. Przejdź do projektu

W PowerShell wykonaj:

```powershell
Set-Location "C:\Users\micha\Desktop\Apps\DnD-RnR"
```

Jeśli projekt znajduje się w innym miejscu, wpisz własną ścieżkę.

## 3. Zainstaluj zależności

W tym samym terminalu wykonaj:

```powershell
npm install
```

Poczekaj, aż polecenie zakończy się bez błędu.

## 4. Skonfiguruj plik `.env`

Utwórz plik `.env` na podstawie przykładowego:

```powershell
Copy-Item .env.example .env
```

Otwórz `.env`:

```powershell
notepad .env
```

Sprawdź, czy zawiera między innymi:

```env
PORT=3001
APP_ORIGIN=http://127.0.0.1:5173
GOOGLE_APPLICATION_CREDENTIALS=C:/sciezka/do/firebase-admin.json
```

Zmień `GOOGLE_APPLICATION_CREDENTIALS` na pełną ścieżkę do pliku JSON konta
serwisowego Firebase. Ten plik musi istnieć poza repozytorium i nie wolno go
publikować.

Zapisz plik i zamknij Notatnik.

## 5. Uruchom API

W **pierwszym terminalu**, nadal w katalogu projektu, wykonaj:

```powershell
npm run server
```

Prawidłowy komunikat końcowy wygląda podobnie do:

```text
API: http://127.0.0.1:3001
```

Nie zamykaj tego terminala. Ostrzeżenie o eksperymentalnym SQLite nie jest
błędem, jeśli poniżej pojawi się adres API.

## 6. Uruchom frontend

Otwórz **drugi terminal PowerShell** i ponownie przejdź do projektu:

```powershell
Set-Location "C:\Users\micha\Desktop\Apps\DnD-RnR"
npm run dev
```

Poczekaj na komunikat `ready`. Następnie otwórz dokładnie ten adres:

<http://127.0.0.1:5173>

### Ważne: nie zamieniaj `127.0.0.1` na `localhost`

Jeśli w `.env` masz:

```env
APP_ORIGIN=http://127.0.0.1:5173
```

musisz wejść na `http://127.0.0.1:5173`, a nie na
`http://localhost:5173`. Inaczej API może pokazać:
**„Niedozwolone źródło żądania.”**

To był problem widoczny na zrzutach ekranu: frontend działał pod
`localhost:5173`, ale `.env` zezwalał na `127.0.0.1:5173`.

Jeśli chcesz używać `localhost`, zmień w `.env`:

```env
APP_ORIGIN=http://localhost:5173
```

Potem zatrzymaj i uruchom ponownie API (`Ctrl+C`, następnie `npm run server`)
i otwieraj aplikację pod `http://localhost:5173`. Nie mieszaj tych dwóch
adresów.

## 7. Logowanie

Zaloguj się danymi otrzymanymi od administratora. Aplikacja nie ma publicznej
rejestracji. Utworzenie pierwszego administratora opisano w głównym
[README.md](README.md), w sekcji „Pierwszy administrator”.

## Zatrzymywanie aplikacji

W każdym terminalu, w którym działa proces, naciśnij:

```text
Ctrl+C
```

Zatrzymanie frontendu nie zatrzymuje API — oba procesy trzeba zatrzymać
osobno.

## Szybka lista kontroli, gdy nie działa

1. Czy API działa w pierwszym terminalu i pokazuje `API: ...:3001`?
2. Czy frontend działa w drugim terminalu i pokazuje `ready`?
3. Czy przeglądarka używa dokładnie tego samego hosta co `APP_ORIGIN`:
   `127.0.0.1` albo `localhost`?
4. Czy `GOOGLE_APPLICATION_CREDENTIALS` wskazuje na istniejący plik JSON?
5. Czy po zmianie `.env` zrestartowano API?

## Przydatne polecenia

```powershell
npm test
npm run build
npm run preview
```

`npm run preview` służy tylko do podglądu zbudowanego frontendu. Nie zastępuje
`npm run server` i nie udostępnia endpointów `/api`.
