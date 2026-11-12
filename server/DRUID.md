Druid — backend poziomów 1–2

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

Na tym etapie katalog zawiera pięć form. Specjalne efekty bestii (np. trucizna pająka, Pack Tactics i powalenie wilka) są opisane w notatkach walki do rozstrzygnięcia przez GM. Towarzysz jest zapisywany jako pojedynczy duch Fey; jego osobna inicjatywa, działania, zmysły i przekazywanie czarów wymagają rozstrzygnięcia GM. Brak nowych kontrolek frontendu i akcji przemiany poza walką. Poziomy 3+ są poza zakresem tej implementacji.
