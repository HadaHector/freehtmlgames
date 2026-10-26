// Screen flow: menu -> strategy map <-> battles.
import { $, sleep, hashSeed } from './util.js';
import { sfx, unlockAudio, wireCommonButtons } from './audio.js';
import { RULES } from './weapons.js';
import { BIOMES } from './biomes.js';
import * as M from './map.js';
import { aiTurn } from './mapai.js';
import { createMapView } from './mapview.js';
import { startBattle, stopBattle } from './battle.js';

const VERSION = '0.2.0';
const WATER = { low: 0.1, normal: 0.2, high: 0.3 };

// ---------- menu ----------
const OPTIONS = [
  { key: 'size',    label: 'Map size',       choices: [['6x6', '6 × 6'], ['8x8', '8 × 8'], ['10x10', '10 × 10'], ['12x12', '12 × 12']] },
  { key: 'water',   label: 'Sea',            choices: [['low', 'Little'], ['normal', 'Some'], ['high', 'Lots']] },
  { key: 'players', label: 'Players',        choices: [[2, '2'], [3, '3'], [4, '4']] },
  { key: 'humans',  label: 'Humans',         choices: [[1, '1 vs CPU'], [2, '2 (pass & play)'], [0, 'Watch CPU']] },
  { key: 'rules',   label: 'Battle weapons', choices: [['classic', 'Classic'], ['arsenal', 'Arsenal'], ['crazy', 'Crazy']], hint: k => RULES[k].desc },
  { key: 'diff',    label: 'CPU difficulty', choices: [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['insane', 'Insane']] },
];
const cfg = { size: '8x8', water: 'normal', players: 2, humans: 1, rules: 'arsenal', diff: 'normal', seed: '' };
try { Object.assign(cfg, JSON.parse(localStorage.getItem('tank-battlegrounds.cfg') || '{}')); } catch (e) {}

function buildOptions() {
 $('opts').innerHTML = '';
 for (const o of OPTIONS) {
  const box = document.createElement('div'); box.className = 'opt';
  box.innerHTML = `<div>${o.label}</div><div class="seg"></div>` + (o.hint ? '<div class="hint"></div>' : '');
  const seg = box.querySelector('.seg'), hint = box.querySelector('.hint'), btns = [];
  const refresh = () => { btns.forEach(([b, v]) => b.classList.toggle('on', cfg[o.key] === v)); if (hint) hint.textContent = o.hint(cfg[o.key]); };
  for (const [v, label] of o.choices) {
    const b = document.createElement('button'); b.textContent = label;
    b.onclick = () => { cfg[o.key] = v; refresh(); };
    seg.appendChild(b); btns.push([b, v]);
  }
  refresh(); $('opts').appendChild(box);
 }
}
buildOptions();
const randomSeed = () => Math.random().toString(36).slice(2, 8);
$('seed').value = cfg.seed;
$('seed').oninput = e => { cfg.seed = e.target.value.trim(); };
$('dice').onclick = () => { cfg.seed = randomSeed(); $('seed').value = cfg.seed; };
$('ver').textContent = 'v' + VERSION;

// ---------- screens ----------
function show(name) {
  $('menu').hidden = name !== 'menu';
  $('mapScreen').hidden = name !== 'map';
  $('battle').hidden = name !== 'battle';
  if (name === 'map') requestAnimationFrame(() => view.fit());
}

// ---------- save / continue ----------
// The strategy state is saved after every action. A battle in progress is not saved (its
// terrain damage isn't either): leaving mid-battle returns to the state before the attack.
const SAVE_KEY = 'tank-battlegrounds.save';
function saveGame() {
  if (!map || map.over) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, cfg, current,
      map: { w: map.w, h: map.h, seed: map.seed, round: map.round, cells: map.cells,
             players: map.players.map(p => ({ ...p, capital: p.capital.idx })) },
    }));
  } catch (e) {}
  refreshContinue();
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} refreshContinue(); }
function readSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || s.v !== 1 || s.map.cells.length !== s.map.w * s.map.h) return null;
    s.map.players.forEach(p => { p.capital = s.map.cells[p.capital]; });
    s.map.over = false;
    return s;
  } catch (e) { return null; }
}
function refreshContinue() {
  const s = readSave();
  $('continueGame').hidden = !s;
  if (s) $('continueGame').textContent = `▶ Continue: round ${s.map.round} · ${s.cfg.size.replace('x', '×')} · ${s.map.players[s.current].name}'s turn`;
}
function continueGame() {
  const s = readSave();
  if (!s) return;
  unlockAudio();
  Object.assign(cfg, s.cfg); buildOptions(); $('seed').value = cfg.seed;
  beginGame(s.map, s.current);
}

