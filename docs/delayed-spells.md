# Obrażenia opóźnione na koniec tury

Źródło: lokalny `SRD_CC_v5.2.pdf`: Acid Arrow, s. 107; Vitriolic Sphere, s. 172; Damage Rolls i Resistance and Vulnerability, s. 16–17; Concentration w Rules Glossary, s. 179. Katalog aplikacji używa nazwy Melf's Acid Arrow i identyfikatora `melfs-acid-arrow`.

## Zasady czarów

- Acid Arrow: atak czarem, 4k4 Acid przy trafieniu i 2k4 Acid na koniec następnej tury celu. Pudło zadaje połowę początkowych obrażeń i nie tworzy późniejszego efektu. Wyższy slot dodaje k4 do obu porcji. Krytyk podwaja tylko kości obrażeń trafienia, bez podwajania późniejszych kości. Shield zmieniający trafienie w pudło nadal pozostawia połowę początkowych obrażeń.
- Vitriolic Sphere: DEX, 10k4 Acid i 5k4 Acid na koniec następnej tury celu przy porażce; sukces daje połowę wyłącznie początkowych obrażeń. Wyższy slot dodaje 2k4 wyłącznie do początkowych obrażeń.

## Kolejka

`server/delayed-spells.mjs` zapisuje osobne zdarzenie z celem, źródłem, czarem, typem, kośćmi i rundą końca następnej tury celu. Cel, którego tura jest jeszcze przed nim w bieżącej rundzie, otrzymuje efekt na jej koniec. Cel będący w trakcie swojej tury lub po niej otrzymuje efekt na koniec swojej tury w następnej rundzie. Osobne rzucenia mają osobne zdarzenia. Są to następstwa czarów natychmiastowych; nie zależą od koncentracji ani przeżycia rzucającego.

Kolejka należy do wersjonowanego rekordu walki i jest zapisywana w tej samej transakcji co obrażenia oraz zasoby. Przeładowanie strony i odtworzenie danych nie gubi zdarzeń. Rozliczenie usuwa zdarzenie dokładnie raz. Martwe cele opuszczające walkę nie pozostawiają blokujących zdarzeń.

Panel pokazuje oczekujące obrażenia. Właściciel celu lub MG może wybrać ich kolejność względem innych efektów końca tury; rozpoczęcie rozliczenia blokuje dalsze zwykłe działania w tej turze. Przycisk zakończenia tury również otwiera zaległy efekt, zanim przesunie inicjatywę. Obrażenia może rzucić właściciel celu lub MG, również przy Incapacitated i 0 PW. MG zatwierdza aktualne odporności ponownie: mogą być inne niż podczas pierwszego trafienia. Nie ma nowego ataku, rzutu obronnego, wydatku akcji ani slotu.

Każda późniejsza porcja jest nowym zdarzeniem obrażeń: rozlicza tymczasowe PW, PW, skutki przy 0 PW i osobny test koncentracji. Nie jest trafieniem krytycznym. Zwykły ruch i akcje pozostają zablokowane po rozpoczęciu rozliczeń końca tury; zapisy obronne końca tury, koncentracja i Relentless Rage nadal są dostępne.

Przed zakończeniem walki trzeba dokończyć najbliższe tury celów i rozliczyć kolejkę. Silnik nie przenosi tych kilkusekundowych efektów do eksploracji i nie pozwala ich skasować przyciskiem zakończenia walki. Poza walką efekty rzuconych czarów nadal rozstrzyga MG. Pozycje, odległości, widoczność, komponenty i obszary pozostają decyzją MG.

Ta mechanika obejmuje jednorazowe obrażenia na koniec następnej tury. Ciągłe obrażenia na początku/końcu wielu tur, wejście w strefę i ruch stref nadal wymagają kolejnych mechanik.
