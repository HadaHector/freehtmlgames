// Computer players on the strategy map. Works through the `game` actions so every
// move goes through the same rules (and battles) as a human move.
import { neighbors, sendable, cellsOwned, moveKind, roomFor, artilleryTargets } from './map.js';
import { shuffle } from './util.js';

function distanceField(map, id) {
  // steps from every land cell to the nearest cell that isn't ours
  const d = new Map(), q = [];
  for (const c of map.cells) if (c.type === 'land' && c.owner !== id) { d.set(c, 0); q.push(c); }
  while (q.length) {
    const c = q.shift();
    for (const n of neighbors(map, c)) if (!d.has(n)) { d.set(n, d.get(c) + 1); q.push(n); }
  }
  return d;
}

const artyScore = t => (t.building === 'capital' ? 40 : 0) + (t.tanks === 1 ? 10 : 0) + (t.owner >= 0 ? 5 : 0);
const prize = t => (t.building ? 6 : 0) + (t.building === 'capital' ? 100 : 0) + (t.owner >= 0 ? 5 : 0);

export async function aiTurn(game, id) {
  const { map } = game;
  for (const c of cellsOwned(map, id)) {
    if (!game.active()) return;
    const targets = artilleryTargets(map, id, c).sort((a, b) => artyScore(b) - artyScore(a));
    if (targets.length) await game.fire(id, c, targets[0]);
  }
  const field = distanceField(map, id);
  for (const c of shuffle(cellsOwned(map, id).filter(k => sendable(k) > 0))) {
    if (!game.active()) return;
    const n = sendable(c);
    if (c.owner !== id || n <= 0) continue;

    let best = null;
    for (const t of neighbors(map, c)) {
      const kind = moveKind(id, t);
      if (kind === 'move') continue;
      let s;
      if (kind === 'capture') s = 10 + prize(t);
      else {
        if (n < t.tanks + (t.building === 'capital' ? 0 : 1)) continue;
        s = 5 + n - t.tanks + prize(t);
      }
      if (!best || s > best.s) best = { t, s, kind };
    }
    if (best) { await game.move(id, c, best.t, best.kind === 'capture' ? 1 : n); continue; }

    // nothing worth hitting here: if this is a back-line cell, walk towards the front
    if (neighbors(map, c).some(t => t.owner !== id)) continue;
    const step = neighbors(map, c).filter(t => t.owner === id && roomFor(id, t) > 0 && field.get(t) < field.get(c))
      .sort((a, b) => field.get(a) - field.get(b))[0];
    if (step) await game.move(id, c, step, Math.min(n, roomFor(id, step)));
  }
}
