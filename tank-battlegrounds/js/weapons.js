export const WEAPONS = {
  shell:    { name: 'Shell',     kind: 'blast',   r: 26,  dmg: 30,  ammo: Infinity, col: '#ffd54a' },
  heavy:    { name: 'Heavy',     kind: 'blast',   r: 48,  dmg: 55,  ammo: 3, col: '#ff6b3d' },
  cluster:  { name: 'Cluster',   kind: 'cluster', r: 22,  dmg: 20,  ammo: 3, col: '#7ee0ff' },
  dirt:     { name: 'Dirt',      kind: 'dirt',    r: 34,  dmg: 0,   ammo: 3, col: '#b98a52' },
  triple:   { name: 'Triple',    kind: 'blast',   r: 20,  dmg: 25,  ammo: 4, col: '#ffb3e6' },
  bouncer:  { name: 'Bouncer',   kind: 'bounce',  r: 30,  dmg: 35,  ammo: 3, col: '#9f9' },
  digger:   { name: 'Digger',    kind: 'dig',     r: 11,  dmg: 14,  ammo: 3, col: '#ddd' },
  airstrike:{ name: 'Airstrike', kind: 'rain',    r: 0,   dmg: 0,   ammo: 2, col: '#f66' },
  teleport: { name: 'Teleport',  kind: 'tele',    r: 0,   dmg: 0,   ammo: 2, col: '#c9f' },
  nuke:     { name: 'Nuke',      kind: 'blast',   r: 110, dmg: 100, ammo: 1, col: '#fff' },
  bomblet:  { name: 'Bomblet',   kind: 'blast',   r: 20,  dmg: 22,  col: '#7ee0ff' },
};
export const RULES = {
  classic: { weapons: ['shell'], desc: 'Just a plain shell. Pure aim and wind.' },
  arsenal: { weapons: ['shell', 'heavy', 'cluster', 'dirt'], desc: 'Shell, Heavy, Cluster and Dirt bombs.' },
  crazy:   { weapons: ['shell', 'triple', 'bouncer', 'digger', 'airstrike', 'cluster', 'dirt', 'teleport', 'nuke'],
             desc: 'Nukes, bouncers, drills, airstrikes, teleports and more.' },
};
export const AI_WEAPONS = ['heavy', 'cluster', 'triple', 'airstrike', 'nuke'];
export const SAFE = { airstrike: 120, nuke: 135 };
export const DIFF = {
  easy:   { n0: 4.5, nmin: 2.0,  decay: 0.9,  special: 0.2,  target: 'random' },
  normal: { n0: 2.5, nmin: 0.7,  decay: 0.8,  special: 0.45, target: 'near' },
  hard:   { n0: 1.5, nmin: 0.3,  decay: 0.75, special: 0.6,  target: 'weak' },
  insane: { n0: 0.6, nmin: 0.05, decay: 0.6,  special: 0.8,  target: 'weak' },
};
