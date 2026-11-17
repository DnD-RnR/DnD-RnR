# Armor of Agathys, Fire Shield i Sanctuary

Źródła: lokalny `SRD_CC_v5.2.pdf`, Fire Shield s. 132, Sanctuary s. 159. Armor of Agathys nie występuje w tym SRD; użyto [opisu 2024 z podanego katalogu](https://dnd2024.wikidot.com/spell:armor-of-agathys), zgodnego z lokalnym katalogiem.

## Obrażenia wyzwalane trafieniem

Wspólny moduł `server/protective-spells.mjs` zapisuje wyzwalacze potwierdzonego trafienia i rozlicza je w osobnej kolejce. Typ ataku pochodzi z broni lub znanego czaru; przy broni miotanej, potworach i wyjątkach MG wskazuje melee/ranged oraz odległość do 5 stóp. Shield zmieniający trafienie w pudło nie uruchamia kolejki.

Efekt jest zapamiętany przed rozliczeniem pierwotnych obrażeń. Dzięki temu trafienie, które zużyje ostatnie tymczasowe PW lub pokona obrońcę, nadal może wywołać należne obrażenia zwrotne. Wyzwalacz nie wymaga zużycia reakcji, nowego ataku ani rzutu obronnego i nie jest podwajany przez krytyk pierwotnego ataku. Nie uruchamia następnej osłony, bo sam nie jest trafieniem atakiem wręcz.

Obrażenia może rozliczyć właściciel osłony, właściciel otrzymującego je stworzenia lub MG. Wymagane jest zatwierdzenie aktualnych odporności. Obrażenia wywołują zwykłe skutki dla PW, tymczasowych PW i koncentracji. Nie można ich skasować przejściem do następnej tury lub zakończeniem walki. Kolejka zachowuje przerwane rozliczenie kolejnego promienia; nie wymaga ponownego wydania slotu.

## Armor of Agathys

Akcja bonusowa, własna postać, bez koncentracji, do godziny. Zyskuje 5 tymczasowych PW za krąg slotu. Trafiające ją stworzenie otrzymuje 5 Cold za krąg, jeśli trafi atakiem wręcz przed końcem czaru. Nie ma ograniczenia do odległości 5 stóp.

Czar trwa, dopóki postać ma jakiekolwiek tymczasowe PW. Zastąpienie puli większą z innego źródła nie usuwa osłony i nie zwiększa jej obrażeń zwrotnych. Utrata wszystkich tymczasowych PW kończy ją natychmiast, przed ewentualnym przyznaniem kolejnej puli. Ostatnie trafienie nadal uruchamia zapisany wyzwalacz. Przy rzucaniu stosujemy dotychczasową zasadę korzystniejszej puli: tymczasowe PW nie sumują się. Psychic Spells może zmienić typ należnych obrażeń, jeśli postać spełnia jego warunki.

## Fire Shield

Akcja, własna postać, bez koncentracji, 10 minut. Przy rzucaniu wybiera się warm/chill. Warm daje Resistance do Cold i zwraca 2k8 Fire; chill daje Resistance do Fire i zwraca 2k8 Cold. Tylko trafienie atakiem wręcz ze strony stworzenia w odległości do 5 stóp uruchamia obrażenia. Atak dystansowy, pudło i trafienie z dalszego zasięgu nie wystarczają.

Odporność jest częścią wspólnego rejestru i nie dzieli ponownie obrażeń od kolejnej odporności tego samego typu. Osłona nie wymaga przytomności ani wolnej reakcji. Światło 10 stóp jasne + 10 stóp przyćmione oraz widoczność rozstrzyga MG.

## Sanctuary

Akcja bonusowa, jeden cel w 30 stopach, bez koncentracji, minuta. Zapisujemy ST rzucającego. Próba ataku przeciw chronionemu celowi otwiera WIS przed wykonaniem ataku. Rzut uwzględnia premie, Bless/Bane, Hex, Mind Sliver, uprawnione Luck i Exhaustion. Sukces wznawia tę samą próbę. Porażka pozwala wybrać inny cel albo stracić atak/czar; nie można ponownie testować tego samego odrzuconego celu w ramach tej próby. Nowy cel z Sanctuary wymaga własnego WIS.

Utrata zwykłego ataku zużywa jeden atak odpowiedniej akcji. Utrata promienia zużywa ten promień, zachowując pozostałe i wcześniej wydany slot. Utrata kierowanego czaru z obrażeniami zużywa działanie i slot, nie wywołując jego efektu. Przy zmianie celu można podać potrzebne kości samego ataku, jeśli nowy cel zmienia ułatwienie/utrudnienie. Zmiana celu nadal podlega zwykłym zasadom danego ataku lub czaru i potwierdzeniu przez MG.

Obszary omijają ochronę. Kilka celów nie oznacza jednak automatycznie obszaru: Chain Lightning ma jawne cele i sprawdza każdego chronionego odbiorcę. Czary z wieloma atakami sprawdzają ochronę dla kolejnych prób ataku. Sanctuary nie chroni przed niezadającymi obrażeń czarami bez ataku, takimi jak Hold Person.

Ochrona kończy się, gdy beneficjent wykonuje rzut na atak, rzuca dowolny czar albo zadaje rzeczywiste obrażenia. Dotyczy to także obrażeń utrzymywanej strefy, opóźnionego czaru i osłony zwrotnej. Samo otrzymanie obrażeń jej nie kończy. Rzucenie kolejnego Sanctuary na siebie usuwa poprzedni egzemplarz przed nałożeniem nowego. Dla efektów nieobsługiwanych przez silnik i ręcznych rozstrzygnięć MG musi uwzględnić ochronę oraz jej zakończenie; nie analizujemy opisów zaklęć w trakcie gry.

## Trwałość i granice

Efekty, warianty, ST i pozostały czas są zapisywane w rejestrze postaci lub potwora. Kolejka obrażeń oraz zawieszona próba Sanctuary są częścią wersjonowanego zapisu walki; wewnętrzne dane wznawiania nie są wysyłane jako formularz gracza. Poza walką można zapisać wariant Fire Shield i zastosować te osłony do własnej postaci; zdarzenia bojowe poza walką rozstrzyga MG. Pozostałe pozycje, dystanse, światło i wyjątkowe źródła ataków także wymagają decyzji MG.
