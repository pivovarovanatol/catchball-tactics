// Court geometry, play model helpers and drawing. No app state lives here.
//
// Coordinates: 1 m = 30 units. The court is x 0–540, y 0–270, net at x = 270.
// Blue (team "A") plays on the left, Red (team "B") on the right.
// Player keys are team letter + number: A1…A6, B1…B6.

export const NS = 'http://www.w3.org/2000/svg';
export const M = 30;
export const COLORS = { A: '#1f5fbf', B: '#c8362d' };
export const SHORT = { A: 'B', B: 'R' }; // Blue / Red, used in step summaries
export const KEYS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];

// Positions in metres for the LEFT team, facing the net. The right team is mirrored.
export const BASE    = { 4: [7.2, 1.6], 3: [7.2, 4.5], 2: [7.2, 7.4], 5: [2.6, 1.6], 6: [2.6, 4.5], 1: [2.6, 7.4] };
export const RECEIVE = { 4: [5.4, 1.3], 3: [8.0, 4.5], 2: [5.4, 7.7], 5: [2.4, 2.3], 6: [3.6, 4.5], 1: [2.4, 6.7] };
export const SERVER_SPOT = [-1.2, 7.4];

export const toCourt = (k, [mx, my]) => (k === 'A' ? [mx * M, my * M] : [(18 - mx) * M, (9 - my) * M]);
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const keyName = (k) => SHORT[k[0]] + k.slice(1);
export const startZones = () => ({ A: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }, B: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 } });

/** Positions for both teams given who serves, whether the receivers use the receive shape, and each player's zone. */
export function lineup(serving, receive, zones) {
  const pos = {};
  for (const k of ['A', 'B']) {
    for (let n = 1; n <= 6; n++) {
      const z = zones[k][n];
      let spot = k !== serving && receive ? RECEIVE[z] : BASE[z];
      if (k === serving && z === 1) spot = SERVER_SPOT;
      pos[k + n] = toCourt(k, spot);
    }
  }
  const server = Object.keys(zones[serving]).find((n) => zones[serving][n] === 1);
  return { pos, ball: { holder: serving + server } };
}

/** Positions and ball at the start and after each step. */
export function buildSnaps(play) {
  const snaps = [{ pos: clone(play.start.pos), ball: clone(play.start.ball) }];
  for (const s of play.steps) {
    const prev = snaps[snaps.length - 1];
    const pos = clone(prev.pos);
    for (const k in s.moves) pos[k] = s.moves[k].slice();
    snaps.push({ pos, ball: s.ball ? clone(s.ball) : clone(prev.ball) });
  }
  return snaps;
}

export const ballPos = (s, pos) => (s.ball.holder ? [pos[s.ball.holder][0] + 12, pos[s.ball.holder][1] - 12] : s.ball.point);
export const sameBall = (a, b) => (a.holder ? a.holder === b.holder : !!b.point && dist(a.point, b.point) < 1);

/** Duration (ms) and ball arc height for a step, from how far the ball and players travel. */
// Ball shots. "normal" is a regular throw or pass.
export const SHOTS = {
  normal: { label: 'Normal', icon: '' },
  spike: { label: 'Spike', icon: '⚡', hint: 'straight and fast' },
  rainbow: { label: 'Rainbow', icon: '🌈', hint: 'high, slow arc' },
};

/** Duration and arc for a step, adjusted for the kind of shot. */
export function shotTiming(a, b, shot) {
  const base = autoTiming(a, b);
  if (!shot || shot === 'normal' || sameBall(a.ball, b.ball)) return base;
  const d = dist(ballPos(a, a.pos), ballPos(b, b.pos));
  let run = 0;
  for (const k of KEYS) run = Math.max(run, dist(a.pos[k], b.pos[k]));
  if (shot === 'spike') return { arc: 4, dur: Math.round(clamp(Math.max(380 + d * 0.9, 300 + run * 2.2), 500, 1100)) };
  return { arc: Math.round(clamp(d * 0.35, 75, 140)), dur: Math.round(clamp(Math.max(1100 + d * 2.4, 500 + run * 3.2), 1400, 2800)) };
}

