// Units and weapons. A unit type has its own infinite basic weapon; heavier weapons come from
// the player's ammo stockpile (made by ammo depots), and artillery from artillery buildings.
export const UNITS = {
  tank: { name: 'Tank', weapon: 'shell' },
};
export const DEFAULT_WEAPON = UNITS.tank.weapon;

export const WEAPONS = {
  shell:     { name: 'Shell',     kind: 'blast',   r: 26,  dmg: 30,  col: '#ffd54a' },
  heavy:     { name: 'Heavy',     kind: 'blast',   r: 48,  dmg: 55,  col: '#ff6b3d', stock: true },
  nuke:      { name: 'Nuke',      kind: 'blast',   r: 110, dmg: 100, col: '#fff',    stock: true },
  repair:    { name: 'Repair',    kind: 'heal',    r: 45,  heal: 50, col: '#5f5',    stock: true },   // lob it at a tank (even yourself)
  artillery: { name: 'Artillery', kind: 'barrage', r: 0,   dmg: 0,   col: '#f90' },
  shellfall: { name: 'Barrage',   kind: 'blast',   r: 26,  dmg: 32,  col: '#f90' },   // one shell of an artillery barrage
};
/** Weapons selectable in battle, in menu order (stock ones need ammo, artillery needs guns in range). */
export const BATTLE_WEAPONS = ['shell', 'heavy', 'nuke', 'repair', 'artillery'];
/** Ammo types that live in the player's stockpile. */
export const STOCK_AMMO = BATTLE_WEAPONS.filter(k => WEAPONS[k].stock);

/** Artillery: a strike is usable from this battle round, then again every ART_COOLDOWN rounds. */
export const ART_FIRST_ROUND = 3, ART_COOLDOWN = 5;

export const AI_WEAPONS = ['heavy', 'artillery', 'nuke'];
export const SAFE = { artillery: 170, nuke: 135 };
export const DIFF = {
  easy:   { n0: 4.5, nmin: 2.0,  decay: 0.9,  special: 0.2,  target: 'random' },
  normal: { n0: 2.5, nmin: 0.7,  decay: 0.8,  special: 0.45, target: 'near' },
  hard:   { n0: 1.5, nmin: 0.3,  decay: 0.75, special: 0.6,  target: 'weak' },
  insane: { n0: 0.6, nmin: 0.05, decay: 0.6,  special: 0.8,  target: 'weak' },
};
