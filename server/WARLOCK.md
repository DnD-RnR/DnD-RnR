# Warlock — backend poziomu 3: Fiend Patron

Źródła zasad:
- https://dnd2024.wikidot.com/warlock:main
- https://dnd2024.wikidot.com/warlock:fiend-patron

W danych postaci ustaw `class: "Czarnoksiężnik (Warlock)"`, `subclass: "Fiend Patron"`, `level: 3`.
Istniejący zapis statystyk i historia awansu obsługują 3 inwokacje, 2 sztuczki i 4 wybrane czary. Pact Magic daje dwa miejsca 2. kręgu, odnawiane po krótkim lub długim odpoczynku. Magical Cunning pozostaje dostępne zgodnie z dotychczasową obsługą.

Burning Hands, Command, Scorching Ray i Suggestion są zawsze przygotowane poza limitem czterech wyborów. Nie należy wpisywać ich do `spells.selections.prepared`. Przejście czaru do automatycznie przyznanych przez patrona nie zużywa wymiany przy awansie. Burning Hands korzysta z istniejącego silnika obrażeń obszarowych i skalowania do 2. kręgu; pozostałe trzy czary korzystają z istniejącego przepływu `cast` → rozstrzygnięcie GM.

Dark One's Blessing przyznaje `max(1, poziom warlocka + modyfikator CHA)` tymczasowych PW. Zachowywana jest większa wartość dotychczasowych i nowych tymczasowych PW. Nie zużywa akcji, reakcji ani zasobu odpoczynku. Brak wpisanej CHA uniemożliwia przyznanie premii.

Własne sprowadzenie potwora do 0 PW atakiem, czarem lub rozstrzygnięciem oczekującej akcji przez GM przyznaje premię automatycznie. Backend zapisuje faktyczne przejście z dodatnich PW do 0 przed usunięciem potwora z inicjatywy. Ponowne zadanie obrażeń celowi na 0 PW nie tworzy nowego zdarzenia. Relentless Endurance i oczekujący rzut Relentless Rage są uwzględniane przed ostatecznym rozstrzygnięciem.

Walka nie przechowuje pozycji ani indywidualnych relacji wrogości między postaciami. Dla cudzych pokonań GM potwierdza wroga oraz odległość do 10 stóp. `battle.fiendDefeats` zawiera identyfikator zdarzenia, cel, źródło, kandydatów i już rozliczone postacie (ostatnie 100 zdarzeń). W istniejącym POST `/api/games/:id/battle/act`:

```json
{
  "sessionId": 1,
  "version": 12,
  "kind": "dark-ones-blessing",
  "actorId": "identyfikator-warlocka-w-walce",
  "eventId": "identyfikator-z-battle.fiendDefeats",
  "enemy": true,
  "within10Feet": true
}
```

Tylko GM prowadzący grę może zatwierdzić zdarzenie; każdy kwalifikujący się warlock może skorzystać z niego raz. Dla własnego pokonania odległość nie jest wymagana. Zdarzenie zachowuje się po usunięciu pokonanego potwora i zapisuje wraz z walką. Premia działa także poza własną turą. Zapis tymczasowych PW i rozliczenie zdarzenia należą do tej samej transakcji walki.

GET `/api/characters/:id/spell-resources` i dane czarowania w walce udostępniają `spellcasting.warlock.fiend`: `enabled`, `temporaryHitPoints`, `nearbyFeet`.

Zakres tej zmiany obejmuje poziom 3 i Fiend Patron. Dynamiczne cechy patrona z poziomów 6, 10 i 14 oraz nowe kontrolki frontendu pozostają poza zakresem.