export function autoTiming(a, b) {
  const ballMoved = !sameBall(a.ball, b.ball);
  const bs = ballPos(a, a.pos), be = ballPos(b, b.pos);
  const d = ballMoved ? dist(bs, be) : 0;
  const cross = ballMoved && (bs[0] - 270) * (be[0] - 270) < 0;
  let run = 0;
  for (const k of KEYS) run = Math.max(run, dist(a.pos[k], b.pos[k]));
  const arc = ballMoved ? clamp(d * (cross ? 0.22 : 0.16), cross ? 35 : 16, cross ? 75 : 45) : 0;
  const dur = Math.round(clamp(Math.max(ballMoved ? 650 + d * 2.2 : 0, 500 + run * 3.2), 700, 2000));
  return { arc, dur };
}

export function stepArrows(a, b, arc, opacity, shot) {
  const list = [];
  for (const k of KEYS) if (dist(a.pos[k], b.pos[k]) > 3) list.push({ from: a.pos[k], to: b.pos[k], kind: k[0], opacity });
  if (!sameBall(a.ball, b.ball)) {
    const s = ballPos(a, a.pos), e = ballPos(b, b.pos);
    const side = e[0] > s[0] ? -1 : 1;
    const bend = shot === 'spike' ? 0 : shot === 'rainbow' ? side * Math.max(arc || 0, 75) * 0.75 : side * (arc || 30) * 0.55;
    list.push({ from: s, to: e, kind: 'ball', shot: shot || 'normal', bend, opacity });
  }
  return list;
}

/** Ball height (drawing units) at progress t of a step, for the 2D ball's "lift". */
export const ballLift = (t, arc, shot) => Math.sin(Math.PI * t) * (shot === 'spike' ? 4 : shot === 'rainbow' ? Math.max(arc || 0, 75) * 0.8 : (arc || 30));

export function describeStep(step) {
  const parts = [];
  const sh = step.shot && SHOTS[step.shot] && step.shot !== 'normal' ? `${SHOTS[step.shot].icon} ${SHOTS[step.shot].label.toLowerCase()} ` : '';
  if (step.ball) parts.push(sh + (step.ball.holder ? 'ball → ' + keyName(step.ball.holder) : 'ball → lands on floor'));
  const runs = Object.keys(step.moves || {});
  if (runs.length) parts.push('running: ' + runs.map(keyName).join(', '));
  return parts.join(' · ');
}

// ---------- Drawing ----------

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const a in attrs) e.setAttribute(a, attrs[a]);
  return e;
}

/**
 * Draw one frame.
 * scene = { pos, serving, holder?, ballDraw?: {x,y,lift}, arrows?: [...], landing?: [x,y], showZones }
 */
