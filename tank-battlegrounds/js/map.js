// Strategy-map model and rules. No DOM in here.
import { STOCK_AMMO, UNITS } from './weapons.js';

export const MAX_STACK = 8;
export const ART_RANGE = 3;
export const PLAYER_DEFS = [['Blue', '#4a90d9'], ['Red', '#d9534f'], ['Green', '#4caf50'], ['Yellow', '#e0b020']];
export const MAX_AMMO = 9;

/**
 * Buildings. `turn` runs at the start of its owner's turn and may add to the shared `ctx`
 * (tanks made, ammo gained). New building types / resources slot in here.
 */
export const BUILDINGS = {
  capital:   { icon: '🏰', name: 'Capital',      desc: 'Makes 1 tank and 1 Repair pack per turn. Lose it and you are out.',
               turn: (map, c, p, ctx) => { addTank(c, ctx); addAmmo(p, 'repair', ctx); } },
  factory:   { icon: '🏭', name: 'Tank factory', desc: 'Makes 1 tank per turn.',
               turn: (map, c, p, ctx) => addTank(c, ctx) },
  ammo:      { icon: '📦', name: 'Ammo depot',   desc: 'Makes 1 Heavy shell per turn, and a Nuke every 3rd round.',
               turn: (map, c, p, ctx) => { addAmmo(p, 'heavy', ctx); if (map.round % 3 === 0) addAmmo(p, 'nuke', ctx); } },
  artillery: { icon: '🎯', name: 'Artillery',    desc: `Fire support: unlocks the Artillery strike in battles within ${ART_RANGE} cells. More guns, bigger barrage.` },
};
function addTank(c, ctx) { if (c.tanks < MAX_STACK) { c.tanks++; ctx.tanks++; } }
function addAmmo(p, k, ctx) {
  if (!k || (p.ammo[k] || 0) >= MAX_AMMO) return;
  p.ammo[k] = (p.ammo[k] || 0) + 1; ctx.ammo.push(k);
}
/** What a player starts with. */
export function startingAmmo() {
  const a = {};
  for (const k of STOCK_AMMO) a[k] = k === 'heavy' ? 1 : 0;
  return a;
}

export const cellAt = (map, x, y) => (x >= 0 && y >= 0 && x < map.w && y < map.h ? map.cells[y * map.w + x] : null);
export const neighbors = (map, c) =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => cellAt(map, c.x + dx, c.y + dy)).filter(n => n && n.type === 'land');
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// ---------- rules ----------
export const sendable = c => Math.max(0, Math.min(c.ready, c.tanks - 1));
export const totalTanks = (map, id) => map.cells.reduce((s, c) => s + (c.owner === id ? c.tanks : 0), 0);
export const cellsOwned = (map, id) => map.cells.filter(c => c.owner === id);

/** Production and refresh at the start of a player's turn. Returns { tanks, ammo: [weapon keys] }. */
export function startTurn(map, id) {
  const p = map.players[id], ctx = { tanks: 0, ammo: [] };
  for (const c of cellsOwned(map, id)) {
    const b = BUILDINGS[c.building];
    if (b && b.turn) b.turn(map, c, p, ctx);
    c.ready = c.tanks;
  }
  return ctx;
}

/** 'move' (own cell), 'capture' (empty cell of someone else) or 'battle'. */
export function moveKind(id, dst) {
  if (dst.owner === id) return 'move';
  return dst.tanks === 0 ? 'capture' : 'battle';
}
export const roomFor = (id, dst) => (dst.owner === id ? MAX_STACK - dst.tanks : MAX_STACK);

function eliminate(map, loser) {
  map.players[loser].alive = false;
  for (const c of cellsOwned(map, loser)) { c.owner = -1; c.tanks = 0; c.ready = 0; }
}
function claim(map, id, dst) {
  if (dst.building === 'capital' && dst.owner >= 0 && dst.owner !== id) eliminate(map, dst.owner);
  dst.owner = id; dst.unit = 'tank';   // player armies are plain tanks
}
/** Fighting strength of a stack in plain-tank equivalents. */
export const strength = c => c.tanks * UNITS[c.unit || 'tank'].power;

/** Tanks leave `src` (they are away until the move or battle resolves). */
export function detach(src, n) { src.tanks -= n; src.ready = Math.max(0, src.ready - n); }

/** Tanks that detached from src arrive at dst without a fight. */
export function arrive(map, id, dst, n) {
  if (dst.owner !== id) claim(map, id, dst);
  dst.tanks = Math.min(MAX_STACK, dst.tanks + n);
}

/** result = { survivors: [attackers, defenders] } from a played or auto-resolved fight. */
export function applyBattle(map, id, src, dst, n, result) {
  const [sa, sd] = result.survivors;
  if (sa > 0 && sd === 0) { claim(map, id, dst); dst.tanks = sa; dst.ready = 0; }
  else if (sa === 0) dst.tanks = sd;
  else { dst.tanks = sd; src.tanks = Math.min(MAX_STACK, src.tanks + sa); } // both survived: attackers fall back
  if (dst.tanks === 0) dst.unit = 'tank';
}

/** Quick resolution when no human wants to play the fight out. */
export function autoResolve(n, d, unit = 'tank') {
  const u = UNITS[unit], pw = u.power / 1;
  let aHp = n * UNITS.tank.hp, dHp = d * u.hp;   // exchange hits until one side's hit points run out
  const count = (hp, per) => Math.ceil(hp / per);
  while (aHp > 0 && dHp > 0) {
    const a = count(aHp, UNITS.tank.hp), dd = count(dHp, u.hp) * pw;
    if (Math.random() < 0.9 * a / (a + dd)) dHp -= 50; else aHp -= 50;
  }
  const sa = Math.max(0, count(aHp, UNITS.tank.hp)), sd = Math.max(0, count(dHp, u.hp));
  return { survivors: [sa, sd], winner: sa > 0 ? 0 : sd > 0 ? 1 : -1 };
}

/** How many of `id`'s artillery buildings cover the cell where a battle takes place. */
export function artilleryStrength(map, id, at) {
  if (id < 0) return 0;
  return map.cells.filter(c => c.owner === id && c.building === 'artillery' && dist(c, at) <= ART_RANGE).length;
}

/** null while the game goes on, else { winner, humansOut }. */
export function gameResult(map) {
  const alive = map.players.filter(p => p.alive);
  const humans = map.players.filter(p => p.human);
  if (alive.length === 1) return { winner: alive[0].id };
  if (humans.length && !humans.some(p => p.alive)) return { winner: -1, humansOut: true };
  return null;
}
