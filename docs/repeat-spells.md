# Ponawiane efekty czarów

Źródła: `SRD_CC_v5.2.pdf`, Heat Metal s. 139–140 i Spiritual Weapon s. 165. Witch Bolt nie występuje w tym SRD; użyto opisu wersji 2024 z [podanego katalogu](https://dnd2024.wikidot.com/spell:witch-bolt), zgodnego z zapisanym `shared/spell-catalog.json`.

`server/repeat-spells.mjs` rejestruje utrzymywany efekt, krąg, przeskalowane kości, premię, atak, ST i klucz koncentracji. Ponowienie wymaga późniejszej własnej tury, wolnej akcji bonusowej, kontroli nad rzucającym, możliwości działania oraz potwierdzenia warunków przestrzennych z MG. Nie wydaje slotu, nie ponawia rzucania czaru i nie rozpoczyna nowej koncentracji. Efekt znika przy końcu koncentracji, jej zastąpieniu lub wygaśnięciu czasu. Wszystkie trzy czary wymagają koncentracji do minuty.

Efekty są zapisywane wraz z walką i w zasobach rzucającego. Po wznowieniu walki nie powtarza się początkowego ataku ani obrażeń. Heat Metal wymaga od MG odtworzenia kontaktów z tym samym obiektem. Witch Bolt wymaga potwierdzenia ciągłości pierwotnego celu i nieprzerwanych warunków zasięgu; zapisane powiązanie z postacią nie pozwala wskazać innej postaci. Przy celu będącym potworem jego tożsamość potwierdza MG. Pozycje, osłony i zasięgi pozostają decyzją MG.

## Witch Bolt

Początkowy atak dystansowy zadaje 2k12 Lightning, plus k12 za krąg powyżej 1. Pudło nie usuwa utrzymywanego połączenia. Na późniejszych turach akcja bonusowa zadaje automatycznie dokładnie 1k12 Lightning, bez nowego ataku, krytyka ani dodatkowego Hex. Początkowy krytyk nadal podwaja kości początkowego ataku.

Cel jest stały i nie można zmienić go przy ponowieniu. MG kończy czar, jeśli cel kiedykolwiek oddali się ponad 60 stóp lub uzyska Total Cover. Powrót w zasięg nie przywraca zakończonego efektu. Aplikacja nie wykrywa tych zdarzeń z mapy; wymagają decyzji MG.

## Spiritual Weapon

Rzucenie kosztuje akcję bonusową. Początkowy atak jest opcjonalny. 1k8 Force + modyfikator cechy czarowania, plus k8 za każdy krąg powyżej 2. Na późniejszych turach akcja bonusowa pozwala przesunąć broń do 20 stóp i ponowić atak przeciw stworzeniu w 5 stopach od niej; można też przesunąć broń bez ataku.

Każdy atak ma osobny rzut, krytyk i aktualne odporności. Krytyk podwaja kości, a premię cechy dodaje raz. Trafienie może uruchomić Hex. MG rozstrzyga położenie broni oraz odległości istotne dla Prone i krytyków przeciw bezbronnym; pole potwierdzenia ataku do 5 stóp odnosi się do właściwej sytuacji według reguł ataku.

## Heat Metal

Przy rzucaniu wskazuje się nazwany, wytworzony metalowy przedmiot widoczny w 60 stopach i wszystkie stworzenia w fizycznym kontakcie. Obrażenia wynoszą 2k8 Fire, plus k8 za krąg powyżej 2. Zarówno początkowe, jak i późniejsze porcje są automatyczne i nie mają rzutu obronnego na zmniejszenie obrażeń. Na późniejszych turach akcja bonusowa ponawia obrażenia, jeśli przedmiot jest w zasięgu. MG może aktualizować kontakty bez zmiany tożsamości przedmiotu; kontaktów może nie być.

Przy zatwierdzaniu odporności MG osobno wskazuje, czy dany cel trzyma lub nosi przedmiot i czy może go teraz upuścić. Samo dotykanie wystarcza do obrażeń, ale nie do dodatkowego CON.

Po rzeczywistych obrażeniach trzymający/noszący cel wykonuje CON. Odporność całkowicie zerująca obrażenia oznacza brak tego rzutu. CON nie zmniejsza zadanych już obrażeń. Porażka wymusza upuszczenie, jeśli jest możliwe. Przy sukcesie można dobrowolnie upuścić. Upuszczenie usuwa cel z bieżącej listy kontaktów, a fizyczne przeniesienie przedmiotu i wyposażenie aktualizuje MG.

Jeśli cel nie upuszcza przedmiotu, także przy udanym CON, ma utrudnienie ataków i testów cech do początku następnej tury rzucającego. Nie jest to Poisoned i nie wpływa na rzuty obronne. Skutek może przetrwać wcześniejsze zakończenie koncentracji. Krótki skutek trzeba rozliczyć przed zakończeniem walki; nie pozwalamy mu zniknąć wskutek usunięcia rekordu walki. Nie można pominąć nierozstrzygniętego CON przy zmianie tury ani końcu walki.

Nie dodano tu ogólnej obsługi zdejmowania pancerza, automatycznego wypinania przedmiotów z ekwipunku ani fizyki kontaktów. Poza walką skutki czarów nadal rozstrzyga MG.
