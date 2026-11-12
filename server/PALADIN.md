# Paladin — poziomy 1–3 (2024)

## Oath of Vengeance — poziom 3

Źródło: https://dnd2024.wikidot.com/paladin:oath-of-vengeance

Statyczne dane udostępniają Bane i Hunter's Mark jako zawsze przygotowane,
poza limitem 4 wybranych czarów. Paladyn ma 3 miejsca 1. kręgu i pulę
15 punktów Lay on Hands. Karta cech pokazuje również pulę Channel Divinity.

Akcja `attack`, `slot: 'action'` przyjmuje opcjonalne `vowTargetId` przy
pierwszym ataku akcji Atak. Cel przysięgi może być inny niż cel ataku.
Vow of Enmity zużywa jedno Channel Divinity, bez dodatkowej akcji ani
koncentracji. Zasięg 30 stóp i widoczność celu potwierdza GM.
Niepoprawny atak wycofuje także zużycie zasobu.

Pole `vowOfEnmity` uczestnika przechowuje cel i koniec czasu trwania.
Ułatwienie jest automatyczne dla ataków bronią i czarami przeciw temu celowi;
utrudnienie standardowo je znosi. Efekt kończy się na początku tury paladyna
10 rund później. Ponowna aktywacja zastępuje poprzednią przysięgę.

Gdy cel spada do 0 PW, `transferAvailable` pozwala użyć akcji API
`vow-of-enmity-transfer` z `actorId` i `targetId`, również poza własną turą.
Przeniesienie nie zużywa działania ani zasobu i nie przedłuża efektu.
Nowy cel musi być w promieniu 30 stóp (potwierdza GM).
Stan przysięgi jest zapisywany razem z walką i nie przechodzi do nowej walki.

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
