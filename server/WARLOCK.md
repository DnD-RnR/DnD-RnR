# Warlock — poziomy 1–10: Great Old One i Fiend

Źródła:
- https://dnd2024.wikidot.com/warlock:main
- https://dnd2024.wikidot.com/warlock:great-old-one-patron
- https://dnd2024.wikidot.com/warlock:fiend-patron

Klasa w danych: `Czarnoksiężnik (Warlock)`. Podklasy: `Great Old One Patron` albo `Fiend Patron` od poziomu 3.

## Wspólna klasa

Dotychczasowa progresja limitów czarów, inwokacji i miejsc Pact Magic obejmuje wszystkie poziomy. Testy sprawdzają każdy poziom 1–10. Historia wyborów nadal ogranicza wymiany przy awansie. Czary patronów, Contact Other Plane (9) i Hex z Eldritch Hex (10) są zawsze przygotowane poza zwykłym limitem. Czar, który zostaje automatyczny, można usunąć z listy bez zużycia wymiany.

Magical Cunning (2) odnawia połowę maksymalnych miejsc Pact Magic w górę, raz na długi odpoczynek. Obrzęd trwa minutę i jest obsługiwany poza walką. Contact Patron (9) zużywa osobne użycie na długi odpoczynek, daje darmowe Contact Other Plane do kontaktu z patronem i automatyczny sukces rzutu obronnego. GM rozstrzyga kontakt i potwierdza czas rzucania oraz komponenty.

Wybory inwokacji, wymagania, opisy i statyczne korzyści korzystają z istniejącego systemu. Ich opisy nie oznaczają pełnej automatyzacji każdej aktywnej inwokacji. ASI/atuty na poziomach 4 i 8 pozostają w istniejącej karcie wyborów. Efekty czarów nieobjęte silnikiem nadal tworzą żądanie rozstrzygnięcia GM.

## Great Old One

- Awakened Mind (3): akcja dodatkowa, widoczny cel do 30 stóp potwierdzony z GM; czas równy poziomowi w minutach, zasięg równy modyfikatorowi CHA w milach (minimum 1). Nowa więź zastępuje starą. Poza walką cel jest nazwą narracyjną; w walce ma identyfikator uczestnika. Wspólny język i komunikację rozstrzyga GM.
- Psychic Spells (3): opcja zamiany obrażeń czaru Warlocka na psychiczne. Zmienia typ w automatycznych efektach oraz w opisie żądania GM. Enchantment/Illusion można rzucać bez V/S; M pozostaje wymagane. Sprawdzenie szkoły i komponentów odbywa się z GM, zgodnie z istniejącym formularzem rzucania.
- Clairvoyant Combatant (6): przy tworzeniu więzi w walce można wymusić WIS przeciw aktualnemu ST czarów. Rzut wykonuje właściciel celu lub GM potwora. Porażka włącza automatyczne ułatwienie ataków warlocka przeciw celowi oraz utrudnienie ataków celu przeciw warlockowi, także ataków czarami. Nowa więź i wygaśnięcie czasu kończą korzyść. Użycie odnawia krótki/długi odpoczynek albo wydanie miejsca Pact Magic bez akcji.
- Eldritch Hex (10): automatyczny Hex i utrudnienie rzutów obronnych wskazanej cechy. Podstawowy Hex obsługuje także utrudnienie testów, dodatkowe k6 przy trafieniu (dwie przy krytyku), koncentrację, czas i przeniesienie po spadku celu do 0 PW na późniejszej turze. Psychic Spells może zmienić typ dodatkowych obrażeń Hex.
- Thought Shield (10): opis ochrony myśli, automatyczna odporność psychiczna oraz odbicie faktycznej wartości otrzymanych obrażeń do sprawcy. GM wskazuje sprawcę przy ręcznym rozliczeniu. Odbicie respektuje jego odporność. Dwa Thought Shields mogą odbijać malejące obrażenia aż do zera.

## Fiend

Dark One’s Blessing (3): `max(1, poziom + modyfikator CHA)` tymczasowych PW; zachowuje większą wartość. Własne pokonania potwora są obsługiwane automatycznie, a GM potwierdza wrogość i 10 stóp przy cudzym pokonaniu. Zdarzenia `battle.fiendDefeats` są jednorazowe i pozostają po usunięciu potwora; GM ma kontrolki potwierdzania. Relentless Endurance i oczekujące Relentless Rage są uwzględniane przed końcowym pokonaniem.

Dark One’s Own Luck (6): opcjonalny k10 po zobaczeniu k20, przed skutkami. Wspólny licznik `max(1, modyfikator CHA)` odnawiany po długim odpoczynku. Obsługują go testy, ogólne rzuty obronne, rzuty przeciw czarom, Clairvoyant Combatant, koncentracja i rzuty przeciw śmierci. Poza walką karta zużywa użycie dla nazwanego rzutu i odrzuca jego ponowne użycie; wynik rozlicza GM.

Fiendish Resilience (10): jeden typ poza Force, wybierany po krótkim/długim odpoczynku (również pierwszy wybór po uzyskaniu zdolności). Wybór obowiązuje do następnego; próba kolejnej zmiany bez odpoczynku jest odrzucana. Odporności nie sumują się.

## API i zapis

GET `/api/characters/:id/spell-resources` i dane czarowania uczestnika walki zawierają `spellcasting.warlock`: stan patrona, liczniki użyć, aktywną więź, odporność oraz progi zdolności.

POST tego samego endpointu wymaga właściciela postaci oraz `version` równego `resourceVersion`. Dostępne `kind`: `magical-cunning`, `contact-patron` (`confirmed`), `fiendish-resilience` (`damageType`), `clairvoyant-recover`, `awakened-mind` (`targetName`, `confirmed`), `dark-ones-own-luck` (`rollId`, `luckRoll`). Endpoint odrzuca zmiany podczas aktywnej walki.

POST `/api/games/:id/battle/act` używa istniejących `sessionId` i `version`. Nowe rodzaje: `awakened-mind` (`actorId`, `targetId`, `confirmed`, opcjonalne `combatant`), `clairvoyant-save` (`roll`, opcjonalne `roll2`, `advantage`, `disadvantage`, `luckRoll`), `clairvoyant-recover`, `hex-transfer`. Rzucenie Hex wymaga `targetIds` i `hexAbility`; Psychic Spells używa `psychic`. Rozliczenie trafienia z Hex wymaga `hexRolls`. Przy ręcznych obrażeniach psychicznych w Thought Shield potrzebny jest `sourceId`. Rzuty z Dark One’s Own Luck przyjmują pojedynczy `luckRoll` (1–10).

Zapis zasobów i walki jest atomowy w istniejącym savepoincie i transakcji Firestore. Nie ma migracji danych produkcyjnych; nowe pola zasobów mają bezpieczne wartości domyślne. Testy: `node --test server/warlock.test.mjs`, pełne `npm test`, kompilacja `npm run build`.
