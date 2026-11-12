Druid — backend poziomów 1–3

Zasady: https://dnd2024.wikidot.com/druid:main
Statystyki form 2024: https://www.aidedd.org/monster/ (Rat, Riding Horse, Spider, Wolf, Cat).

Wybory zapisuje istniejący POST `/api/characters/:id/statistics`:

- `spells.choices.order`: `magic` (Magician) lub `martial` (Warden).
- `spells.selections.cantrips`: 2 sztuczki, 3 dla Magician.
- `spells.selections.prepared`: 4 czary na poziomie 1, 5 na poziomie 2.
- `traits.druidForms`: na poziomie 2 cztery identyfikatory z katalogu `shared/druid.mjs`.

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

Na tym etapie katalog zawiera pięć form. Specjalne efekty bestii (np. trucizna pająka, Pack Tactics i powalenie wilka) są opisane w notatkach walki do rozstrzygnięcia przez GM. Towarzysz jest zapisywany jako pojedynczy duch Fey; jego osobna inicjatywa, działania, zmysły i przekazywanie czarów wymagają rozstrzygnięcia GM. Brak nowych kontrolek frontendu i akcji przemiany poza walką. Dynamiczne cechy od poziomu 4 pozostają poza zakresem tej implementacji.


## Poziom 3: Circle of the Moon

Zasady: https://dnd2024.wikidot.com/druid:circle-of-the-moon

Wybierz `subclass: "Circle of the Moon"` w danych postaci. Na poziomie 3 druid ma 6 przygotowanych czarow oraz miejsca 4/2 (kregi 1/2). Cure Wounds, Moonbeam i Starry Wisp sa automatyczne, poza limitami wyborow; trzeba usunac je z recznych wyborow przy zapisie awansu. Przejscie Cure Wounds do automatycznych czarow nie zuzywa wymiany po odpoczynku.

Circle Forms: maksymalne CR = floor(poziom druida / 3), KP formy = max(KP bestii, 13 + modyfikator Wisdom), tymczasowe PW = 3 * poziom (9 na poziomie 3; nie sumuja sie z poprzednimi). Nadal cztery znane formy, bez latania i jedna wymiana po dlugim odpoczynku. Katalog rozszerzono o Dire Wolf (CR 1), statystyki 2024: https://www.aidedd.org/monster/dire-wolf. Pack Tactics i powalenie rozstrzyga GM.

Podczas Wild Shape akcja `cast` dopuszcza Cure Wounds, Moonbeam i Starry Wisp; pozostale czary sa blokowane przed zuzyciem zasobow. Obowiazuja normalne koszty akcji, miejsc i koncentracji. `spellcasting.druid` udostepnia `circleOfTheMoon`, `temporaryHitPoints` oraz `wildShapeSpells`. Inne kregi nie otrzymuja dynamicznych zasad w tej zmianie.
