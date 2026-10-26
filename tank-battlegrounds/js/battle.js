// The side-view artillery battle. One battle at a time: startBattle(setup) resolves when the player
// presses Continue on the result card.
//
// setup = {
//   seed, left: {biome, height}, right: {biome, height}, diff,
//   teams: [{name, col, label, human, unit, diff, count, ammo: {weapon: n}, artillery: n}, ...],   // [attacker (left), defender (right)]
//   onTurn(snapshot) is called at the start of every turn so the caller can save the battle.
//   (ammo is a stockpile shared by the whole team; artillery = guns in range, 0 = no fire support)
//   onMenu: () => void,
// }
// result = { survivors: [n, n], winner: 0 | 1 | -1, ammoLeft: [{weapon: n}, {weapon: n}] }
import { $, clamp, rnd, pick, shuffle, makeRng } from './util.js';
import { sfx, unlockAudio } from './audio.js';
import { WEAPONS, UNITS, BATTLE_WEAPONS, STOCK_AMMO, AI_WEAPONS, SAFE, DIFF, ART_FIRST_ROUND, ART_COOLDOWN } from './weapons.js';
import { BIOMES } from './biomes.js';
import { generateHeights, paintTerrain } from './terrain.js';

const H = 450, FUEL = 90, BARREL = 18, PIV = 11, SUB = 6, G = 0.14;
let W = 800, K = 0.115;

const cv = $('c'), ctx = cv.getContext('2d');
const tc = document.createElement('canvas');
let tctx;
let mask = new Uint8Array(1), craters = [];

let B = null, running = false, resolveBattle = null, result = null;
let ST, tanks, teams, cur, teamI, decor, clouds, projectiles, particles;
let wind, state, fuel, settleT, ai, shake, flash, lastBoom, tick = 0, moveDir = 0, round = 1;
let endMode = null, endT = 0, rockets = [], sparks = [], ash = [], smoke = [], floaters = [];
let camX = 0, camFocus = 0, camManual = false;
let dpr = 1, cssW = 300, cssH = 200, S0 = 1, offY = 0, vw = 300, skyGrad;

// ---------- terrain ----------
const solid = (x, y) => x >= 0 && x < W && y >= 0 && y < H && mask[(y | 0) * W + (x | 0)] === 1;
function surfaceBelow(x, y0) {
  x = clamp(x | 0, 0, W - 1);
  for (let y = Math.max(0, y0 | 0); y < H; y++) if (mask[y * W + x]) return y;
  return Infinity;
}
function setMask(cx, cy, r, v) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * W + x] = v;
}
function carve(cx, cy, r, record = true) {
  if (record) craters.push(Math.round(cx), Math.round(cy), Math.round(r));   // flat list of circles, kept for saving
  tctx.save(); tctx.globalCompositeOperation = 'destination-out';
  tctx.beginPath(); tctx.arc(cx, cy, r, 0, 7); tctx.fill(); tctx.restore();
  setMask(cx, cy, r, 0);
}
function placeDecor(rng, L, R) {
  decor = [];
  for (let x = 12; x < W - 12; x += rng.rnd(18, 55)) {
    const y = surfaceBelow(x, 0);
    if (!(y < H - 6)) continue;
    const b = x < W / 2 ? L : R;
    decor.push({ x, y: y + 1, type: rng.pick(b.decor), s: rng.rnd(0.7, 1.3), v: rng.rnd(0, 1), col: b.rock });
  }
  clouds = [];
  if (R.clouds) for (let x = 0; x < W * 0.5 + 800; x += rng.rnd(120, 260)) clouds.push({ x, y: rng.rnd(15, 150), w: rng.rnd(40, 90) });
}

// ---------- setup ----------
export function startBattle(setup, snap = null) {
  return new Promise(resolve => {
    B = setup; resolveBattle = resolve; result = null;
    $('end').hidden = true; $('end').className = 'screen';
    running = true;
    init(snap);
    last = performance.now(); acc = 0;
    requestAnimationFrame(frame);
  });
}
export function stopBattle() {
  running = false;
  if (resolveBattle) { const r = resolveBattle; resolveBattle = null; r(null); }
}
export const battleActive = () => running;