// ---------- session ----------
const view = createMapView($('grid'), $('gridWrap'));
let map = null, runId = 0, current = 0, humanDone = null, busy = false, sendN = 1, dialogResolve = null;
const ui = { selected: null, mode: 'move', targets: new Map(), flash: [], actors: new Set() };
const fast = () => !map.players.some(p => p.human);

function startCampaign() {
  unlockAudio();
  if (!cfg.seed) { cfg.seed = randomSeed(); }
  $('seed').value = cfg.seed;
  try { localStorage.setItem('tank-battlegrounds.cfg', JSON.stringify(cfg)); } catch (e) {}
  const [w, h] = cfg.size.split('x').map(Number);
  if (readSave() && !confirm('Start a new game? Your saved game will be replaced.')) return;
  beginGame(M.generateMap({ w, h, players: cfg.players, humans: cfg.humans, seed: cfg.seed, water: WATER[cfg.water] }), -1);
}

/** resumeAt: index of the player whose turn it is, or -1 for a fresh game. */
function beginGame(newMap, resumeAt) {
  abort();
  map = newMap; map.over = false;
  const id = ++runId;
  $('over').hidden = true;
  show('map');
  view.build(map);
  loop(id, resumeAt);
}

function abort() {
  runId++;
  stopBattle();
  if (dialogResolve) { const r = dialogResolve; dialogResolve = null; $('dialog').hidden = true; r('cancel'); }
  if (humanDone) { const r = humanDone; humanDone = null; r(); }
  busy = false;
}
function backToMenu() { abort(); $('over').hidden = true; show('menu'); }

async function loop(id, resumeAt) {
  const game = {
    map,
    active: () => id === runId && !map.over,
    move: async (pid, src, dst, n) => { await doMove(pid, src, dst, n); await sleep(fast() ? 40 : 350); },
    fire: async (pid, src, t) => { await doFire(pid, src, t); await sleep(fast() ? 40 : 350); },
  };
  let from = Math.max(0, resumeAt), resumed = resumeAt >= 0;
  while (id === runId && !map.over) {
    for (const p of map.players.slice(from)) {
      if (id !== runId || map.over) return;
      if (!p.alive) continue;
      const made = resumed ? 0 : M.startTurn(map, p.id);
      current = p.id; clearSel();
      toast(`Round ${map.round} · ${p.name}${p.human ? '' : ' (CPU)'}'s turn${resumed ? ' · resumed' : made ? ` · +${made} tank${made > 1 ? 's' : ''}` : ''}`);
      resumed = false;
      saveGame(); refresh();
      if (p.human) await new Promise(res => { humanDone = res; refresh(); });
      else { await sleep(fast() ? 40 : 400); await aiTurn(game, p.id); }
    }
    from = 0; map.round++;
  }
}

// ---------- actions (shared by humans and the CPU) ----------
const plural = n => `${n} tank${n === 1 ? '' : 's'}`;
const at = c => `(${c.x + 1},${c.y + 1})`;
function toast(t) { $('toast').textContent = t; }
function flash(cells) { ui.flash = cells; refresh(); setTimeout(() => { ui.flash = []; if (map) refresh(); }, 600); }

async function doMove(pid, src, dst, n) {
  n = Math.min(n, M.sendable(src));
  const kind = M.moveKind(pid, dst);
  if (kind !== 'battle') n = Math.min(n, M.roomFor(pid, dst));
  if (n <= 0) return false;
  const p = map.players[pid];
  flash([src, dst]);
  if (kind === 'battle') return fight(pid, src, dst, n);
  M.detach(src, n); M.arrive(map, pid, dst, n); sfx.blip();
  toast(kind === 'capture' ? `${p.name} takes ${at(dst)}` : `${p.name} moves ${plural(n)} to ${at(dst)}`);
  afterAction();
  return true;
}

