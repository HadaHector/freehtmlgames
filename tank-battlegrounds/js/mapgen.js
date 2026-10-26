// Map generator. A *layout* (continent, lake, highlands) decides the shape of the land and where the
// contested "prize" buildings go; players sit at even angles around the centre so every player has about
// the same distance to the middle and to each other (works for 2, 3, 4... players alike).
import { makeRng, hashSeed } from './util.js';
import { neighbors, cellsOwned, PLAYER_DEFS, startingAmmo } from './map.js';

export const TERRITORY = 0.6;                  // share of land handed to the players at the start
export const START_BUILDINGS = ['factory', 'ammo'];   // every player starts with these near their capital

/**
 * shape(ctx): is the cell land, and how high? ctx = { d, n, hn } where d is the distance from the map
 * centre (0 = centre, 1 = edge of the circle), n a coast-roughness noise and hn a height noise (0..1).
 * prizes: contested buildings placed on neutral ground. at: 'center' | 'between' (halfway between two
 * neighbouring players, at radius r) | 'scatter'. guard: 'heavy' | 'strong' | null.
 */
export const LAYOUTS = {
  continent: {
    name: 'Continent', capitalR: 0.62,
    shape: ({ d, n, edge }) => ({ land: edge - d + (n - 0.5) * 0.5 > 0 }),
    prizes: [
      { at: 'center', building: 'artillery', guard: 'heavy' },
      { at: 'between', r: 0.6, building: 'factory', guard: 'strong' },
      { at: 'scatter', per: 1, building: 'ammo' },
    ],
  },
  lake: {
    name: 'Lake', capitalR: 0.64,
    shape: ({ d, n, edge }) => ({ land: edge - d + (n - 0.5) * 0.4 > 0 && d + (n - 0.5) * 0.15 > 0.3 }),
    prizes: [
      { at: 'between', r: 0.45, building: 'artillery', guard: 'heavy' },
      { at: 'between', r: 0.82, building: 'ammo', guard: 'strong' },
      { at: 'scatter', per: 1, building: 'factory' },
    ],
  },
  highlands: {
    name: 'Highlands', capitalR: 0.66,
    shape: ({ d, n, edge, hn }) => ({ land: edge - d + (n - 0.5) * 0.45 > 0, lift: d < 0.3 ? 2 : d < 0.5 ? 1 : 0 }),
    prizes: [
      { at: 'center', building: 'artillery', guard: 'heavy' },
      { at: 'between', r: 0.55, building: 'ammo', guard: 'strong' },
      { at: 'between', r: 0.85, building: 'factory' },
    ],
  },
};

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
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * cfg: { w, h, players, humans, seed, water, layout }   water = share of sea (0.1 / 0.2 / 0.3);
 * layout = a LAYOUTS key or 'random'. The same cfg always gives the same map.
 */
export function generateMap(cfg) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const m = tryGenerate(cfg, attempt, attempt === 39);
    if (m) return m;
  }
  throw new Error('Could not generate a map; try another seed or size.');
}

