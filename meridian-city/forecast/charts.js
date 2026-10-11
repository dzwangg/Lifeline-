// SVG charts for one metric: levels (baseline vs policy with 80%/95% bands, observed history, illustrative target)
// and the paired change (policy minus baseline) against a zero reference. Both draw the shared display cursor.
// Colours: categorical slots 1/2 (validated pair, see dataviz palette); target and history stay neutral ink.
import { level, change } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 360, H = 170, PAD = { l: 52, r: 10, t: 10, b: 22 };
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...kids.filter(Boolean));
  return el;
};

function scales(xs, ys) {
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= Math.abs(y0) * .05 + 1; y1 += Math.abs(y1) * .05 + 1; }
  const pad = (y1 - y0) * .08; y0 -= pad; y1 += pad;
  const X = v => PAD.l + (v - x0) / Math.max(1, x1 - x0) * (W - PAD.l - PAD.r);
  const Y = v => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  return { X, Y, x0, x1, y0, y1 };
}

const line = (pts, X, Y) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('');
const band = (xs, lo, hi, X, Y) => line(xs.map((x, i) => [x, hi[i]]), X, Y) + xs.slice().reverse().map((x, i) => `L${X(x).toFixed(1)},${Y(lo[lo.length - 1 - i]).toFixed(1)}`).join('') + 'Z';

function axes(g, sc, fmt, m) {
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = sc.y0 + (sc.y1 - sc.y0) * i / ticks, y = sc.Y(v);
    g.append(s('line', { x1: PAD.l, x2: W - PAD.r, y1: y, y2: y, class: 'fc-grid' }),
      s('text', { x: PAD.l - 6, y: y + 3, class: 'fc-tick', 'text-anchor': 'end' }, fmt(v, m)));
  }
  const step = sc.x1 - sc.x0 > 12 ? 4 : sc.x1 - sc.x0 > 6 ? 2 : 1;
  for (let x = Math.ceil(sc.x0 / step) * step; x <= sc.x1; x += step)
    g.append(s('text', { x: sc.X(x), y: H - 6, class: 'fc-tick', 'text-anchor': 'middle' }, String(x)));
}

/**
 * @param {object} m metric entry from the result (series with baseline/policy/delta quantiles)
 * @param {object} o { history: {years, values}|null, origin: {year, value}|null, kind: 'level'|'delta' }
 * Returns { el, setCursor(yearFloat) }.
 */
