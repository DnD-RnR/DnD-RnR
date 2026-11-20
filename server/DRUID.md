Druid — backend zasad 2024

Zasady: https://dnd2024.wikidot.com/druid:main
Statystyki form 2024: https://www.aidedd.org/monster/ (Rat, Riding Horse, Spider, Wolf, Cat).

Wybory zapisuje istniejący POST `/api/characters/:id/statistics`:

- `spells.choices.order`: `magic` (Magician) lub `martial` (Warden).
- `spells.selections.cantrips`: 2 sztuczki, 3 dla Magician.
- `spells.selections.prepared`: 4 czary na poziomie 1, 5 na poziomie 2.
- `traits.druidForms`: cztery formy od 2. poziomu, sześć od 4. i osiem od 8., z katalogu `shared/druid.mjs`.

Druidic i Speak with Animals są automatyczne. Historia wyborów jest własnością serwera. Jedna wymiana sztuczki przysługuje przy awansie; przygotowanie czarów oraz jedna wymiana formy wymagają długiego odpoczynku.

Akcje w istniejącym POST `/api/games/:id/battle/act`, z `sessionId`, aktualnym `version` i opcjonalnym `actorId`:

```json
{ "kind": "wild-shape", "formId": "wolf", "equipment": "merge" }
{ "kind": "wild-shape-end" }
{ "kind": "wild-companion", "source": "wild-shape", "form": "owl" }
{ "kind": "wild-companion", "source": "slot", "level": 1, "form": "owl" }
```

Wild Shape zużywa akcję bonusową; kolejne użycie może zmienić aktywną formę. Wild Companion zużywa akcję Magic. Wyposażenie może być scalone (`merge`) lub upuszczone (`drop`); noszenie przedmiotów przez bestię wymaga rozstrzygnięcia GM i nie jest automatyzowane. Backend nie przestawia przedmiotów w ekwipunku.

GET `/api/characters/:id/spell-resources` zwraca dodatkowe `spellcasting.druid`: limity, pozostałe użycia, znane formy, aktywną przemianę i towarzysza. Przemiana trwa godzinę na poziomie 2 i przechodzi między walkami; utrata przytomności, Incapacitated, śmierć lub upływ czasu ją kończą. Koncentracja pozostaje aktywna. Krótki odpoczynek przywraca jedno użycie, długi wszystkie i usuwa towarzysza.

Katalog obejmuje wybrane bestie, w tym formy latające i pływające. Specjalne efekty bestii (np. trucizna pająka, Pack Tactics i powalenie wilka) są opisane w notatkach walki do rozstrzygnięcia przez GM. Towarzysz jest zapisywany jako pojedynczy duch Fey; jego osobna inicjatywa, działania, zmysły i przekazywanie czarów wymagają rozstrzygnięcia GM. Brak nowych kontrolek frontendu i akcji przemiany poza walką.


## Poziom 3: Circle of the Moon

Zasady: https://dnd2024.wikidot.com/druid:circle-of-the-moon

Wybierz `subclass: "Circle of the Moon"` w danych postaci. Na poziomie 3 druid ma 6 przygotowanych czarow oraz miejsca 4/2 (kregi 1/2). Cure Wounds, Moonbeam i Starry Wisp sa automatyczne, poza limitami wyborow; trzeba usunac je z recznych wyborow przy zapisie awansu. Przejscie Cure Wounds do automatycznych czarow nie zuzywa wymiany po odpoczynku.

Circle Forms: maksymalne CR = floor(poziom druida / 3), KP formy = max(KP bestii, 13 + modyfikator Wisdom), tymczasowe PW = 3 * poziom (9 na poziomie 3; nie sumuja sie z poprzednimi). Nadal cztery znane formy, bez latania i jedna wymiana po dlugim odpoczynku. Katalog rozszerzono o Dire Wolf (CR 1), statystyki 2024: https://www.aidedd.org/monster/dire-wolf. Pack Tactics i powalenie rozstrzyga GM.

Podczas Wild Shape akcja `cast` dopuszcza odblokowane zaklęcia Circle of the Moon. Od poziomu 18 Beast Spells dopuszcza także inne dostępne czary, jeśli ich komponent materialny nie ma wskazanego kosztu i nie jest zużywany.

## Wyższe poziomy i Circle of the Land

Komendy walki korzystają z istniejącej ścieżki `battle/act`.

- `wild-resurgence-shape` przyjmuje `level` zużywanego slotu. `wild-resurgence-slot` zamienia użycie Wild Shape na slot 1. kręgu. `nature-magician` przyjmuje liczbę użyć w polu `uses`. Poza walką te same komendy przyjmuje POST `spell-resources` z wersją zasobów.
- `spells.choices.elementalFury` przyjmuje `potent` lub `strike`. Primal Strike w akcji `damage` przyjmuje `primalStrikeRolls` i `primalStrikeType`. Potent Spellcasting modyfikuje obrażenia czarów i zwracaną wartość zasięgu.
- `lands-aid` przyjmuje `targetIds` obrażeń, opcjonalne `healTargetId` i `healRolls` oraz `confirmed: true`. Obrony i obrażenia rozpatrują istniejące akcje czarów.
- `natural-recovery` to źródło dla `cast`. Odzyskanie slotów obsługuje `spell-rest` z `rest: "short"` i `naturalRecovery` w formacie `{ "identyfikator postaci": [1, 2] }`.
- `nature-sanctuary` i `nature-sanctuary-move` przyjmują `targetIds` dla sojuszników w obszarze oraz `confirmed: true`. MG aktualizuje listę przez `nature-sanctuary-members`, wskazując Druida w `actorId`.
- `moonlight-step` przyjmuje `confirmed: true`. Shared Moonlight wymaga dodatkowo `targetId` i `confirmedCompanion: true`. `moonlight-step-recover` przyjmuje `level` slotu. Przy rozpatrywaniu obrażeń z ataku bestii `lunarRadiance: true` zmienia typ na Radiant, a `improvedLunarRolls` przekazuje kości dodatkowych obrażeń od poziomu 14.

Zasięg, położenie obszarów i cele teleportacji potwierdza MG. Źródło zasad Circle of the Land i dodatkowych statystyk bestii to [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf).
