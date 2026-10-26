export const WEAPONS = {
  // tier: 'light' / 'big' weapons use the player's ammo stockpile; 'support' is enabled by artillery buildings
  shell:    { name: 'Shell',     kind: 'blast',   r: 26,  dmg: 30,  col: '#ffd54a' },
  heavy:    { name: 'Heavy',     kind: 'blast',   r: 48,  dmg: 55,  tier: 'big',     col: '#ff6b3d' },
  nuke:     { name: 'Nuke',      kind: 'blast',   r: 110, dmg: 100, tier: 'big',     col: '#fff' },
  cluster:  { name: 'Cluster',   kind: 'cluster', r: 22,  dmg: 20,  tier: 'light',   col: '#7ee0ff' },
  dirt:     { name: 'Dirt',      kind: 'dirt',    r: 34,  dmg: 0,   tier: 'light',   col: '#b98a52' },
  triple:   { name: 'Triple',    kind: 'blast',   r: 20,  dmg: 25,  tier: 'light',   col: '#ffb3e6' },
  bouncer:  { name: 'Bouncer',   kind: 'bounce',  r: 30,  dmg: 35,  tier: 'light',   col: '#9f9' },
  digger:   { name: 'Digger',    kind: 'dig',     r: 11,  dmg: 14,  tier: 'light',   col: '#ddd' },
  teleport: { name: 'Teleport',  kind: 'tele',    r: 0,   dmg: 0,   tier: 'light',   col: '#c9f' },
  artillery:{ name: 'Artillery', kind: 'barrage', r: 0,   dmg: 0,   tier: 'support', col: '#f90' },
  bomblet:  { name: 'Bomblet',   kind: 'blast',   r: 20,  dmg: 22,  col: '#7ee0ff' },
  shellfall:{ name: 'Barrage',   kind: 'blast',   r: 26,  dmg: 32,  col: '#f90' },
};
/** Artillery: a strike is usable from this battle round, then again every ART_COOLDOWN rounds. */
export const ART_FIRST_ROUND = 3, ART_COOLDOWN = 5;
export const RULES = {
  classic: { weapons: ['shell'], desc: 'Just a plain shell. Pure aim and wind.' },
  arsenal: { weapons: ['shell', 'heavy', 'cluster', 'dirt', 'artillery'], desc: 'Shell, Heavy, Cluster and Dirt bombs, plus artillery support.' },
  crazy:   { weapons: ['shell', 'triple', 'bouncer', 'digger', 'cluster', 'dirt', 'teleport', 'heavy', 'nuke', 'artillery'],
             desc: 'Nukes, bouncers, drills, teleports, artillery and more.' },
};
export const AI_WEAPONS = ['heavy', 'cluster', 'triple', 'artillery', 'nuke'];
export const SAFE = { artillery: 170, nuke: 135 };
export const DIFF = {
  easy:   { n0: 4.5, nmin: 2.0,  decay: 0.9,  special: 0.2,  target: 'random' },
  normal: { n0: 2.5, nmin: 0.7,  decay: 0.8,  special: 0.45, target: 'near' },
  hard:   { n0: 1.5, nmin: 0.3,  decay: 0.75, special: 0.6,  target: 'weak' },
  insane: { n0: 0.6, nmin: 0.05, decay: 0.6,  special: 0.8,  target: 'weak' },
};