function tryGenerate(cfg, attempt, lastResort) {
  const { w, h } = cfg;
  const rng = makeRng(hashSeed(cfg.seed, attempt));
  const layoutKey = cfg.layout === 'random' || !LAYOUTS[cfg.layout] ? rng.pick(Object.keys(LAYOUTS)) : cfg.layout;
  const L = LAYOUTS[layoutKey];
  const cx = (w - 1) / 2, cy = (h - 1) / 2, maxR = Math.min(w, h) / 2;
  const edge = 1.15 - 1.1 * cfg.water;           // how far the land reaches (less sea = bigger)
  const coast = noiseField(w, h, rng, [[3, 0.6], [1.6, 0.4]]);
  const heightN = noiseField(w, h, rng, [[3.5, 0.7], [1.7, 0.3]]);
  const temp = noiseField(w, h, rng, [[4, 1]]);
  const moist = noiseField(w, h, rng, [[3, 1]]);

  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy) / maxR;
    const s = L.shape({ d, edge, n: coast(x + 0.5, y + 0.5), hn: heightN(x + 0.5, y + 0.5) });
    cells.push({ x, y, idx: y * w + x, d, type: s.land ? 'land' : 'water', lift: s.lift || 0, hn: heightN(x + 0.5, y + 0.5),
                 t: temp(x + 0.5, y + 0.5), m: moist(x + 0.5, y + 0.5),
                 biome: 'meadow', height: 0, building: null, owner: -1, tanks: 0, unit: 'tank', ready: 0 });
  }
  const map = { w, h, seed: cfg.seed, layout: layoutKey, cells, players: [], round: 1 };

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
  if (best.length < cfg.players * 12) return null;

  for (const c of best) {
    c.height = Math.max(0, Math.min(3, Math.floor(c.hn * 3.4) + c.lift));
    c.biome = c.height >= 3 ? 'alps' : c.t < 0.25 ? 'arctic' : c.m < 0.28 ? 'desert' : 'meadow';
  }

  // capitals: even angles around the centre, so everyone is the same distance from the middle and from each other
  const N = cfg.players, base = rng.rnd(0, Math.PI * 2), taken = new Set();
  const angles = [...Array(N)].map((_, i) => base + i * 2 * Math.PI / N);
  const pointAt = (a, r) => ({ x: cx + Math.cos(a) * r * maxR, y: cy + Math.sin(a) * r * maxR });
  const nearest = (pt, pool) => pool.reduce((b, c) => (!b || Math.hypot(c.x - pt.x, c.y - pt.y) < Math.hypot(b.x - pt.x, b.y - pt.y) ? c : b), null);
  const free = () => best.filter(c => c.type === 'land' && !taken.has(c));
  angles.forEach((a, i) => {
    const c = nearest(pointAt(a, L.capitalR), free());
    taken.add(c);
    const [name, col] = PLAYER_DEFS[i];
    map.players.push({ id: i, name, col, human: i < cfg.humans, alive: true, capital: c, ammo: startingAmmo() });
    c.owner = i; c.building = 'capital'; c.tanks = 4; c.height = Math.min(c.height, 1);
  });

  // fairness: the capitals should be about the same walking distance apart
  const walk = from => {
    const d = new Map([[from, 0]]), q = [from];
    while (q.length) { const c = q.shift(); for (const n of neighbors(map, c)) if (!d.has(n)) { d.set(n, d.get(c) + 1); q.push(n); } }
    return d;
  };
  const gaps = [];
  for (let i = 0; i < N; i++) { const d = walk(map.players[i].capital); for (let j = i + 1; j < N; j++) gaps.push(d.get(map.players[j].capital) ?? 99); }
  if (!lastResort && Math.max(...gaps) > 1.7 * Math.min(...gaps)) return null;

  // 60% of the land goes to the players: grown outwards from the capitals in turns, so the regions are
  // compact and equally big
  const quota = Math.floor(best.length * TERRITORY / N), owned = map.players.map(p => [p.capital]);
  for (let moved = true; moved;) {
    moved = false;
    for (const p of map.players) {
      if (owned[p.id].length >= quota) continue;
      const cand = owned[p.id].flatMap(c => neighbors(map, c)).filter(n => n.owner < 0);
      if (!cand.length) continue;
      let pick = null, bd = Infinity;
      for (const n of cand) { const d = Math.hypot(n.x - p.capital.x, n.y - p.capital.y) + rng.next() * 0.6; if (d < bd) { bd = d; pick = n; } }
      pick.owner = p.id; pick.tanks = 2; owned[p.id].push(pick); moved = true;
    }
  }

  // starting buildings: near the capital, in random (but different) directions
  const ang = (c, o) => Math.atan2(c.y - o.y, c.x - o.x);
  const spread = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
  for (const p of map.players) {
    const own = cellsOwned(map, p.id).filter(c => c !== p.capital);
    const near = own.filter(c => manhattan(c, p.capital) <= 3);
    const pool = rng.shuffle((near.length >= START_BUILDINGS.length ? near : own).slice());
    const used = [];
    for (const b of START_BUILDINGS) {
      const c = pool.find(k => !k.building && used.every(u => spread(ang(k, p.capital), ang(u, p.capital)) > 1.0)) || pool.find(k => !k.building);
      if (c) { c.building = b; used.push(c); }
    }
  }

  // contested ground: prizes defined by the layout, guarded; everything else gets an ordinary garrison
  const neutral = () => best.filter(c => c.owner < 0 && !c.building);
  const place = (pt, building, guard) => {
    const c = nearest(pt, neutral());
    if (!c) return;
    c.building = building;
    if (guard === 'heavy') { c.unit = 'heavy'; c.tanks = 1; }
    else if (guard === 'strong') { c.unit = 'tank'; c.tanks = 3; }
    c.prize = true;
  };
  for (const pr of L.prizes) {
    if (pr.at === 'center') place({ x: cx, y: cy }, pr.building, pr.guard);
    else if (pr.at === 'between') angles.forEach(a => place(pointAt(a + Math.PI / N, pr.r), pr.building, pr.guard));
    else for (let i = 0; i < N * (pr.per || 1); i++) {
      const c = rng.pick(neutral()); if (c) place({ x: c.x, y: c.y }, pr.building, pr.guard);
    }
  }
  for (const c of best) {
    if (c.owner >= 0 || c.prize) continue;
    // stronger the closer to the middle
    c.tanks = rng.next() < 0.25 ? 0 : 1 + (c.height >= 2 ? 1 : 0) + (c.d < 0.4 ? 1 : 0) + (rng.next() < 0.3 ? 1 : 0);
    if (c.tanks && rng.next() < 0.5) c.unit = 'light';
  }
  for (const c of map.cells) { c.ready = c.tanks; for (const k of ['d', 'lift', 'hn', 't', 'm', 'prize']) delete c[k]; }
  return map;
}
