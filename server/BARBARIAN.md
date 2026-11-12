# Barbarian: level 3 (2024)

Implemented: Primal Knowledge, Path of the Berserker (Frenzy), Path of the Wild Heart (Animal Speaker, Rage of the Wilds). Totems is excluded. Subclass features from levels 6+ are outside this change.

Static data lives in `shared/trait-data.json` and `shared/barbarian.mjs`, with declarations in `shared/barbarian.d.mts`. Existing Primal Knowledge skill selection and Strength checks remain supported. Level 3 grants three Rage uses.

## Battle API

Use the existing `POST /api/games/:id/battle/act` route with session/version fields.

- Wild Heart activation: `{ kind: "rage", animal: "bear" | "eagle" | "wolf" }`. Each new Rage requires a fresh choice. Other subclasses cannot select an animal.
- Eagle: activation grants Dash and Disengage as part of the Rage bonus action. `{ kind: "eagle-flight" }` grants both again using a bonus action on a later turn. `extraMove` and `disengaged` describe the result; movement is still spent separately.
- Wolf: GM sends `{ kind: "wolf-aura", actorId, targetIds: [...] }` listing enemies within 5 feet of the barbarian. Allies automatically gain advantage against those enemies, including ranged and spell attacks; the source does not benefit from its own aura. The engine has no coordinates: GM must update this list after movement, using an empty list when no enemy is in range. Opportunity attacks and positioning remain GM adjudicated.
- Bear: damage and spell-defense resolution automatically apply resistance to the nine qualifying damage types. Resistance does not stack with an existing resistance.
- Frenzy: the first Strength hit on the barbarian's own turn during Rage and Reckless Attack sets `pending.frenzyDice`. Damage requests include `frenzyRolls` separately from weapon `rolls`; each result must be 1–6, with twice as many dice on a critical. Misses do not consume Frenzy. The once-per-turn flag resets at the start of the next own turn. Off-turn hits do not qualify.

## Animal Speaker

Public spell resources expose `ritualOnly: true` for Beast Sense and Speak with Animals. Wisdom is the casting ability. Casting these through the ordinary combat spell route is rejected.

Outside combat the character owner can POST `{ kind: "ritual", spellId: "beast-sense" | "speak-with-animals" }` to `/api/characters/:id/spell-resources`. This records completion of a GM-adjudicated ritual, without spending a slot; Beast Sense establishes concentration. The response supplies the base casting time and ten additional minutes. GM confirms elapsed time, components, targets, effects and duration. This endpoint does not run a real-time casting timer. Active combat and blocked spellcasting prevent completion.

The frontend controls for these new API fields are outside this backend change.