async function doFire(pid, src, target) {
  flash([src, target]); sfx.boom(40);
  M.fireArtillery(src, target);
  toast(`${map.players[pid].name}'s artillery hits ${at(target)}`);
  afterAction();
  return true;
}

function afterAction() {
  const r = M.gameResult(map);
  refresh();
  if (r) endGame(r); else saveGame();
}

const roleOf = p => (!p || !p.human ? 'CPU' : cfg.humans === 1 ? 'you' : `player ${p.id + 1}`);

async function fight(pid, src, dst, n) {
  const id = runId, att = map.players[pid], defP = dst.owner >= 0 ? map.players[dst.owner] : null;
  const defHuman = !!defP && defP.human;
  let play = false;
  if (att.human || defHuman) {
    const buttons = [{ id: 'fight', label: '⚔ Fight it out', cls: 'go' }, { id: 'auto', label: '🎲 Auto-resolve' }];
    if (att.human) buttons.push({ id: 'cancel', label: 'Cancel' });
    const choice = await ask(`${att.name} attacks ${defP ? defP.name : 'the neutral garrison'}`,
      `${plural(n)} against ${plural(dst.tanks)} at ${at(dst)}.`, buttons);
    if (id !== runId || choice === 'cancel') return false;
    play = choice === 'fight';
  }
  M.detach(src, n);
  let res;
  if (play) {
    const setup = {
      seed: hashSeed(map.seed, src.idx, dst.idx),
      left: { biome: src.biome, height: src.height }, right: { biome: dst.biome, height: dst.height },
      rules: cfg.rules, diff: cfg.diff, onMenu: () => { if (confirm('Leave this game and go back to the menu?')) backToMenu(); },
      teams: [
        { name: att.name, col: att.col, label: roleOf(att), human: att.human, count: n, ammoMult: src.building === 'ammo' ? 2 : 1 },
        { name: defP ? defP.name : 'Neutral', col: defP ? defP.col : '#9a9a9a', label: roleOf(defP), human: defHuman,
          count: dst.tanks, ammoMult: dst.building === 'ammo' ? 2 : 1 },
      ],
    };
    show('battle');
    res = await startBattle(setup);
    if (id !== runId || !res) return false;
    show('map');
  } else res = M.autoResolve(n, dst.tanks);
  const won = res.survivors[0] > 0 && res.survivors[1] === 0;
  M.applyBattle(map, pid, src, dst, n, res);
  toast(won ? `${att.name} captures ${at(dst)} (${plural(res.survivors[0])} left)` : `${att.name}'s attack on ${at(dst)} fails`);
  afterAction();
  return true;
}

function ask(title, text, buttons) {
  return new Promise(res => {
    dialogResolve = res;
    $('dlgTitle').textContent = title; $('dlgText').textContent = text;
    const box = $('dlgBtns'); box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button'); el.className = 'big ' + (b.cls || ''); el.textContent = b.label;
      el.onclick = () => { $('dialog').hidden = true; dialogResolve = null; res(b.id); };
      box.appendChild(el);
    }
    $('dialog').hidden = false;
  });
}

function endGame(r) {
  map.over = true; clearSave();
  let m, good;
  if (r.humansOut) { m = '💀 Defeat'; good = false; }
  else {
    const p = map.players[r.winner];
    good = p.human; m = good ? '🏆 Victory!' : `🏆 ${p.name} wins`;
  }
  (good || fast() ? sfx.win : sfx.lose)();
  clearSel(); refresh();
  setTimeout(() => { if (map && map.over) { $('overMsg').textContent = m; $('over').className = 'screen ' + (good ? 'win' : 'lose'); $('over').hidden = false; } }, 700);
}

