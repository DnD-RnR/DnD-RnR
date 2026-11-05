export const fastCrafting = [
  { tool: "Carpenter's Tools", toolLabel: 'Narzędzia ciesielskie', options: [{ kind: 'item', id: 'ladder' }, { kind: 'item', id: 'torch' }] },
  { tool: "Leatherworker's Tools", toolLabel: 'Narzędzia rymarskie', options: [{ kind: 'item', id: 'case' }, { kind: 'item', id: 'pouch' }] },
  { tool: "Mason's Tools", toolLabel: 'Narzędzia murarskie', options: [{ kind: 'item', id: 'block-and-tackle' }] },
  { tool: "Potter's Tools", toolLabel: 'Narzędzia garncarskie', options: [{ kind: 'item', id: 'jug' }, { kind: 'item', id: 'lamp' }] },
  { tool: "Smith's Tools", toolLabel: 'Narzędzia kowalskie', options: [{ kind: 'item', id: 'ball-bearings' }, { kind: 'item', id: 'bucket' }, { kind: 'item', id: 'caltrops' }, { kind: 'item', id: 'grappling-hook' }, { kind: 'item', id: 'iron-pot' }] },
  { tool: "Tinker's Tools", toolLabel: 'Narzędzia majsterkowicza', options: [{ kind: 'item', id: 'bell' }, { kind: 'item', id: 'shovel' }, { kind: 'item', id: 'tinderbox' }] },
  { tool: "Weaver's Tools", toolLabel: 'Narzędzia tkackie', options: [{ kind: 'item', id: 'basket' }, { kind: 'item', id: 'rope' }, { kind: 'item', id: 'net' }, { kind: 'item', id: 'tent' }] },
  { tool: "Woodcarver's Tools", toolLabel: 'Narzędzia snycerskie', options: [{ kind: 'weapon', id: 'club' }, { kind: 'weapon', id: 'greatclub' }, { kind: 'weapon', id: 'quarterstaff' }] },
];

export const crafterTools = fastCrafting.map(entry => entry.tool);

export const crafterDescription = {
  toolProficiency: 'Biegłość w narzędziach: zyskujesz biegłość w trzech różnych narzędziach rzemieślniczych wybranych z tabeli Szybkie wytwarzanie.',
  discount: 'Rabat: za każdym razem, gdy kupujesz niemagiczny przedmiot, otrzymujesz na niego 20% rabatu.',
  fastCrafting: 'Szybkie wytwarzanie: po zakończeniu długiego odpoczynku możesz wytworzyć jeden przedmiot z tabeli Szybkie wytwarzanie, jeśli masz odpowiednie narzędzia i jesteś w ich posiadaniu.',
};

export function fastCraftingOptions(tools) {
  const owned = new Set(tools);
  return fastCrafting.flatMap(entry => owned.has(entry.tool) ? entry.options.map(option => ({ ...option, tool: entry.tool, toolLabel: entry.toolLabel })) : []);
}
