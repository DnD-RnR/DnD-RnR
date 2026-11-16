# Obrażenia kilku typów

Podstawa: lokalny `SRD_CC_v5.2.pdf`, Resistance and Vulnerability (s. 17), Concentration w Rules Glossary (s. 179), Flame Strike (s. 132), Ice Storm (s. 141–142), Meteor Swarm (s. 149).

Definicje w `shared/combat-spells.mjs` mają jawne komponenty obrażeń: liczbę i rozmiar kości, typ oraz skalowanie. Rzut kośćmi jest wspólny dla wszystkich jednoczesnych celów, a rzuty obronne i obrona przed każdym typem obrażeń są osobne. Serwer sprawdza każdą kość i wymaga zatwierdzenia wszystkich typów przez MG. Wbudowane odporności celu stosuje automatycznie, bez kumulowania kilku odporności na ten sam typ.

Kolejność rozliczenia: premie i kary, rzut obronny, redukcja obrażeń, odporność (zaokrąglenie w dół), podatność. Niewrażliwość zeruje dany typ. Płaska redukcja całego zdarzenia jest zużywana tylko raz, według kolejności komponentów. Psychic Spells zamienia komponenty na Psychic i łączy je przed rozliczeniem obrony na ten typ.

Końcowe obrażenia sumują się w jedno zdarzenie: jeden ubytek tymczasowych PW/PW, jeden skutek trafienia przy 0 PW i jeden test koncentracji od łącznych obrażeń. Thought Shield odbija tylko część psychiczną.

- Ice Storm: 2k10 Bludgeoning + 4k6 Cold, DEX na połowę; wyższy slot dodaje wyłącznie k10 Bludgeoning.
- Flame Strike: 5k6 Fire + 5k6 Radiant, DEX na połowę; wyższy slot dodaje k6 obu typów.
- Meteor Swarm: 20k6 Fire + 20k6 Bludgeoning, DEX na połowę. Ten sam cel może zostać wskazany tylko raz, również przy nakładających się sferach.

MG wybiera cele, pozycje, odległości i obszary. MG rozlicza trudny teren Ice Storm do końca następnej tury rzucającego oraz obrażenia i zapłon obiektów Meteor Swarm; formularz i dziennik przypominają te skutki. Silnik nie modeluje mapy ani obiektów otoczenia.

Jednorazowe obrażenia opóźnione Acid Arrow i Vitriolic Sphere obsługuje osobna [kolejka końca tury](delayed-spells.md). Cykliczne obrażenia oraz wyzwalacze wejścia w strefę nadal wymagają kolejnych mechanik.