export function render(scene) {
  const zg = document.getElementById('zones');
  zg.innerHTML = '';
  zg.style.display = scene.showZones === false ? 'none' : '';
  const centers = { 4: [6, 1.5], 3: [6, 4.5], 2: [6, 7.5], 5: [1.6, 1.5], 6: [1.6, 4.5], 1: [1.6, 7.5] };
  for (const k of ['A', 'B']) {
    for (const z in centers) {
      const [x, y] = toCourt(k, centers[z]);
      const t = el('text', { x, y });
      t.textContent = z;
      zg.appendChild(t);
    }
  }
  const names = document.getElementById('teamNames');
  names.innerHTML = '';
  const a = el('text', { x: 135, y: 300, fill: '#fff' });
  a.textContent = 'BLUE' + (scene.serving === 'A' ? ' · serving' : ' · receiving');
  const b = el('text', { x: 405, y: 300, fill: '#fff' });
  b.textContent = 'RED' + (scene.serving === 'B' ? ' · serving' : ' · receiving');
  names.append(a, b);

  // Arrows
  const al = document.getElementById('arrows');
  al.innerHTML = '';
  for (const ar of scene.arrows || []) {
    const dx = ar.to[0] - ar.from[0], dy = ar.to[1] - ar.from[1], d = Math.hypot(dx, dy);
    if (d < 6) continue;
    const isBall = ar.kind === 'ball', ux = dx / d, uy = dy / d;
    const s1 = isBall ? 10 : 17, s2 = isBall ? 12 : 17;
    const x1 = ar.from[0] + ux * s1, y1 = ar.from[1] + uy * s1, x2 = ar.to[0] - ux * s2, y2 = ar.to[1] - uy * s2;
    const dAttr = ar.bend
      ? `M${x1} ${y1} Q${(x1 + x2) / 2 - uy * ar.bend} ${(y1 + y2) / 2 + ux * ar.bend} ${x2} ${y2}`
      : `M${x1} ${y1} L${x2} ${y2}`;
    const spike = isBall && ar.shot === 'spike', rainbow = isBall && ar.shot === 'rainbow';
    const path = el('path', {
      d: dAttr, fill: 'none', stroke: spike ? '#ffd23f' : rainbow ? '#bfe9ff' : isBall ? '#fff6d0' : COLORS[ar.kind],
      'stroke-width': spike ? 3.6 : 2.6, 'stroke-linecap': 'round', opacity: ar.opacity ?? 1,
      'marker-end': `url(#${spike ? 'arSpike' : rainbow ? 'arRainbow' : isBall ? 'arBall' : 'ar' + ar.kind})`,
    });
    if (isBall && !spike) path.setAttribute('stroke-dasharray', rainbow ? '2 6' : '7 6');
    al.appendChild(path);
    if (spike || rainbow) {
      // A small badge in the middle of the ball's path
      const mx = ar.bend ? (x1 + x2) / 2 - (uy * ar.bend) / 2 : (x1 + x2) / 2, my = ar.bend ? (y1 + y2) / 2 + (ux * ar.bend) / 2 : (y1 + y2) / 2;
      const t = el('text', { x: mx, y: my, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 15, opacity: ar.opacity ?? 1 });
      t.textContent = spike ? '⚡' : '🌈';
      al.appendChild(t);
    }
  }

  // Players
  const pl = document.getElementById('players');
  pl.innerHTML = '';
  for (const key of KEYS) {
    const [x, y] = scene.pos[key];
    const g = el('g', { class: 'player', 'data-key': key, transform: `translate(${x} ${y})` });
    if (scene.holder === key) g.appendChild(el('circle', { r: 20, fill: 'none', stroke: 'var(--ball)', 'stroke-width': 3.5 }));
    g.appendChild(el('circle', { r: 15.5, fill: COLORS[key[0]], stroke: '#fff', 'stroke-width': 2.4, filter: 'url(#shadow)' }));
    const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', 'font-size': 16 });
    t.textContent = key.slice(1);
    g.appendChild(t);
    pl.appendChild(g);
  }

  // Ball
  const bl = document.getElementById('ballLayer');
  bl.innerHTML = '';
  let bd = scene.ballDraw;
  if (!bd && scene.holder) {
    const [x, y] = scene.pos[scene.holder];
    bd = { x: x + 12, y: y - 12, lift: 0 };
  }
  if (bd) {
    const lift = bd.lift || 0, s = 1 + lift / 90;
    if (lift > 2) bl.appendChild(el('ellipse', { cx: bd.x, cy: bd.y, rx: 7, ry: 3.5, fill: '#000', opacity: 0.28 }));
    const g = el('g', { transform: `translate(${bd.x} ${bd.y - lift}) scale(${s})` });
    g.appendChild(el('circle', { r: 7.5, fill: 'var(--ball)', stroke: '#1f3f8f', 'stroke-width': 1.3 }));
    g.appendChild(el('path', { d: 'M-7 -1 Q0 3 7 -1 M-3 -6.5 Q-1 0 -4 6 M3 -6.5 Q5 0 3 6.5', stroke: '#1f3f8f', 'stroke-width': 1, fill: 'none' }));
    bl.appendChild(g);
  }

  // Landing marker
  const fx = document.getElementById('fx');
  fx.innerHTML = '';
  if (scene.landing) {
    const g = el('g', { transform: `translate(${scene.landing[0]} ${scene.landing[1]})` });
    for (let i = 0; i < 8; i++) {
      const an = (i * Math.PI) / 4;
      g.appendChild(el('line', {
        x1: Math.cos(an) * 12, y1: Math.sin(an) * 12, x2: Math.cos(an) * 22, y2: Math.sin(an) * 22,
        stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round',
      }));
    }
    fx.appendChild(g);
  }
}
