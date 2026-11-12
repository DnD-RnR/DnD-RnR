# Paladin — poziomy 1–2 (2024)

Źródło: https://dnd2024.wikidot.com/paladin:main

Backend korzysta z istniejących tabel czarów, biegłości i Weapon Mastery.
Poziom 1: dwa przygotowane czary, dwa miejsca 1. kręgu, dwie bronie mastery.
Poziom 2: trzy przygotowane czary, Fighting Style lub Blessed Warrior,
automatycznie przygotowany Divine Smite i jedno darmowe użycie na długi odpoczynek.

GET `/api/characters/:id/spell-resources` zwraca `spellcasting.paladin`:
`enabled`, `layOnHandsMax`, `layOnHandsRemaining`, `smiteAvailable`.

Akcja walki `kind: 'lay-on-hands'` przyjmuje `actorId`, `targetId`,
`mode: 'heal'` i dodatnie całkowite `amount` lub `mode: 'poison'` (koszt 5).
Zużywa bonus action. Zasięg dotyku sprawdza GM; Poisoned jest usuwane
przez GM w opisie stanów, ponieważ silnik nie przechowuje tego stanu strukturalnie.

Darmowy Divine Smite używa istniejącej akcji `cast`, `source: 'paladin-smite'`,
`spellId: 'divine-smite'`, `level: 1`, `slot: 'bonus'`.
Trafienie wyzwalające czar i jego efekty rozstrzyga GM przez istniejący mechanizm
rozstrzygania czarów. Darmowe użycie nie zużywa miejsca ani limitu miejsc na turę.

Długi odpoczynek przywraca pulę Lay on Hands i darmowy Smite; krótki ich nie odnawia.
Przygotowany czar można wymienić raz po długim odpoczynku, a sztuczkę
Blessed Warrior raz na zdobyty poziom. Zmiany mastery wymagają długiego odpoczynku.
Frontend nie otrzymuje nowych kontrolek w tej zmianie.

## Channel Divinity i Divine Sense (poziom 3)

`spellcasting.paladin` zawiera `channelDivinityMax`, `channelDivinityRemaining`,
`channelDivinityDc` (ST czarów paladyna) oraz `divineSense`.
Pula wynosi 2 użycia od poziomu 3 i 3 od poziomu 11. Krótki odpoczynek
odnawia jedno użycie, długi wszystkie.

Akcja walki `kind: 'divine-sense'` z opcjonalnym `actorId` zużywa bonus action
i jedno Channel Divinity. Efekt jest zapisany w zasobach postaci i w polu
`divineSense` uczestnika walki. Trwa 10 minut czasu rzeczywistego, kończy się
także przy Incapacitated (w tym utracie przytomności). Synchronizacja walki
usuwa zakończony efekt. Nie wymaga koncentracji.

GM ujawnia położenie i typ Celestials, Fiends oraz Undead w promieniu 60 stóp,
a także obecność poświęconych/sprofanowanych miejsc i obiektów. Backend
przechowuje te parametry; nie wylicza wykrytych celów, ponieważ walka nie ma
modelu pozycji i poświęcenia obiektów. Nie jest to rzucenie czaru Hallow.