function init(snap) {
  const [ta, td] = B.teams;
  W = clamp(Math.round(560 + 130 * (ta.count + td.count)), 800, 2400);
  K = 0.115 * Math.sqrt(W / 800);
  const L = BIOMES[B.left.biome], R = BIOMES[B.right.biome];
  ST = R;
  const rng = makeRng(B.seed);
  const hs = generateHeights(W, H, rng, B.left, B.right);
  paintTerrain(tc, hs, W, H, L, R);
  tctx = tc.getContext('2d');
  mask = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) for (let y = Math.ceil(hs[x]); y < H; y++) mask[y * W + x] = 1;
  placeDecor(rng, L, R);
  craters = [];

  teams = []; tanks = [];
  B.teams.forEach((t, i) => {
    // one stockpile per team, shared by its tanks; the tank's own weapon never runs out
    const u = UNITS[t.unit || 'tank'], pool = { [u.weapon]: Infinity, artillery: 0 };
    for (const k of STOCK_AMMO) pool[k] = t.ammo[k] || 0;
    const tm = { i, name: t.name, col: t.col, label: t.label, human: t.human, tanks: [], next: 0, diff: t.diff || B.diff, noise: DIFF[t.diff || B.diff].n0,
                 pool, guns: t.artillery || 0, artNext: ART_FIRST_ROUND };
    for (let j = 0; j < t.count; j++) {
      const tank = { team: i, x: 0, y: 0, vy: 0, hp: u.hp, maxHp: u.hp, s: u.scale, unit: t.unit || 'tank', dead: false, ang: i ? 130 : 50, pow: 60, weapon: u.weapon, ammo: pool, col: t.col };
      tm.tanks.push(tank); tanks.push(tank);
    }
    teams.push(tm);
  });
  placeTanks();
  projectiles = []; particles = []; floaters = []; shake = 0; flash = 0; moveDir = 0; lastBoom = 0;
  endMode = null; endT = 0; rockets = []; sparks = []; ash = []; smoke = [];
  wind = rnd(-0.012, 0.012); teamI = 0; round = 1; cur = teams[0].tanks[0]; teams[0].next = 1;
  resize();
  if (snap) restore(snap);
  makeSky(); camX = cur.x - vw / 2; startTurn(false);
}

/** What is needed to carry on a battle later: the terrain is rebuilt from the seed and the craters (a flat
 *  [x, y, radius, ...] list of circles) are cut out of it again. */
function snapshot() {
  return {
    round, teamI, wind, cur: tanks.indexOf(cur), craters: craters.slice(),
    teams: teams.map(t => ({ next: t.next, noise: t.noise, artNext: t.artNext,
                             pool: Object.fromEntries(Object.entries(t.pool).filter(([, v]) => Number.isFinite(v))) })),
    tanks: tanks.map(t => ({ x: t.x, y: t.y, hp: t.hp, dead: t.dead, ang: t.ang, pow: t.pow, weapon: t.weapon, last: t.last || null })),
  };
}
function restore(s) {
  for (let i = 0; i < s.craters.length; i += 3) carve(s.craters[i], s.craters[i + 1], s.craters[i + 2], false);
  craters = s.craters.slice();
  decor = decor.filter(d => solid(d.x, d.y + 1) && !solid(d.x, d.y - 3));   // trees on blown-away ground are gone
  s.tanks.forEach((o, i) => Object.assign(tanks[i], o, { vy: 0 }));
  s.teams.forEach((o, i) => { const t = teams[i]; t.next = o.next; t.noise = o.noise; t.artNext = o.artNext; Object.assign(t.pool, o.pool); });
  teamI = s.teamI; round = s.round; wind = s.wind; cur = tanks[s.cur];
}
function surfaceAt(x, s = 1) { return Math.min(...[-12, 0, 12].map(o => surfaceBelow(x + o * s, 0))); }
function placeTanks() {
  // attackers hold the left end of the field, defenders the right end
  teams.forEach((tm, i) => {
    const n = tm.tanks.length, z0 = i ? W * 0.62 : 40, zw = (i ? W - 40 : W * 0.38) - z0, seg = zw / n;
    tm.tanks.forEach((t, j) => {
      t.x = clamp(z0 + seg * (j + 0.5) + rnd(-0.2, 0.2) * seg, 20 * t.s, W - 20 * t.s);
      const y = surfaceAt(t.x, t.s);
      t.y = isFinite(y) ? y : 0;
    });
  });
}
const aliveTeam = tm => tm.tanks.some(t => !t.dead);
function startTurn(drift = true) {
  if (drift) wind = clamp(wind + rnd(-0.006, 0.006), -0.015, 0.015);
  fuel = FUEL; state = 'aim'; camFocus = cur.x; camManual = false; moveDir = 0;
  const tm = teams[cur.team];
  if (tm.guns) tm.pool.artillery = round >= tm.artNext ? 1 : 0;
  if (!selectable(cur, cur.weapon)) cur.weapon = home(cur);
  if (!tm.human) aiPlan();
  updateUI();
  if (B.onTurn) B.onTurn(snapshot());
}
function endTurn() {
  const alive = teams.filter(aliveTeam);
  const anyHuman = teams.some(t => t.human), humansAlive = teams.some(t => t.human && aliveTeam(t));
  if (alive.length <= 1 || (anyHuman && !humansAlive)) {
    state = 'over'; updateUI();
    const counts = teams.map(t => t.tanks.filter(k => !k.dead).length);
    const winner = counts[0] && !counts[1] ? 0 : counts[1] && !counts[0] ? 1 : -1;
    const ammoLeft = teams.map(t => { const o = {}; for (const k of STOCK_AMMO) o[k] = t.pool[k]; return o; });
    result = { survivors: counts, winner, ammoLeft };
    let m;
    if (winner < 0) { m = '🤝 Mutual destruction!'; endMode = 'draw'; }
    else {
      endMode = !anyHuman || teams[winner].human ? 'win' : 'lose';
      m = (endMode === 'win' ? '🏆 ' : '💀 ') + `${teams[winner].name} wins the battle`;
    }
    endT = 0; camFocus = winner >= 0 ? teams[winner].tanks.find(t => !t.dead).x : camFocus; camManual = false;
    (endMode === 'win' ? sfx.win : sfx.lose)();
    setTimeout(() => { if (!running) return; $('msg').textContent = m; $('end').className = 'screen ' + endMode; $('end').hidden = false; }, 900);
    return;
  }
  const prevTeam = teamI;
  do { teamI = (teamI + 1) % teams.length; } while (!aliveTeam(teams[teamI]));
  if (teamI <= prevTeam) round++;
  const tm = teams[teamI];
  while (tm.tanks[tm.next % tm.tanks.length].dead) tm.next++;
  cur = tm.tanks[tm.next++ % tm.tanks.length];
  startTurn();
}

