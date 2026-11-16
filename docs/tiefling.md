# Tiefling — automatyzacja PHB 2024

Czary dziedzictwa korzystają z wybranego INT/WIS/CHA, niezależnie od cechy klasy.
Źródło `legacy` zużywa jedno bezpłatne użycie konkretnego czaru na długi odpoczynek.
Sloty zwykłe i Pact Magic są osobnym wyborem i pozwalają podnosić krąg.

## Efekty w walce

- Chill Touch: atak, k10 skalowane poziomem postaci, blokada odzyskiwania PW do końca następnej tury rzucającego.
- Ray of Sickness: atak, 2k8 + k8 za wyższy krąg, Poisoned do końca następnej tury rzucającego. Nie wymaga dodatkowego rzutu obronnego.
- False Life: na siebie, 2k4 + 4 tymczasowe PW, +5 za wyższy krąg. Tymczasowe PW nie sumują się; aplikacja zachowuje większą pulę.
- Hellish Rebuke: reakcja, rzut obronny DEX, 2k10 + k10 za wyższy krąg, połowa po sukcesie.
- Hold Person: WIS, Paralyzed, jeden dodatkowy cel za wyższy krąg. Znany typ musi być Humanoid; nieznany typ wymaga potwierdzenia MG.
- Ray of Enfeeblement: CON. Porażka daje utrudnienie testów D20 opartych na STR i odejmowanie k8 od rzutów obrażeń. Sukces daje utrudnienie następnego ataku do początku następnej tury rzucającego.

Hold Person i nieudany rzut przeciw Ray of Enfeeblement wymagają powtórzenia rzutu na koniec każdej tury celu. Przycisk rzutu kończy możliwość działania w tej turze. Efekty znikają po sukcesie, wygaśnięciu czasu albo zakończeniu koncentracji, także gdy rzucający rozpocznie nową koncentrację. Stany czarów nie nadpisują stanów ręcznie ustawionych przez MG.

MG potwierdza odporność na Poisoned i efekty stanów niezależnie od odporności na obrażenia. Paralyzed blokuje działania i ruch, daje ułatwienie ataków przeciw celowi i automatyczną porażkę rzutów STR/DEX. Trafienie krytyczne wymaga potwierdzenia odległości do 5 stóp. Zasięgi, widoczność i wyzwalacz Hellish Rebuke nadal potwierdza MG: silnik nie ma mapy ani modelu widoczności.

## Granice automatyzacji

Darkness pozostaje rozstrzygnięciem MG z opisem zasad i śledzeniem koncentracji (do 100 rund). Obszar, zasłanianie przedmiotu, światło oraz widzenie w magicznej ciemności wymagają decyzji MG. Thaumaturgy pozostaje efektem opisowym.

Aktywne stany i ich tury są przechowywane w stanie bieżącej walki. Ręczne efekty zadawane przez MG oraz zdolności bez własnej automatyzacji wymagają uwzględnienia przez MG utrudnień i redukcji obrażeń. Testy, rzuty obronne, broń, automatyczne czary, Hex i Psionic Strike obsługują wskazane modyfikatory.

Źródła: https://dnd2024.wikidot.com/species:tiefling oraz powiązane strony czarów `spell:chill-touch`, `spell:ray-of-sickness`, `spell:false-life`, `spell:hellish-rebuke`, `spell:hold-person`, `spell:ray-of-enfeeblement`, `spell:darkness`.
