// SRD 5.2.1 pp. 84–86; Aasimar: https://dnd2024.wikidot.com/species:aasimar
export const elvenLineages = [
  { id: 'drow', label: 'Drow', spells: ['dancing-lights', 'faerie-fire', 'darkness'] },
  { id: 'high', label: 'High Elf', spells: ['prestidigitation', 'detect-magic', 'misty-step'] },
  { id: 'wood', label: 'Wood Elf', spells: ['druidcraft', 'longstrider', 'pass-without-trace'] },
];
export function speciesResistances(species) {
  if (species === 'Aasimar') return ['nekrotyczne', 'promieniste'];
  if (species === 'Krasnolud (Dwarf)') return ['trucizna'];
  return [];
}
export function speciesSaveAdvantage(f, ability, condition) {
  return f.species === 'Gnom (Gnome)' && ['int', 'wis', 'cha'].includes(ability)
    || f.species === 'Elf' && condition === 'charmed'
    || f.species === 'Krasnolud (Dwarf)' && condition === 'poisoned'
    || f.species === 'Niziołek (Halfling)' && condition === 'frightened';
}
export function speciesD20(f, roll, reroll) {
  if (reroll == null) return roll;
  if (f.species !== 'Niziołek (Halfling)' || roll !== 1 || !Number.isInteger(reroll) || reroll < 1 || reroll > 20) throw new Error('Luck: przerzut k20 jest dostępny Niziołkowi tylko dla wyniku 1.');
  return reroll;
}
export const speciesNotes = {
  Aasimar: [
    ['Healing Hands', 'Akcja Magia, dotyk: leczenie tyloma k4, ile wynosi premia biegłości; raz na długi odpoczynek.'],
    ['Light Bearer', 'Znasz Light; cechą czarowania jest Charyzma.'],
    ['Celestial Revelation', 'Od 3. poziomu akcja dodatkowa: przemiana na minutę, raz na długi odpoczynek. Za każdym razem wybierz skrzydła, blask albo całun. Raz we własnej turze możesz dodać premię biegłości do obrażeń zadanych atakiem lub czarem.'],
  ],
  Elf: [['Trance', 'Nie potrzebujesz snu; magia nie może cię uśpić. Świadoma medytacja pozwala zakończyć długi odpoczynek w 4 godziny.']],
  'Krasnolud (Dwarf)': [['Stonecunning', 'Akcja dodatkowa: Tremorsense 60 stóp przez 10 minut podczas kontaktu z kamieniem. Liczba użyć równa premii biegłości; odnowienie po długim odpoczynku.']],
  'Niziołek (Halfling)': [
    ['Brave', 'Ułatwienie rzutów obronnych przeciw Frightened.'],
    ['Luck', 'Możesz przerzucić k20 z wynikiem 1 w teście k20; nowy wynik jest wiążący.'],
    ['Halfling Nimbleness', 'Możesz przechodzić przez pole istoty większej od ciebie, ale nie możesz zakończyć na nim ruchu.'],
    ['Naturally Stealthy', 'Możesz wykonać Hide, gdy zasłania cię jedynie większa istota.'],
  ],
};