// ---------- tanks ----------
function hurt(t, amt) {
  if (t.dead) return;
  t.hp -= amt;
  if (t.hp <= 0) { t.hp = 0; t.dead = true; burst(t.x, t.y - 8 * t.s, 50 * t.s, ['#ff9a3d', '#ffd54a', t.col, '#333']); shake = 10; sfx.die(); }
}
function settle(t) {
  let s = Infinity;
  for (const o of [-12, 0, 12]) s = Math.min(s, surfaceBelow(t.x + o * t.s, t.y - 6 * t.s));
  let moved = false;
  if (s > t.y + 0.5) {
    t.vy = Math.min(t.vy + 0.2, 5); t.y = Math.min(s, t.y + t.vy); moved = true;
  } else { t.vy = 0; if (s < t.y - 0.5) { t.y = s; moved = true; } }
  if (t.y > H + 20) {
    t.dead = true; t.hp = 0;
    burst(t.x, H - 10, 30, ['#fff', '#8cf']); sfx.splash();
  }
  return moved;
}
function moveTank(t, dx) {
  const nx = t.x + dx;
  if (nx < 15 * t.s || nx > W - 15 * t.s) return false;
  let s = Infinity;
  for (const o of [-12, 0, 12]) s = Math.min(s, surfaceBelow(nx + o * t.s, t.y - 8 * t.s));
  if (s < t.y - 5) return false;
  t.x = nx; if (s < t.y) t.y = s;
  return true;
}
const pivot = t => ({ x: t.x, y: t.y - PIV * t.s });
const home = t => UNITS[t.unit].weapon;

// ---------- projectiles ----------
function stepProj(p, targets) {
  for (let s = 0; s < SUB; s++) {
    p.vx += wind / SUB; p.vy += G / SUB; p.x += p.vx / SUB; p.y += p.vy / SUB;
    if (p.x < 0 || p.x >= W || p.y >= H) return 'out';
    for (const t of targets)
      if (!t.dead && Math.abs(p.x - t.x) < 15 * t.s && p.y > t.y - 17 * t.s && p.y < t.y) return 'tank';
    if (solid(p.x, p.y)) return 'hit';
  }
  return null;
}
function launch(t, ang, pow) {
  const a = ang * Math.PI / 180, pv = pivot(t);
  const len = BARREL * t.s;
  return { x: pv.x + Math.cos(a) * len, y: pv.y - Math.sin(a) * len,
           vx: Math.cos(a) * pow * K, vy: -Math.sin(a) * pow * K };
}
function fire() {
  const t = cur, w = WEAPONS[t.weapon];
  if (t.ammo[t.weapon] !== Infinity) t.ammo[t.weapon]--;
  if (t.weapon === 'artillery') teams[t.team].artNext = round + ART_COOLDOWN;
  if (w.kind === 'tool') {   // repair pack: patch up this tank instead of shooting; the turn is used up
    const gain = Math.min(w.heal, t.maxHp - t.hp);
    t.hp += gain;
    floaters.push({ x: t.x, y: t.y - 36 * t.s, text: '+' + gain, life: 70 });
    burst(t.x, t.y - 10, 16, ['#5f5', '#bfb', '#fff']); sfx.heal();
    if (t.ammo[t.weapon] <= 0) t.weapon = home(t);
    lastBoom = camFocus = t.x; state = 'fly'; moveDir = 0; camManual = false; updateUI();
    return;
  }
  const p = launch(t, t.ang, t.pow);
  Object.assign(p, { type: t.weapon, trail: [], owner: t, life: 0, main: true });
  projectiles.push(p);
  burst(p.x, p.y, 6, ['#fff', w.col]); sfx.shoot();
  if (t.ammo[t.weapon] <= 0) t.weapon = home(t);
  state = 'fly'; moveDir = 0; camManual = false; updateUI();
}
function updateProjectiles() {
  for (const p of projectiles.slice()) {
    const prevVy = p.vy, w = WEAPONS[p.type];
    const r = stepProj(p, tanks);
    p.life++;
    p.trail.push({ x: p.x, y: p.y }); if (p.trail.length > 12) p.trail.shift();
    const drop = () => projectiles.splice(projectiles.indexOf(p), 1);
    if (r === 'out') { drop(); if (p.main) p.owner.last = { x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) }; continue; }
    if (r) { drop(); explode(p); continue; }
    if (p.life > 1500) { drop(); explode(p); continue; }
    if (w.kind === 'cluster' && prevVy < 0 && p.vy >= 0) {   // scatter: split into bomblets at the top of the arc
      drop();
      for (let i = -2; i <= 2; i++)
        projectiles.push({ x: p.x, y: p.y, vx: p.vx + i * 0.9 * Math.sqrt(K / 0.115), vy: p.vy, type: 'bomblet', trail: [], owner: p.owner, life: 0, main: i === 0 && p.main });
    }
  }
  if (projectiles.length) camFocus = projectiles[0].x;
}
function blast(x, y, r, dmg) {
  carve(x, y, r); sfx.boom(r);
  burst(x, y, r, ['#ff9a3d', '#ffd54a', '#7a5a35', '#fff']);
  shake = Math.max(shake, r / 6);
  for (const t of tanks) {
    if (t.dead) continue;
    const R = r + 14 * t.s;
    const d = Math.hypot(x - t.x, y - (t.y - 8 * t.s));
    if (d < R) hurt(t, Math.max(1, Math.round(dmg * (1 - d / R))));
  }
}
function explode(p) {
  const w = WEAPONS[p.type];
  if (p.main) p.owner.last = { x: p.x, y: p.y };   // remembered per tank, shown as a marker
  lastBoom = camFocus = p.x;
  switch (w.kind) {
    case 'barrage': {   // artillery: the more guns in range, the bigger the barrage
      const n = 6 + 4 * teams[p.owner.team].guns, order = shuffle([...Array(n).keys()]);
      order.forEach((o, i) => projectiles.push({ x: p.x + (i - (n - 1) / 2) * 20 + rnd(-5, 5), y: -20 - o * 22, vx: 0, vy: 2, type: 'shellfall', trail: [], owner: p.owner, life: 0 }));
      burst(p.x, p.y, 10, ['#f90', '#fff']); sfx.blip(); break;
    }
    default:
      blast(p.x, p.y, w.r, w.dmg);
      if (p.type === 'nuke') { flash = 1; shake = 16; }
  }
}
function burst(x, y, n, cols) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, 6.3), s = rnd(0.5, 4);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: rnd(20, 45), col: cols[i % cols.length], size: rnd(1.5, 3.5) });
  }
}