export function chart(m, o) {
  const delta = o.kind === 'delta';
  const yrs = m.series.map(r => r.year);
  const pick = (k, q) => m.series.map(r => r[k][q]);
  const xsAll = [...(o.history?.years ?? []), ...(o.origin ? [o.origin.year] : []), ...yrs];
  const ysAll = delta
    ? [0, ...pick('delta', 'p2_5'), ...pick('delta', 'p97_5')]
    : [...(o.history?.values ?? []), ...pick('baseline', 'p2_5'), ...pick('baseline', 'p97_5'), ...pick('policy', 'p2_5'),
       ...pick('policy', 'p97_5'), ...(o.origin ? [o.origin.value] : []), ...m.series.map(r => r.target).filter(v => v != null)];
  const sc = scales(xsAll, ysAll), { X, Y } = sc;
  const fmt = delta ? change : level;
  const g = s('g');
  axes(g, sc, fmt, m);
  // prepend the origin so projection bands start from the 2026 nowcast instead of floating
  const withOrigin = (arr, v) => (o.origin && !delta ? [v, ...arr] : arr);
  const xs = withOrigin(yrs, o.origin?.year);
  const series = delta ? [['delta', 'fc-s2']] : [['baseline', 'fc-s1'], ['policy', 'fc-s2']];
  for (const [k, c] of series) {
    const lo95 = withOrigin(pick(k, 'p2_5'), o.origin?.value), hi95 = withOrigin(pick(k, 'p97_5'), o.origin?.value);
    const lo80 = withOrigin(pick(k, 'p10'), o.origin?.value), hi80 = withOrigin(pick(k, 'p90'), o.origin?.value);
    g.append(s('path', { d: band(xs, lo95, hi95, X, Y), class: `fc-band95 ${c}` }), s('path', { d: band(xs, lo80, hi80, X, Y), class: `fc-band80 ${c}` }));
  }
  if (delta) g.append(s('line', { x1: PAD.l, x2: W - PAD.r, y1: Y(0), y2: Y(0), class: 'fc-zero' }));
  if (o.history) g.append(s('path', { d: line(o.history.years.map((x, i) => [x, o.history.values[i]]), X, Y), class: 'fc-hist' }));
  if (!delta && m.series.some(r => r.target != null)) {
    const pts = m.series.filter(r => r.target != null).map(r => [r.year, r.target]);
    g.append(s('path', { d: line(pts, X, Y), class: 'fc-target' }));
  }
  for (const [k, c] of series) {
    const med = withOrigin(pick(k, 'p50'), o.origin?.value);
    g.append(s('path', { d: line(xs.map((x, i) => [x, med[i]]), X, Y), class: `fc-line ${c}` }));
    yrs.forEach((x, i) => g.append(s('circle', { cx: X(x), cy: Y(m.series[i][k].p50), r: 4, class: `fc-dot ${c}` })));
  }
  const cursor = s('line', { y1: PAD.t, y2: H - PAD.b, class: 'fc-cursor' });
  const hover = s('line', { y1: PAD.t, y2: H - PAD.b, class: 'fc-hover', visibility: 'hidden' });
  g.append(cursor, hover);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fc-chart', role: 'img',
    'aria-label': `${m.label}: ${delta ? 'change from baseline' : 'baseline and policy paths'} with 80% and 95% intervals` }, g);

  // hover: a crosshair and tooltip on the nearest year; hit area is the whole plot, not the 8px dot
  const tip = document.createElement('div');
  tip.className = 'fc-tip'; tip.hidden = true;
  const wrap = document.createElement('div');
  wrap.className = 'fc-chartwrap';
  wrap.append(svg, tip);
  const hit = s('rect', { x: PAD.l, y: PAD.t, width: W - PAD.l - PAD.r, height: H - PAD.t - PAD.b, fill: 'transparent' });
  g.append(hit);
  hit.addEventListener('pointermove', e => {
    const box = svg.getBoundingClientRect(), vx = (e.clientX - box.left) / box.width * W;
    let best = 0;
    yrs.forEach((x, i) => { if (Math.abs(X(x) - vx) < Math.abs(X(yrs[best]) - vx)) best = i; });
    const r = m.series[best];
    hover.setAttribute('x1', X(r.year)); hover.setAttribute('x2', X(r.year)); hover.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = delta
      ? `<b>${r.year}</b> change ${change(r.delta.p50, m)}<br><span>80%: ${change(r.delta.p10, m)} to ${change(r.delta.p90, m)}</span>`
      : `<b>${r.year}</b><br><i class="fc-key fc-s1"></i>Current policy ${level(r.baseline.p50, m)}<br>` +
        `<i class="fc-key fc-s2"></i>Selected ${level(r.policy.p50, m)}` + (r.target != null ? `<br><span>Target ${level(r.target, m)}</span>` : '');
    tip.style.left = `${Math.min(70, X(r.year) / W * 100)}%`;
  });
  hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; });

  return {
    el: wrap,
    setCursor(yearFloat) {
      const x = X(Math.max(sc.x0, Math.min(sc.x1, yearFloat)));
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
    },
  };
}

export function legend({ delta = false, target = false, history = false } = {}) {
  const item = (cls, text) => `<span class="fc-leg"><i class="fc-key ${cls}"></i>${text}</span>`;
  return delta
    ? item('fc-s2', 'Selected minus current policy (median, 80% and 95% bands)') + item('fc-zero-key', 'No change')
    : item('fc-s1', 'Current policy') + item('fc-s2', 'Selected policy') + (history ? item('fc-hist-key', 'Observed') : '') +
      (target ? item('fc-target-key', 'Illustrative target') : '');
}