// ---------- human input ----------
function clearSel() { ui.selected = null; ui.targets = new Map(); ui.mode = 'move'; }
function computeTargets() {
  ui.targets = new Map();
  const c = ui.selected;
  if (!c || c.owner !== current || !humanDone || busy) return;
  if (ui.mode === 'move' && M.sendable(c) > 0) {
    for (const n of M.neighbors(map, c)) {
      const kind = M.moveKind(current, n);
      if (kind === 'move' && M.roomFor(current, n) <= 0) continue;
      ui.targets.set(n, kind === 'battle' ? 'attack' : 'move');
    }
  } else if (ui.mode === 'arty') for (const t of M.artilleryTargets(map, current, c)) ui.targets.set(t, 'arty');
}
function select(c) {
  ui.selected = c;
  const arty = M.artilleryTargets(map, current, c).length > 0;
  ui.mode = M.sendable(c) > 0 || !arty ? 'move' : 'arty';
  sendN = M.sendable(c);
  computeTargets();
}
view.onCell = async c => {
  sfx.blip();
  if (!humanDone || busy) { ui.selected = c; ui.targets = new Map(); refresh(); return; }
  if (ui.selected && ui.targets.has(c)) {
    const src = ui.selected, mode = ui.mode;
    busy = true; refresh();
    if (mode === 'arty') await doFire(current, src, c); else await doMove(current, src, c, sendN);
    busy = false;
    if (map && !map.over) { clearSel(); refresh(); }
    return;
  }
  if (ui.selected === c) clearSel(); else select(c);
  refresh();
};
$('sendm').onclick = () => { sendN = Math.max(1, sendN - 1); refresh(); };
$('sendp').onclick = () => { if (ui.selected) sendN = Math.min(M.sendable(ui.selected), sendN + 1); refresh(); };
$('modeMove').onclick = () => { ui.mode = 'move'; computeTargets(); refresh(); };
$('modeArty').onclick = () => { ui.mode = 'arty'; computeTargets(); refresh(); };
$('endTurn').onclick = () => {
  if (!humanDone || busy) return;
  const r = humanDone; humanDone = null; clearSel(); refresh(); r();
};
$('mapMenu').onclick = () => { if (confirm('Leave this game and go back to the menu?')) backToMenu(); };

// ---------- rendering ----------
function refresh() {
  if (!map) return;
  const myTurn = !!humanDone && !busy;
  ui.actors = new Set();
  if (myTurn) for (const c of M.cellsOwned(map, current)) if (M.sendable(c) > 0 || M.artilleryTargets(map, current, c).length) ui.actors.add(c);
  if (ui.selected && myTurn) computeTargets();
  view.render(ui);

  $('players').innerHTML = map.players.map(p =>
    `<span class="chip${p.alive ? '' : ' dead'}${p.id === current && p.alive ? ' cur' : ''}"><i style="background:${p.col}"></i>${p.name} ${M.totalTanks(map, p.id)}</span>`).join('');

  const c = ui.selected;
  if (!c) $('cellInfo').textContent = myTurn ? 'Tap one of your stacks, then a highlighted neighbour to move or attack. Tap it again to deselect.' : 'Tap a cell for details.';
  else {
    const o = c.owner >= 0 ? map.players[c.owner] : null, b = c.building ? M.BUILDINGS[c.building] : null;
    $('cellInfo').innerHTML = `<b>${at(c)}</b> ${BIOMES[c.biome].name}${c.height ? ' · height ' + c.height : ''}<br>` +
      `<span class="dot" style="background:${o ? o.col : '#888'}"></span>${o ? o.name : 'Neutral'} · ${plural(c.tanks)}` +
      (c.owner === current && myTurn ? ` (${M.sendable(c)} can move)` : '') +
      (b ? `<br>${b.icon} <b>${b.name}</b> — ${b.desc}` : '');
  }
  const canSend = myTurn && c && c.owner === current && ui.mode === 'move' && M.sendable(c) > 0;
  $('sendRow').hidden = !canSend;
  if (canSend) { sendN = Math.max(1, Math.min(sendN, M.sendable(c))); $('sendv').textContent = sendN; }
  const hasArty = myTurn && c && c.owner === current && c.building === 'artillery' && !c.fired;
  $('modeRow').hidden = !hasArty;
  if (hasArty) {
    $('modeMove').classList.toggle('on', ui.mode === 'move'); $('modeArty').classList.toggle('on', ui.mode === 'arty');
    $('modeMove').disabled = M.sendable(c) <= 0;
  }
  $('endTurn').disabled = !myTurn;
}

// ---------- wiring ----------
$('start').onclick = startCampaign;
$('continueGame').onclick = continueGame;
$('overAgain').onclick = startCampaign;
$('overMenu').onclick = backToMenu;
wireCommonButtons();
refreshContinue();
show('menu');