// ---------- AI ----------
function simulate(t, ang, pow, foe) {
  const p = launch(t, ang, pow);
  for (let i = 0; i < 1500; i++) {
    const r = stepProj(p, [foe]);
    if (r === 'out') return null;
    if (r) return p;
  }
  return null;
}
function aiPlan() {
  const me = cur, tm = teams[me.team], D = DIFF[tm.diff];
  if (me.hp <= 50 && selectable(me, 'repair') && Math.random() < 0.5 + D.special / 2) {   // patch itself up instead of shooting
    me.weapon = 'repair'; ai = { ta: me.ang, tp: me.pow, wait: 0 }; return;
  }
  const foes = tanks.filter(t => !t.dead && t.team !== me.team);
  const dist = t => Math.abs(t.x - me.x);
  let foe;
  if (D.target === 'random') foe = pick(foes);
  else if (D.target === 'near') foe = foes.reduce((a, b) => dist(b) < dist(a) ? b : a);
  else foe = foes.reduce((a, b) => b.hp < a.hp || (b.hp === a.hp && dist(b) < dist(a)) ? b : a);
  const avail = AI_WEAPONS.filter(k => selectable(me, k));
  me.weapon = avail.length && Math.random() < D.special ? pick(avail) : home(me);
  const safe = SAFE[me.weapon] || WEAPONS[me.weapon].r + 25;
  const mates = tm.tanks.filter(t => t !== me && !t.dead);
  let best = { a: me.x < foe.x ? 45 : 135, pw: 70, d: Infinity };
  const tryShot = (a, pw) => {
    const hit = simulate(me, a, pw, foe);
    if (!hit || Math.hypot(hit.x - me.x, hit.y - me.y) < safe) return;
    for (const m of mates) if (Math.hypot(hit.x - m.x, hit.y - (m.y - 8 * m.s)) < safe) return;
    const d = Math.hypot(hit.x - foe.x, hit.y - (foe.y - 8 * foe.s));
    if (d < best.d) best = { a, pw, d };
  };
  for (let a = 5; a <= 175; a += 2) for (let pw = 15; pw <= 100; pw += 3) tryShot(a, pw);
  for (const [da, dp, ra, rp] of [[0.5, 0.5, 2, 3], [0.1, 0.1, 0.5, 0.5]]) {
    const c = best;
    for (let a = c.a - ra; a <= c.a + ra + 1e-9; a += da) for (let pw = c.pw - rp; pw <= c.pw + rp + 1e-9; pw += dp)
      if (a >= 0 && a <= 180 && pw >= 10 && pw <= 100) tryShot(a, pw);
  }
  ai = { ta: clamp(best.a + rnd(-4, 4) * tm.noise, 0, 180), tp: clamp(best.pw + rnd(-5, 5) * tm.noise, 10, 100), wait: 0 };
  tm.noise = Math.max(D.nmin, tm.noise * D.decay);
}
function aiUpdate() {
  const me = cur;
  me.ang += clamp(ai.ta - me.ang, -1.5, 1.5);
  me.pow += clamp(ai.tp - me.pow, -1, 1);
  if (Math.abs(ai.ta - me.ang) < 0.01 && Math.abs(ai.tp - me.pow) < 0.01 && ++ai.wait > 30) {
    me.ang = ai.ta; me.pow = ai.tp; fire();
  }
}

