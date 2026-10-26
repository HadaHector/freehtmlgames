// Side-view battlefield: left end is shaped by the attacking cell, right end by the target cell.
import { clamp } from './util.js';

function waveSum(rng, count, aMin, aMax, fMin, fMax) {
  const ws = [];
  for (let i = 0; i < count; i++) ws.push({ a: rng.rnd(aMin, aMax) / (1 + i * 0.6), f: rng.rnd(fMin, fMax) * (1 + i * 1.3), p: rng.rnd(0, 6.3) });
  return x => ws.reduce((s, w) => s + w.a * Math.sin(w.f * x + w.p), 0);
}
function blur(a, r, passes) {
  for (let p = 0; p < passes; p++) {
    const b = a.slice();
    for (let i = 0; i < a.length; i++) {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += b[j]; n++; }
      a[i] = s / n;
    }
  }
}

const GEN = {
  meadow(W, rng, base) {
    const hs = new Float32Array(W), f = waveSum(rng, 4, 20, 55, 0.004, 0.011);
    for (let x = 0; x < W; x++) hs[x] = base + f(x);
    return hs;
  },
  arctic(W, rng, base) {
    const hs = new Float32Array(W), f = waveSum(rng, 3, 15, 40, 0.003, 0.008);
    for (let x = 0; x < W; x++) hs[x] = base + f(x);
    return hs;
  },
  alps(W, rng, base) {
    const n = 4096, arr = new Float32Array(n + 1), hs = new Float32Array(W);
    arr[0] = rng.rnd(-80, 80); arr[n] = rng.rnd(-80, 80);
    let amp = 230;
    for (let step = n; step > 1; step /= 2, amp *= 0.55)
      for (let i = 0; i < n; i += step) arr[i + step / 2] = (arr[i] + arr[i + step]) / 2 + rng.rnd(-amp, amp);
    for (let x = 0; x < W; x++) hs[x] = base + arr[x];
    blur(hs, 2, 2);
    return hs;
  },
  desert(W, rng, base) {
    const hs = new Float32Array(W), f = waveSum(rng, 3, 25, 50, 0.002, 0.006), step = rng.rnd(32, 46);
    for (let x = 0; x < W; x++) {
      const v = (base + f(x)) / step, fl = Math.floor(v), fr = v - fl;
      const s = fr < 0.35 ? 0 : fr > 0.65 ? 1 : (fr - 0.35) / 0.3;
      hs[x] = (fl + s * s * (3 - 2 * s)) * step;
    }
    return hs;
  },
};

/** Ground level of a cell (height 0..3 -> higher ground sits higher on screen). */
const baseFor = (H, cell) => H * (0.68 - 0.06 * cell.height);

export function generateHeights(W, H, rng, left, right) {
  const a = GEN[left.biome](W, rng, baseFor(H, left) + rng.rnd(-0.02, 0.02) * H);
  const b = GEN[right.biome](W, rng, baseFor(H, right) + rng.rnd(-0.02, 0.02) * H);
  const hs = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const t = clamp((x / W - 0.3) / 0.4, 0, 1), w = t * t * (3 - 2 * t);
    hs[x] = clamp(a[x] * (1 - w) + b[x] * w, H * 0.15, H);
  }
  return hs;
}

/** Paint the ground onto `tc`; the two biomes' colours cross-fade over the middle of the field. */
export function paintTerrain(tc, hs, W, H, L, R) {
  tc.width = W; tc.height = H;
  const c = tc.getContext('2d');
  const gradFor = (ctx, st) => {
    const g = ctx.createLinearGradient(0, 100, 0, H);
    st.soil.forEach((col, i) => g.addColorStop([0, 0.35, 1][i], col));
    return g;
  };
  const path = ctx => {
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, hs[x]);
    ctx.lineTo(W, H); ctx.closePath();
  };
  const edge = (ctx, col) => {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.beginPath();
    for (let x = 0; x < W; x++) x ? ctx.lineTo(x, hs[x]) : ctx.moveTo(x, hs[x]);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };
  c.fillStyle = gradFor(c, L); path(c); c.fill(); edge(c, L.edge);
  if (L !== R) {
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tx = t.getContext('2d');
    tx.fillStyle = gradFor(tx, R); path(tx); tx.fill(); edge(tx, R.edge);
    tx.globalCompositeOperation = 'destination-in';
    const m = tx.createLinearGradient(0, 0, W, 0);
    m.addColorStop(0.3, 'rgba(0,0,0,0)'); m.addColorStop(0.7, 'rgba(0,0,0,1)');
    tx.fillStyle = m; tx.fillRect(0, 0, W, H);
    c.drawImage(t, 0, 0);
  }
  return { left: gradFor(c, L), right: gradFor(c, R) };
}
