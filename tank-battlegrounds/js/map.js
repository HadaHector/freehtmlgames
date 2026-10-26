// Strategy-map model and rules. No DOM in here.
import { makeRng, hashSeed } from './util.js';
import { STOCK_AMMO } from './weapons.js';

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

const smooth = t => t * t * (3 - 2 * t);
function noiseField(w, h, rng, octaves) {
  const layers = octaves.map(([scale, amp]) => {
    const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
    return { scale, amp, gw, g: Array.from({ length: gw * gh }, () => rng.next()) };
  });
  return (x, y) => {
    let v = 0, s = 0;
    for (const L of layers) {
      const fx = x / L.scale, fy = y / L.scale, x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = smooth(fx - x0), ty = smooth(fy - y0);
      const a = L.g[y0 * L.gw + x0], b = L.g[y0 * L.gw + x0 + 1], c = L.g[(y0 + 1) * L.gw + x0], d = L.g[(y0 + 1) * L.gw + x0 + 1];
      v += L.amp * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty); s += L.amp;
    }
    return v / s;
  };
}

export const cellAt = (map, x, y) => (x >= 0 && y >= 0 && x < map.w && y < map.h ? map.cells[y * map.w + x] : null);
export const neighbors = (map, c) =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => cellAt(map, c.x + dx, c.y + dy)).filter(n => n && n.type === 'land');
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * cfg: { w, h, players, humans, seed, water }   (water = share of cells that are sea, e.g. 0.2)
 * The same cfg always yields the same map.
 */
export function generateMap(cfg) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const m = tryGenerate(cfg, attempt);
    if (m) return m;
  }
  throw new Error('Could not generate a map; try another seed or size.');
}

function tryGenerate(cfg, attempt) {
  const { w, h } = cfg;
  const rng = makeRng(hashSeed(cfg.seed, attempt));
  const elev = noiseField(w, h, rng, [[3.5, 0.65], [1.7, 0.35]]);
  const temp = noiseField(w, h, rng, [[4, 1]]);
  const moist = noiseField(w, h, rng, [[3, 1]]);

  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    cells.push({ x, y, idx: y * w + x, e: elev(x + 0.5, y + 0.5), t: temp(x + 0.5, y + 0.5), m: moist(x + 0.5, y + 0.5),
                 type: 'land', biome: 'meadow', height: 0, building: null, owner: -1, tanks: 0, ready: 0 });
  const map = { w, h, seed: cfg.seed, cells, players: [], round: 1 };

  const sorted = cells.map(c => c.e).sort((a, b) => a - b);
  const thr = sorted[Math.floor(cells.length * cfg.water)];
  for (const c of cells) if (c.e < thr) c.type = 'water';

  // keep only the biggest landmass so every cell can be reached
  const seen = new Set(); let best = [];
  for (const c of cells) {
    if (c.type !== 'land' || seen.has(c)) continue;
    const comp = [c], q = [c]; seen.add(c);
    while (q.length) for (const n of neighbors(map, q.shift())) if (!seen.has(n)) { seen.add(n); comp.push(n); q.push(n); }
    if (comp.length > best.length) best = comp;
  }
  const land = new Set(best);
  for (const c of cells) if (c.type === 'land' && !land.has(c)) c.type = 'water';
  if (best.length < cfg.players * 7) return null;

  const maxE = Math.max(...best.map(c => c.e));
  for (const c of best) {
    c.height = Math.min(3, Math.floor((c.e - thr) / (maxE - thr + 1e-9) * 4));
    c.biome = c.height >= 3 ? 'alps' : c.t < 0.28 ? 'arctic' : c.m < 0.3 ? 'desert' : 'meadow';
  }

  // capitals: spread out as far as possible
  const caps = [rng.pick(best)];
  while (caps.length < cfg.players) {
    let top = -1, cand = [];
    for (const c of best) {
      const d = Math.min(...caps.map(k => dist(k, c)));
      if (d > top) { top = d; cand = [c]; } else if (d === top) cand.push(c);
    }
    caps.push(rng.pick(cand));
  }
  rng.shuffle(caps);
  caps.forEach((c, i) => {
    const [name, col] = PLAYER_DEFS[i];
    map.players.push({ id: i, name, col, human: i < cfg.humans, alive: true, capital: c, ammo: startingAmmo() });
    c.owner = i; c.building = 'capital'; c.tanks = 4;
  });

  // starting territory: each player grows a few cells around their capital
  const frontier = map.players.map(p => [p.capital]);
  for (let round = 0; round < 3; round++) for (const p of map.players) {
    const opts = frontier[p.id].flatMap(c => neighbors(map, c)).filter(n => n.owner < 0);
    if (!opts.length) continue;
    const n = rng.pick(opts); n.owner = p.id; n.tanks = 2; frontier[p.id].push(n);
  }
  // neutral garrisons
  const neutral = best.filter(c => c.owner < 0);
  for (const c of neutral) c.tanks = rng.next() < 0.3 ? 0 : 1 + (c.height >= 2 ? 1 : 0) + (rng.next() < 0.3 ? 1 : 0);
  // buildings: a factory near each capital, the rest scattered on neutral ground
  for (const p of map.players) {
    const own = best.filter(c => c.owner === p.id && !c.building);
    if (own.length) rng.pick(own).building = 'factory';
  }
  const free = rng.shuffle(neutral.filter(c => !c.building));
  const kinds = ['factory', 'ammo', 'ammo', 'artillery', 'artillery'];
  free.slice(0, Math.max(3, Math.round(free.length * 0.25))).forEach((c, i) => { c.building = kinds[i % kinds.length]; });
  for (const c of map.cells) { c.ready = c.tanks; delete c.e; delete c.t; delete c.m; }
  return map;
}

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
  dst.owner = id;
}

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
}

/** Quick resolution when no human wants to play the fight out. */
export function autoResolve(n, d) {
  while (n > 0 && d > 0) { if (Math.random() < 0.9 * n / (n + d)) d--; else n--; }
  return { survivors: [n, d], winner: n > 0 ? 0 : d > 0 ? 1 : -1 };
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