// ---------- loop ----------
function clampCam() { camX = W <= vw ? (W - vw) / 2 : clamp(camX, 0, W - vw); }
function update() {
  tick++;
  if (state === 'aim') {
    camFocus = cur.x;
    if (teams[cur.team].human) {
      if (moveDir && fuel > 0 && moveTank(cur, moveDir)) { fuel--; $('fuelbar').style.width = fuel / FUEL * 100 + '%'; }
    } else aiUpdate();
  }
  if (state === 'fly') updateProjectiles();
  for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--; }
  for (const f of floaters) { f.y -= 0.4; f.life--; }
  floaters = floaters.filter(f => f.life > 0);
  particles = particles.filter(p => p.life > 0);
  shake *= 0.9; flash *= 0.93;
  let moved = false;
  for (const t of tanks) if (!t.dead) moved = settle(t) || moved;
  if (tick % 8 === 0) decor = decor.filter(d => {
    const ok = solid(d.x, d.y + 1) && !solid(d.x, d.y - 3);
    if (!ok) burst(d.x, d.y - 6, 5, ['#4a8a3a', '#7a5a35']);
    return ok;
  });
  if (state === 'fly' && !projectiles.length) { state = 'settle'; settleT = 0; camFocus = lastBoom || camFocus; updateUI(); }
  else if (state === 'settle') {
    settleT = moved ? 0 : settleT + 1;
    if (settleT > 30) endTurn();
  }
  if (state === 'over') endFx();
  if (!camManual) camX += (camFocus - vw / 2 - camX) * (state === 'fly' ? 0.25 : 0.1);
  clampCam();
}

// ---------- end-of-battle effects ----------
function endFx() {
  if (!endMode) return;
  endT++;
  const sc = cssH / 400;
  if (endMode === 'win') {
    if (endT % 22 === 1 || Math.random() < 0.02) rockets.push({ x: rnd(0.1, 0.9) * cssW, y: cssH, vy: -rnd(6, 8.5) * sc, hue: rnd(0, 360) });
    for (const r of rockets) {
      r.y += r.vy; r.vy += 0.1 * sc;
      if (r.vy > -1.2 * sc) {
        r.dead = true; sfx.pop();
        const n = 46, big = rnd(2, 3.6) * sc, two = Math.random() < 0.4;
        for (let i = 0; i < n; i++) {
          const a = i / n * 6.283, v = big * (two && i % 2 ? 0.55 : 1);
          sparks.push({ x: r.x, y: r.y, px: r.x, py: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(55, 85), max: 85,
                        col: `hsl(${(r.hue + (two && i % 2 ? 60 : 0)) % 360},100%,${rnd(60, 80)}%)` });
        }
      }
    }
    rockets = rockets.filter(r => !r.dead);
    for (const s of sparks) { s.px = s.x; s.py = s.y; s.x += s.vx; s.y += s.vy; s.vy += 0.03 * sc; s.vx *= 0.985; s.vy *= 0.985; s.life--; }
    sparks = sparks.filter(s => s.life > 0);
  } else {
    if (endT % 2 === 0) ash.push({ x: rnd(0, cssW), y: -5, vx: rnd(-0.3, 0.3), vy: rnd(0.5, 1.3) * sc, r: rnd(1, 2.6), a: rnd(0.3, 0.7) });
    for (const a of ash) { a.x += a.vx + Math.sin((tick + a.x) / 30) * 0.2; a.y += a.vy; }
    ash = ash.filter(a => a.y < cssH + 5);
  }
  if (tick % 4 === 0) for (const t of tanks) if (t.dead && t.y < H) smoke.push({ x: t.x + rnd(-4, 4), y: t.y - 4, vy: -rnd(0.3, 0.8), r: rnd(3, 5), life: 70 });
  for (const s of smoke) { s.y += s.vy; s.r += 0.12; s.life--; }
  smoke = smoke.filter(s => s.life > 0);
}

