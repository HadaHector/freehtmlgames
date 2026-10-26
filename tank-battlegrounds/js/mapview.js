// DOM rendering of the strategy grid.
import { BIOMES } from './biomes.js';
import { BUILDINGS } from './map.js';
import { UNITS } from './weapons.js';

/** Tiny tank silhouette; size shows the unit class (light < tank < heavy). */
function unitIcon(kind, col) {
  const w = { light: 0.26, tank: 0.36, heavy: 0.52 }[kind];
  const gun = kind === 'heavy' ? '<rect x="13" y="3.6" width="12" height="3.4" fill="#222"/>' : '<rect x="14" y="4.5" width="11" height="2.2" fill="#222"/>';
  return `<svg viewBox="0 0 26 16" style="width:calc(var(--cs) * ${w})"><rect x="1" y="11" width="22" height="4" rx="2" fill="#222"/>` +
    `<rect x="3" y="7" width="18" height="5" rx="1" fill="${col}" stroke="#000" stroke-width=".6"/>` +
    `<path d="M7 7a5 5 0 0 1 10 0z" fill="${col}" stroke="#000" stroke-width=".6"/>${gun}</svg>`;
}

export function createMapView(gridEl, wrapEl) {
  let map = null, cells = [];
  const view = { onCell: null };

  view.build = m => {
    map = m; gridEl.innerHTML = '';
    gridEl.style.setProperty('--cols', m.w); gridEl.style.setProperty('--rows', m.h);
    cells = m.cells.map(c => {
      const el = document.createElement('div');
      el.className = 'cell ' + (c.type === 'water' ? 'water' : 'land');
      if (c.type === 'land') {
        el.style.setProperty('--biome', BIOMES[c.biome].map);
        el.style.setProperty('--lift', c.height / 3);
        el.innerHTML = '<span class="bld"></span><span class="hh"></span><span class="tk"></span>';
        el.querySelector('.hh').textContent = c.height ? '▲'.repeat(c.height) : '';
        el.onclick = () => view.onCell && view.onCell(c);
      }
      gridEl.appendChild(el);
      return el;
    });
    view.fit();
  };

  view.fit = () => {
    if (!map) return;
    const r = wrapEl.getBoundingClientRect();
    const cs = Math.max(20, Math.floor(Math.min(r.width / map.w, r.height / map.h)) - 1);
    gridEl.style.width = cs * map.w + 'px'; gridEl.style.height = cs * map.h + 'px';
    gridEl.style.setProperty('--cs', cs + 'px');
  };

  /** ui = { selected, targets: Map(cell -> 'move'|'attack'), flash: [cells], actors: Set(cells) } */
  view.render = ui => {
    for (const c of map.cells) {
      if (c.type !== 'land') continue;
      const el = cells[c.idx], p = c.owner >= 0 ? map.players[c.owner] : null;
      el.style.setProperty('--own', p ? p.col : 'transparent');
      el.classList.toggle('owned', !!p);
      el.querySelector('.bld').textContent = c.building ? BUILDINGS[c.building].icon : '';
      el.querySelector('.tk').innerHTML = c.tanks ? unitIcon(c.unit || 'tank', p ? '#fff' : UNITS[c.unit || 'tank'].neutral || '#9a9a9a') + c.tanks : '';
      el.classList.toggle('sel', ui.selected === c);
      el.classList.toggle('ready', ui.actors.has(c));
      const t = ui.targets.get(c);
      el.classList.toggle('t-move', t === 'move');
      el.classList.toggle('t-attack', t === 'attack');
      el.classList.toggle('flash', ui.flash.includes(c));
    }
  };
  new ResizeObserver(view.fit).observe(wrapEl);
  return view;
}
