export function halflingFields(form: HTMLFormElement) {
  const data = new FormData(form);
  return Object.fromEntries(['halflingRoll', 'halflingRoll2'].filter(key => data.get(key)).map(key => [key, Number(data.get(key))]));
}
export function HalflingLuck({ species }: { species?: string }) {
  if (species !== 'Niziołek (Halfling)') return null;
  return <fieldset><legend>Luck — opcjonalny przerzut wyłącznie kości z wynikiem 1</legend><label>Nowy wynik pierwszej k20<input name="halflingRoll" type="number" min={1} max={20} /></label><label>Nowy wynik drugiej k20<input name="halflingRoll2" type="number" min={1} max={20} /></label></fieldset>;
}