// ---------- drawing ----------
function makeSky() {
  skyGrad = ctx.createLinearGradient(0, 0, 0, cssH);
  skyGrad.addColorStop(0, ST.sky[0]); skyGrad.addColorStop(1, ST.sky[1]);
}
function resize() {
  const r = cv.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  S0 = Math.min(cssH / H, cssW / Math.min(W, 620));
  offY = cssH - H * S0; vw = cssW / S0;
  if (running && ST) { makeSky(); clampCam(); }
}
function drawDecor(d) {
  const s = d.s, x = d.x, y = d.y;
  switch (d.type) {
    case 'tree':
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 1.5, y - 14 * s, 3, 14 * s);
      ctx.fillStyle = '#3f8f3f'; ctx.beginPath(); ctx.arc(x, y - 19 * s, 9 * s, 0, 7); ctx.fill();
      ctx.fillStyle = '#58ad52'; ctx.beginPath(); ctx.arc(x - 3 * s, y - 21 * s, 4 * s, 0, 7); ctx.fill(); break;
    case 'bush':
      ctx.fillStyle = '#3f8f3f'; ctx.beginPath(); ctx.arc(x, y - 3 * s, 5 * s, 0, 7); ctx.arc(x + 5 * s, y - 2 * s, 4 * s, 0, 7); ctx.fill();
      if (d.v > 0.5) { ctx.fillStyle = '#ff6'; ctx.fillRect(x - 1, y - 6 * s, 2, 2); } break;
    case 'pine':
      ctx.fillStyle = '#5a3d25'; ctx.fillRect(x - 1.5, y - 6 * s, 3, 6 * s);
      ctx.fillStyle = '#2f6b4a';
      for (let i = 0; i < 3; i++) { const by = y - (5 + i * 8) * s, w = (11 - i * 3) * s; ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x + w, by); ctx.lineTo(x, by - 12 * s); ctx.fill(); }
      break;
    case 'rock':
      ctx.fillStyle = d.col; ctx.beginPath(); ctx.ellipse(x, y - 2 * s, 6 * s, 4 * s, 0, Math.PI, 0); ctx.fill(); break;
    case 'cactus':
      ctx.fillStyle = '#3f8a4a'; ctx.fillRect(x - 2, y - 20 * s, 4, 20 * s);
      ctx.fillRect(x - 8 * s, y - 14 * s, 6 * s, 3); ctx.fillRect(x - 8 * s, y - 20 * s, 3, 8 * s);
      ctx.fillRect(x + 2, y - 10 * s, 6 * s, 3); ctx.fillRect(x + 5 * s + 2, y - 16 * s, 3, 8 * s); break;
  }
}
function drawTank(t) {
  const s = t.s;
  if (t.dead) {
    if (state === 'over' && t.y < H) {
      ctx.save(); ctx.translate(t.x, t.y); ctx.scale(s, s);
      ctx.fillStyle = '#222'; ctx.fillRect(-14, -6, 28, 6);
      ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-10, -10, 20, 5);
      ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(2, -10); ctx.lineTo(14, -6); ctx.stroke();
      ctx.restore();
    }
    return;
  }
  const hop = state === 'over' && endMode === 'win' ? -Math.abs(Math.sin(tick / 7 + t.x)) * 7 : 0;
  if (hop) { ctx.save(); ctx.translate(0, hop); }
  const a = t.ang * Math.PI / 180;
  ctx.save(); ctx.translate(t.x, t.y); ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#222'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -PIV); ctx.lineTo(Math.cos(a) * BARREL, -PIV - Math.sin(a) * BARREL); ctx.stroke();
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-15, -5, 30, 5);
  ctx.fillStyle = t.col; ctx.fillRect(-12, -10, 24, 6);
  ctx.beginPath(); ctx.arc(0, -PIV, 6, Math.PI, 0); ctx.fill();
  if (t.unit === 'heavy') { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-12, -10, 24, 2); ctx.fillRect(-6, -PIV - 5, 12, 2); }
  ctx.restore();
  const bw = 38 * Math.min(s, 1.6), hy = t.y - 31 * s;   // health bar
  ctx.fillStyle = '#000'; ctx.fillRect(t.x - bw / 2, hy, bw, 6);
  ctx.fillStyle = t.hp > t.maxHp / 2 ? '#5c5' : t.hp > t.maxHp / 4 ? '#ec4' : '#e44';
  ctx.fillRect(t.x - bw / 2 + 1, hy + 1, (bw - 2) * t.hp / t.maxHp, 4);
  if (t === cur && state !== 'over' && state !== 'fly') {
    const by = t.y - 42 * s + Math.sin(tick / 8) * 2;
    ctx.fillStyle = '#ffd54a'; ctx.beginPath(); ctx.moveTo(t.x - 5, by - 6); ctx.lineTo(t.x + 5, by - 6); ctx.lineTo(t.x, by); ctx.fill();
  }
  if (hop) ctx.restore();
}
/** Marker where the current tank's previous shot landed. */
function drawLast(t) {
  const { x, y } = t.last, r = 7 + Math.sin(tick / 8);
  ctx.save(); ctx.lineCap = 'round';
  for (const [col, w] of [['rgba(255,255,255,.85)', 4], [t.col, 2]]) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.moveTo(x - r - 4, y); ctx.lineTo(x + r + 4, y); ctx.moveTo(x, y - r - 4); ctx.lineTo(x, y + r + 4);
    ctx.stroke();
  }
  ctx.restore();
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, cssW, cssH);
  if (ST.sun) { ctx.fillStyle = 'rgba(255,240,170,.35)'; ctx.beginPath(); ctx.arc(cssW * 0.2, cssH * 0.2, 34, 0, 7); ctx.fill(); ctx.fillStyle = '#fff2a8'; ctx.beginPath(); ctx.arc(cssW * 0.2, cssH * 0.2, 22, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  for (const c of clouds) {
    const sx = (c.x - camX * 0.5) * S0, sy = offY + c.y * S0, w = c.w * S0;
    if (sx < -w * 2 || sx > cssW + w) continue;
    ctx.beginPath(); ctx.ellipse(sx, sy, w, w * 0.28, 0, 0, 7); ctx.ellipse(sx - w * 0.4, sy - w * 0.12, w * 0.5, w * 0.25, 0, 0, 7); ctx.ellipse(sx + w * 0.4, sy - w * 0.08, w * 0.5, w * 0.22, 0, 0, 7); ctx.fill();
  }
  // world
  const sh = shake > 0.3 ? shake : 0, k = S0 * dpr;
  ctx.setTransform(k, 0, 0, k, -camX * k + rnd(-sh, sh), offY * dpr + rnd(-sh, sh));
  ctx.drawImage(tc, 0, 0);
  for (const d of decor) if (d.x > camX - 20 && d.x < camX + vw + 20) drawDecor(d);
  if (state !== 'over' && cur.last) drawLast(cur);   // only the tank whose turn it is
  tanks.forEach(drawTank);
  if (state === 'aim' && teams[cur.team].human && cur.weapon !== 'repair') {
    const pv = pivot(cur), a = cur.ang * Math.PI / 180, L = BARREL * cur.s + cur.pow * 0.9;
    ctx.setLineDash([3, 6]); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pv.x, pv.y); ctx.lineTo(pv.x + Math.cos(a) * L, pv.y - Math.sin(a) * L); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const p of projectiles) {
    ctx.fillStyle = WEAPONS[p.type].col;
    p.trail.forEach((q, i) => { ctx.globalAlpha = i / p.trail.length * 0.5; ctx.fillRect(q.x - 1, q.y - 1, 2, 2); });
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.type === 'shellfall' ? 2.5 : 3.5, 0, 7); ctx.fill();
  }
  ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const f of floaters) { ctx.globalAlpha = Math.min(1, f.life / 25); ctx.fillStyle = '#6f6'; ctx.fillText(f.text, f.x, f.y); }
  ctx.globalAlpha = 1;
  for (const s of smoke) { ctx.globalAlpha = Math.min(0.5, s.life / 100); ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
  for (const p of particles) { ctx.globalAlpha = Math.min(1, p.life / 15); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.size, p.size); }
  ctx.globalAlpha = 1;
  // HUD (screen space)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const p of projectiles) {
    const sx = (p.x - camX) * S0, sy = offY + p.y * S0;
    if (sy < 12 && sx > 0 && sx < cssW) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(sx - 5, 14); ctx.lineTo(sx + 5, 14); ctx.lineTo(sx, 6); ctx.fill();
    }
  }
  if (state === 'over' && endMode) {
    if (endMode === 'lose' || endMode === 'draw') {
      ctx.fillStyle = `rgba(${endMode === 'lose' ? '120,0,0' : '20,20,30'},${Math.min(endT / 90, 1) * 0.35})`; ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#bbb';
      for (const a of ash) { ctx.globalAlpha = a.a; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#fff';
      for (const r of rockets) { ctx.globalAlpha = 1; ctx.fillRect(r.x - 1, r.y, 2, 6); }
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (const s of sparks) { ctx.globalAlpha = Math.min(1, s.life / 30); ctx.strokeStyle = s.col; ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(s.x, s.y); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }
  if (flash > 0.02) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.8})`; ctx.fillRect(0, 0, cssW, cssH); }
  ctx.font = 'bold 13px system-ui, sans-serif'; ctx.fillStyle = '#fff';
  const tm = teams[cur.team];
  if (state !== 'over') {
    ctx.fillStyle = tm.col; ctx.fillRect(8, 8, 10, 10);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(`${tm.name} · ${tm.label}`, 24, 18);
    if (!tm.human && state === 'aim') ctx.fillText(`${Math.round(cur.ang)}° / ${Math.round(cur.pow)}`, 24, 35);
  }
  ctx.textAlign = 'right';
  const n = Math.min(5, Math.ceil(Math.abs(wind) / 0.003));
  ctx.fillText('Wind ' + (n ? (wind < 0 ? '◀' : '▶').repeat(n) : '–'), cssW - 8, 18);
  if (W * S0 > cssW + 1) {   // minimap
    const mx = 8, mw = cssW - 16, my = 44;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(mx, my, mw, 6);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(mx + camX / W * mw, my, vw / W * mw, 6);
    for (const t of tanks) if (!t.dead) { ctx.fillStyle = t.col; ctx.fillRect(mx + t.x / W * mw - 1.5, my + 1, 3, 4); }
  }
}
let last = 0, acc = 0;
function frame(ts) {
  if (!running) return;
  acc += Math.min(100, ts - last); last = ts;
  while (acc >= 1000 / 60 && running) { update(); acc -= 1000 / 60; }
  draw(); requestAnimationFrame(frame);
}

// ---------- controls ----------
const can = () => running && state === 'aim' && teams[cur.team].human;
/** Weapons this team can ever use (artillery only with guns in range). */
/** Has ammo, and (for the repair pack) actually needs it. */
const selectable = (t, k) => t.ammo[k] > 0 && (k !== 'repair' || t.hp < t.maxHp);
const weaponList = () => BATTLE_WEAPONS.filter(k => k !== 'artillery' || teams[cur.team].guns > 0);
function cycleWeapon(d) {
  if (!can()) return;
  const list = weaponList();
  let i = list.indexOf(cur.weapon);
  for (let n = 0; n < list.length; n++) { i = (i + d + list.length) % list.length; if (selectable(cur, list[i])) break; }
  cur.weapon = list[i]; sfx.blip(); updateUI();
}
function updateUI() {
  if (!tanks) return;
  const on = can();
  $('ang').value = 180 - Math.round(cur.ang); $('angv').textContent = Math.round(cur.ang) + '°';
  $('pow').value = Math.round(cur.pow); $('powv').textContent = Math.round(cur.pow);
  const list = weaponList(), w = WEAPONS[cur.weapon], a = cur.ammo[cur.weapon], tm = teams[cur.team];
  $('wrow').hidden = !list.some(k => k !== home(cur) && (selectable(cur, k) || k === 'artillery'));
  $('fire').textContent = cur.weapon === 'repair' ? 'REPAIR' : 'FIRE';
  $('wname').textContent = `${w.name} ${a === Infinity ? '∞' : '×' + a}`;
  $('wnote').textContent = !tm.guns ? '' : tm.pool.artillery ? `🎯 Artillery ready (${tm.guns} gun${tm.guns > 1 ? 's' : ''})`
    : `🎯 Artillery ready in ${Math.max(1, tm.artNext - round)} round${tm.artNext - round > 1 ? 's' : ''}`;
  for (const id of ['ang', 'pow', 'angm', 'angp', 'powm', 'powp', 'left', 'right', 'fire', 'wprev', 'wnext']) $(id).disabled = !on;
  $('fuelbar').style.width = fuel / FUEL * 100 + '%';
}
const adj = (key, d) => { if (!can()) return; cur[key] = clamp(Math.round(cur[key]) + d, key === 'ang' ? 0 : 10, key === 'ang' ? 180 : 100); updateUI(); };
function hold(el, fn, stop) {
  let to, iv;
  const end = () => { clearTimeout(to); clearInterval(iv); stop && stop(); };
  el.addEventListener('pointerdown', e => { e.preventDefault(); fn(); to = setTimeout(() => { iv = setInterval(fn, 50); }, 350); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, end);
}
hold($('angm'), () => adj('ang', 1)); hold($('angp'), () => adj('ang', -1));
hold($('powm'), () => adj('pow', -1)); hold($('powp'), () => adj('pow', 1));
hold($('left'), () => { if (can()) moveDir = -1; }, () => { moveDir = 0; });
hold($('right'), () => { if (can()) moveDir = 1; }, () => { moveDir = 0; });
$('wprev').onclick = () => cycleWeapon(-1); $('wnext').onclick = () => cycleWeapon(1);
$('ang').oninput = e => { if (can()) { cur.ang = 180 - +e.target.value; updateUI(); } };
$('pow').oninput = e => { if (can()) { cur.pow = +e.target.value; updateUI(); } };
$('fire').onclick = () => { if (can()) fire(); };
$('battleMenu').onclick = () => { if (B && B.onMenu) B.onMenu(); };
$('continue').onclick = () => {
  unlockAudio();
  const r = resolveBattle; running = false; resolveBattle = null;
  $('end').hidden = true;
  if (r) r(result);
};
addEventListener('keydown', e => {
  if (!running) return;
  const s = e.shiftKey ? 5 : 1;
  if (e.key === 'ArrowLeft') adj('ang', s); else if (e.key === 'ArrowRight') adj('ang', -s);
  else if (e.key === 'ArrowUp') adj('pow', s); else if (e.key === 'ArrowDown') adj('pow', -s);
  else if (e.key === 'Tab') cycleWeapon(e.shiftKey ? -1 : 1);
  else if (e.key === ' ' || e.key === 'Enter') { if (can()) fire(); }
  else return;
  e.preventDefault();
});

// camera drag / double-tap to recentre
let drag = null, lastTap = 0;
cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, moved: 0 }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x; drag.x = e.clientX; drag.moved += Math.abs(dx);
  if (drag.moved > 6) { camManual = true; camX -= dx / S0; clampCam(); }
});
cv.addEventListener('pointerup', () => {
  if (drag && drag.moved <= 6) {
    const now = performance.now();
    if (now - lastTap < 350 && cur) { camManual = false; camFocus = cur.x; }
    lastTap = now;
  }
  drag = null;
});
cv.addEventListener('pointercancel', () => { drag = null; });

new ResizeObserver(resize).observe(cv);
addEventListener('resize', resize);
