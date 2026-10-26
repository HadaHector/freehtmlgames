// Synthesised sound effects (no audio files) plus the shared mute / fullscreen buttons.
const KEY = 'tank-battlegrounds.muted';
let actx = null, master = null, noiseBuf = null, muted = false, lastBoomT = 0;
try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}

function ac() {
  if (muted) return null;
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { return null; }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
export const unlockAudio = ac;

function tone(f0, f1, dur, type, vol, delay = 0) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, f0, f1, delay = 0) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay, src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noiseBuf; fl.type = 'lowpass';
  fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(fl); fl.connect(g); g.connect(master); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}

export const sfx = {
  shoot() { noise(0.18, 0.3, 2500, 400); tone(240, 70, 0.15, 'square', 0.12); },
  boom(r) {
    const now = performance.now();
    if (r < 30 && now - lastBoomT < 60) return;
    lastBoomT = now;
    const v = Math.min(0.7, 0.25 + r / 120), d = 0.25 + r / 110;
    noise(d, v, 1200, 50); tone(110, 30, d, 'sine', v);
  },
  splash() { noise(0.35, 0.25, 3500, 700); },
  die() { noise(0.7, 0.6, 1500, 40); tone(80, 25, 0.7, 'sine', 0.6); noise(0.4, 0.3, 800, 60, 0.25); },
  heal() { [660, 880, 1320].forEach((f, i) => tone(f, f, 0.18, 'sine', 0.18, i * 0.09)); },
  blip() { tone(700, 900, 0.05, 'square', 0.08); },
  pop() { noise(0.15, 0.12, 4000, 500); tone(900, 200, 0.1, 'triangle', 0.06); },
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.22, i * 0.14)); },
  lose() { [392, 349, 311, 262].forEach((f, i) => tone(f, f * 0.97, 0.45, 'sawtooth', 0.12, i * 0.3)); },
};

function updateSoundBtns() { document.querySelectorAll('.muteBtn').forEach(b => { b.textContent = muted ? '🔇' : '🔊'; }); }
function toggleMute() {
  muted = !muted;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
  updateSoundBtns(); if (!muted) sfx.blip();
}

const fsEl = document.documentElement;
const fsOn = () => document.fullscreenElement || document.webkitFullscreenElement;
const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFs() {
  try {
    if (fsOn()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const r = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl);
      if (r && r.then) r.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => {});
    }
  } catch (e) {}
}

/** Wire every .muteBtn / .fsBtn in the page. */
export function wireCommonButtons() {
  document.querySelectorAll('.muteBtn').forEach(b => { b.onclick = toggleMute; });
  document.querySelectorAll('.fsBtn').forEach(b => { if (fsOk) b.onclick = toggleFs; else b.hidden = true; });
  updateSoundBtns();
}
