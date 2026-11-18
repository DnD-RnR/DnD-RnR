const entries = [
  ['combat-prowess', 'Combat Prowess', 'Chybiony atak możesz zmienić w trafienie raz do początku następnej tury.'],
  ['dimensional-travel', 'Dimensional Travel', 'Po akcji Atak lub Magia możesz teleportować się do 30 stóp na widziane wolne pole.'],
  ['fate', 'Fate', 'Po teście k20 w 60 stopach dodaj lub odejmij 2k4; odnowienie po inicjatywie, krótkim lub długim odpoczynku.'],
  ['irresistible-offense', 'Irresistible Offense', 'Obrażenia obuchowe, kłute i cięte ignorują odporność. Naturalne 20 pozwala dodać wartość cechy zwiększonej tym atutem do obrażeń.'],
  ['night-spirit', 'the Night Spirit', 'W słabym świetle lub ciemności: odporność na wszystko poza Psychic/Radiant; akcją dodatkową Invisible do wykonania akcji, akcji dodatkowej lub reakcji.'],
  ['truesight', 'Truesight', 'Truesight 60 stóp.'],
];
export const epicBoons = entries.map(([id, suffix, description]) => ({ id: `boon-${id}`, name: `Boon of ${suffix}`, category: 'Epic Boon', source: 'SRD 5.2.1', group: 'Epic Boon', description, url: 'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf#page=88', humanOnly: false, repeatable: false, spells: [], spellAbility: false, abilityIncrease: 1, abilities: id === 'irresistible-offense' ? ['str', 'dex'] : ['str', 'dex', 'con', 'int', 'wis', 'cha'] }));
export const epicBoonForName = name => epicBoons.find(e => e.name === name);
