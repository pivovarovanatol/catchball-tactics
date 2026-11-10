// App: play list, playback, free board, editor (coach mode), sharing and publishing.
import {
  KEYS, clone, clamp, dist, startZones, lineup, buildSnaps, ballPos, sameBall,
  autoTiming, stepArrows, describeStep, render,
} from './core.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const svg = $('court');
const params = new URLSearchParams(location.search);

// ---------- State ----------
let plays = [];               // repo plays merged with local drafts (draft wins); draft has _local = true
let mode = 'free';            // free | view | edit
const free = { serving: 'A', receive: true, zones: startZones(), pos: {}, ball: null };
let view = null;              // play being watched
let edit = null;              // editor state

const showZones = () => $('showZones').checked;
const say = (elm, text, cls) => { elm.textContent = text || ''; elm.className = 'msg' + (cls ? ' ' + cls : ''); };
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// ---------- Coach mode ----------
let coach = params.get('coach') === '1' || !!lsGet('cb-coach');
function setCoach(on) {
  coach = on;
  lsSet('cb-coach', on);
  document.body.classList.toggle('coach', on);
  $('btnCoach').textContent = on ? 'Exit coach mode' : 'Coach mode';
  updatePubStatus();
  fillList(playSel.value);
}

function updatePubStatus() {
  const s = store.getSettings();
  $('pubStatus').innerHTML = store.canPublish()
    ? `Saving commits to <b>${s.owner}/${s.repo}</b> (${s.branch}).`
    : 'Not connected. Plays you save stay on this device until you add a GitHub token.';
}

// ---------- Free board ----------
function freeSnap() { const l = lineup(free.serving, free.receive, free.zones); free.pos = l.pos; free.ball = l.ball; }
function rotate(k) {
  for (const n in free.zones[k]) free.zones[k][n] = free.zones[k][n] === 1 ? 6 : free.zones[k][n] - 1;
  freeSnap();
}
function drawFree() {
  render({ pos: free.pos, serving: free.serving, holder: free.ball.holder, showZones: showZones() });
  $('serveA').classList.toggle('on', free.serving === 'A');
  $('serveB').classList.toggle('on', free.serving === 'B');
}

function setMode(m) {
  mode = m;
  $('freeBar').classList.toggle('hide', m !== 'free');
  $('playbar').classList.toggle('hide', m !== 'view');
  $('editor').classList.toggle('hide', m !== 'edit');
  $('freeCtl').disabled = m !== 'free';
  svg.classList.toggle('locked', m === 'view');
  const lockList = m === 'edit' || (m === 'view' && view && view.returnToEdit);
  ['btnOpen', 'btnEdit', 'btnNew', 'btnDup', 'btnDel', 'playSel'].forEach((id) => { $(id).disabled = lockList; });
}

function setUrlPlay(id) {
  const u = new URL(location.href);
  if (id) u.searchParams.set('play', id); else u.searchParams.delete('play');
  u.searchParams.delete('coach');
  history.replaceState(null, '', u);
}

// ---------- Playback ----------
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function openView(play, returnToEdit) {
  stopAnim();
  view = { play, snaps: buildSnaps(play), cursor: 0, t: 0, playing: false, single: false, raf: 0, last: 0, pause: 0, returnToEdit };
  setMode('view');
  $('btnCloseView').textContent = returnToEdit ? '← Back to editor' : '✕ Close';
  $('btnShare').classList.toggle('hide', !!returnToEdit);
  say($('shareMsg'), '');
  const dots = $('dots');
  dots.innerHTML = '';
  play.steps.forEach(() => dots.appendChild(document.createElement('span')));
  if (!returnToEdit) setUrlPlay(play.id);
  drawView();
}
function closeView() {
  stopAnim();
  const back = view && view.returnToEdit;
  view = null;
  if (back) { setMode('edit'); drawEdit(); } else { setUrlPlay(null); setMode('free'); drawFree(); }
}
function drawView() {
  const { snaps, cursor, t, play } = view, n = play.steps.length;
  const a = snaps[cursor], b = snaps[Math.min(cursor + 1, n)];
  const e = ease(t), pos = {};
  for (const k of KEYS) pos[k] = [a.pos[k][0] + (b.pos[k][0] - a.pos[k][0]) * e, a.pos[k][1] + (b.pos[k][1] - a.pos[k][1]) * e];

  let holder = null, ballDraw = null, landing = null;
  const moving = t > 0 && cursor < n;
  if (moving && !sameBall(a.ball, b.ball)) {
    const s = ballPos(a, a.pos), f = ballPos(b, b.pos);
    ballDraw = { x: s[0] + (f[0] - s[0]) * t, y: s[1] + (f[1] - s[1]) * t, lift: Math.sin(Math.PI * t) * (play.steps[cursor].arc || 30) };
  } else {
    const s = moving ? a : snaps[cursor];
    if (s.ball.holder) holder = s.ball.holder;
    else { ballDraw = { x: s.ball.point[0], y: s.ball.point[1], lift: 0 }; landing = s.ball.point; }
  }

  const arrows = [];
  const last = moving ? cursor : cursor - 1;
  for (let k = 0; k <= last && k < n; k++) arrows.push(...stepArrows(snaps[k], snaps[k + 1], play.steps[k].arc, k === last ? 1 : 0.3));

  render({ pos, serving: play.serving, holder, ballDraw, arrows, landing, showZones: showZones() });

  let text, label;
  if (moving) { text = play.steps[cursor].cap; label = `Step ${cursor + 1}/${n}`; }
  else if (cursor === 0) { text = play.intro || play.name; label = 'Start'; }
  else { text = play.steps[cursor - 1].cap; label = `Step ${cursor}/${n}`; }
  $('captext').textContent = text || '';
  $('stepno').textContent = label;
  [...$('dots').children].forEach((s, i) => s.classList.toggle('done', i < cursor + (moving ? 1 : 0)));
  $('btnPlay').textContent = view.playing ? '❚❚ Pause' : (cursor >= n ? '⟲ Again' : '▶ Play');
  $('btnPrev').disabled = cursor === 0 && t === 0;
  $('btnNext').disabled = cursor >= n;
}
function tick(now) {
  if (!view) return;
  const dt = now - (view.last || now);
  view.last = now;
  const speed = +$('speed').value, n = view.play.steps.length;
  if (view.pause > 0) view.pause -= dt;
  else {
    view.t += (dt * speed) / (view.play.steps[view.cursor].dur || 1000);
    if (view.t >= 1) {
      view.t = 0;
      view.cursor++;
      if (view.cursor >= n || view.single) { view.playing = false; view.single = false; drawView(); return; }
      view.pause = 450 / speed;
    }
  }
  drawView();
  view.raf = requestAnimationFrame(tick);
}
function startAnim(single) {
  if (!view || view.playing || !view.play.steps.length) return;
  if (view.cursor >= view.play.steps.length) { view.cursor = 0; view.t = 0; }
  Object.assign(view, { playing: true, single: !!single, last: 0, pause: 0 });
  view.raf = requestAnimationFrame(tick);
}
function stopAnim() { if (!view) return; cancelAnimationFrame(view.raf); view.playing = false; view.single = false; }

async function sharePlay() {
  const p = view && view.play;
  if (!p) return;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('play', p.id);
  const link = url.toString();
  const msg = $('shareMsg');
  if (p._local) { say(msg, 'This play is only saved on this device. Publish it (Save with a GitHub token) before sharing the link.', 'err'); return; }
  try { await navigator.clipboard.writeText(link); say(msg, 'Link copied: ' + link, 'ok'); }
  catch { say(msg, 'Copy this link: ' + link, 'ok'); }
}

// ---------- Editor ----------
function openEditor(play) {
  edit = { draft: clone(play), dirty: false, editing: null }; // editing: null = adding a step, -1 = start, i = step i
  $('edName').value = play.name || '';
  $('edCap').value = '';
  say($('edMsg'), '');
  resetPending();
  setMode('edit');
  renderSteps();
  drawEdit();
}
function resetPending() {
  const snaps = buildSnaps(edit.draft), i = edit.editing;
  let base, end;
  if (i === null) { base = end = snaps[snaps.length - 1]; }
  else if (i === -1) { base = end = snaps[0]; }
  else { base = snaps[i]; end = snaps[i + 1]; }
  edit.base = base;
  edit.pending = { pos: clone(end.pos), ball: clone(end.ball) };
}
const pendingChanged = () => !sameBall(edit.base.ball, edit.pending.ball) || KEYS.some((k) => dist(edit.base.pos[k], edit.pending.pos[k]) > 3);
const roundPt = (p) => p.map((v) => Math.round(v));

function startEditing(i) {
  edit.editing = i;
  $('edCap').value = i >= 0 ? (edit.draft.steps[i].cap || '') : '';
  resetPending(); renderSteps(); drawEdit();
  say($('edMsg'), '');
}
function stopEditing() {
  edit.editing = null;
  $('edCap').value = '';
  resetPending(); renderSteps(); drawEdit();
}
function stepFromPending() {
  const moves = {};
  for (const k of KEYS) if (dist(edit.base.pos[k], edit.pending.pos[k]) > 3) moves[k] = roundPt(edit.pending.pos[k]);
  const b = clone(edit.pending.ball);
  if (b.point) b.point = roundPt(b.point);
  const tm = autoTiming(edit.base, edit.pending);
  return { cap: $('edCap').value.trim(), dur: tm.dur, arc: Math.round(tm.arc), moves, ball: sameBall(edit.base.ball, edit.pending.ball) ? null : b };
}
function addStep() {
  if (!pendingChanged()) return;
  edit.draft.steps.push(stepFromPending());
  $('edCap').value = '';
  edit.dirty = true;
  resetPending(); renderSteps(); drawEdit();
  say($('edMsg'), '');
}
function updateStep() {
  const i = edit.editing;
  if (i === -1) {
    edit.draft.start = { pos: Object.fromEntries(KEYS.map((k) => [k, roundPt(edit.pending.pos[k])])), ball: clone(edit.pending.ball) };
    edit.dirty = true; stopEditing(); say($('edMsg'), 'Starting lineup updated.', 'ok');
    return;
  }
  edit.draft.steps[i] = stepFromPending();
  edit.dirty = true; stopEditing(); say($('edMsg'), `Step ${i + 1} updated.`, 'ok');
}

function drawEdit() {
  const d = edit.draft, n = d.steps.length, ei = edit.editing;
  const arrows = [];
  const prevIdx = ei === null ? n - 1 : ei - 1; // the step before the one being built, shown faintly
  if (prevIdx >= 0) { const snaps = buildSnaps(d); arrows.push(...stepArrows(snaps[prevIdx], snaps[prevIdx + 1], d.steps[prevIdx].arc, 0.3)); }
  const tm = autoTiming(edit.base, edit.pending);
  arrows.push(...stepArrows(edit.base, edit.pending, tm.arc, 1));
  const pb = edit.pending.ball;
  render({
    pos: edit.pending.pos, serving: d.serving, holder: pb.holder || null,
    ballDraw: pb.point ? { x: pb.point[0], y: pb.point[1], lift: 0 } : null, arrows, landing: pb.point || null, showZones: showZones(),
  });

  const hint = $('edHint'), addBtn = $('edAdd'), undoBtn = $('edUndo');
  if (ei !== null) {
    addBtn.textContent = ei === -1 ? '✓ Update start' : `✓ Update step ${ei + 1}`;
    undoBtn.textContent = 'Cancel';
    addBtn.disabled = false; undoBtn.disabled = false;
    $('edTest').disabled = true;
    hint.innerHTML = ei === -1
      ? '<b>Editing the starting lineup.</b> Drag players to their starting spots and tap the player who has the ball. Every step keeps its moves. Then press <b>“✓ Update start”</b>.'
      : `<b>Editing step ${ei + 1}.</b> The board shows how this step ends. Drag players, tap a player or the floor to change where the ball goes, edit the caption, then press <b>“✓ Update step ${ei + 1}”</b>. Later steps stay as they are.`;
    return;
  }
  const changed = pendingChanged();
  addBtn.textContent = '+ Add step';
  undoBtn.textContent = 'Undo changes';
  hint.innerHTML = `<b>Step ${n + 1}.</b> Drag players to where they run. Tap a player to throw the ball to them; tap the floor to make the ball land there. `
    + (changed ? 'Then press <b>“+ Add step”</b>.' : (n ? 'Nothing changed yet.' : 'The board now shows the starting lineup.'));
  addBtn.disabled = !changed;
  undoBtn.disabled = !changed;
  $('edTest').disabled = !n;
}

function smallButton(text, title, onclick, cls) {
  const b = document.createElement('button');
  b.textContent = text; b.title = title; b.onclick = onclick;
  if (cls) b.className = cls;
  return b;
}
function renderSteps() {
  const ol = $('edSteps');
  ol.innerHTML = '';
  const ei = edit.editing;
  const st = document.createElement('li');
  if (ei === -1) st.className = 'editing';
  const sn = document.createElement('span'); sn.className = 'n'; sn.textContent = '0.';
  const sl = document.createElement('span'); sl.className = 'startlbl'; sl.textContent = 'Starting lineup';
  st.append(sn, sl, smallButton('✎', 'Edit starting lineup', () => startEditing(-1)), document.createElement('span'));
  ol.appendChild(st);
  edit.draft.steps.forEach((s, i) => {
    const li = document.createElement('li');
    if (ei === i) li.className = 'editing';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = `${i + 1}.`;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = s.cap || ''; inp.placeholder = 'Step caption'; inp.disabled = ei === i;
    inp.oninput = () => { s.cap = inp.value; edit.dirty = true; };
    const del = smallButton('✕', 'Delete step', () => {
      edit.draft.steps.splice(i, 1); edit.dirty = true; edit.editing = null; $('edCap').value = '';
      resetPending(); renderSteps(); drawEdit();
    }, 'danger');
    const det = document.createElement('div'); det.className = 'detail'; det.textContent = describeStep(s);
    li.append(n, inp, smallButton('✎', 'Edit step', () => startEditing(i)), del, det);
    ol.appendChild(li);
  });
}

// ---------- Saving and publishing ----------

/** Save a play on this device, then publish it to the repo if a token is set. */
async function persistPlay(play, msgEl) {
  play.updated = new Date().toISOString();
  const data = store.clean(play);
  store.putLocal(data);
  upsert({ ...data, _local: true });
  fillList(data.id);
  if (!store.canPublish()) {
    say(msgEl, 'Saved on this device. To publish it for everyone, add a GitHub token (⚙ GitHub settings) and save again, or download the JSON and commit it.', 'ok');
    return true;
  }
  say(msgEl, 'Publishing to GitHub…');
  try {
    await store.publishPlay(data);
    store.removeLocal(data.id);
    repoIds.add(data.id);
    upsert(data);
    fillList(data.id);
    say(msgEl, 'Published to the repo. The shared site updates in about a minute.', 'ok');
    return true;
  } catch (e) {
    say(msgEl, `Saved on this device, but publishing failed: ${e.message}`, 'err');
    return false;
  }
}
function upsert(p) {
  const i = plays.findIndex((x) => x.id === p.id);
  if (i >= 0) plays[i] = p; else plays.push(p);
}

async function saveDraft() {
  const d = edit.draft, msg = $('edMsg');
  if (edit.editing !== null) { say(msg, 'Finish editing first: press “✓ Update” or “Cancel”.', 'err'); return; }
  d.name = $('edName').value.trim() || 'Untitled';
  if (!d.steps.length) { say(msg, 'Add at least one step first.', 'err'); return; }
  if (!d.id) d.id = store.newId(d.name);
  await persistPlay(d, msg);
  edit.dirty = false;
}

function downloadDraft() {
  const d = edit.draft;
  d.name = $('edName').value.trim() || 'Untitled';
  if (!d.id) d.id = store.newId(d.name);
  const blob = new Blob([JSON.stringify(store.clean(d), null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${d.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say($('edMsg'), `Downloaded ${d.id}.json. Put it in plays/ and run “node scripts/build-index.mjs”.`, 'ok');
}

// ---------- Dragging and tapping ----------
let drag = null, tap = null;
function toSvg(e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
const livePos = () => (mode === 'edit' ? edit.pending.pos : free.pos);
const redraw = () => (mode === 'edit' ? drawEdit() : drawFree());

svg.addEventListener('pointerdown', (e) => {
  if (mode === 'view') return;
  const g = e.target.closest('.player'), pt = toSvg(e);
  if (g) {
    const key = g.dataset.key, p = livePos()[key];
    drag = { key, dx: p[0] - pt.x, dy: p[1] - pt.y, moved: false, sx: e.clientX, sy: e.clientY };
    g.classList.add('dragging');
  } else if (mode === 'edit') {
    tap = { sx: e.clientX, sy: e.clientY, pt: [pt.x, pt.y] };
  }
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
  if (!drag.moved) return;
  const pt = toSvg(e);
  livePos()[drag.key] = [clamp(pt.x + drag.dx, -65, 605), clamp(pt.y + drag.dy, -38, 308)];
  redraw();
});
svg.addEventListener('pointerup', (e) => {
  if (drag) {
    if (!drag.moved) {
      if (mode === 'edit') edit.pending.ball = { holder: drag.key };
      else free.ball = { holder: drag.key };
    }
    drag = null;
    redraw();
  } else if (tap && mode === 'edit' && edit.editing !== -1) {
    if (Math.hypot(e.clientX - tap.sx, e.clientY - tap.sy) < 6) { edit.pending.ball = { point: roundPt(tap.pt) }; drawEdit(); }
  }
  tap = null;
});
svg.addEventListener('pointercancel', () => { drag = null; tap = null; redraw(); });

// ---------- Play list ----------
const playSel = $('playSel');
function fillList(selectId) {
  playSel.innerHTML = '';
  for (const p of plays) playSel.add(new Option(p.name + (p._local ? '  • on this device' : ''), p.id));
  if (selectId && plays.some((p) => p.id === selectId)) playSel.value = selectId;
  const none = !plays.length;
  ['btnOpen', 'btnEdit', 'btnDup', 'btnDel'].forEach((id) => { $(id).disabled = none || mode === 'edit'; });
  if (none) playSel.add(new Option('— no plays yet —', ''));
}
const selected = () => plays.find((p) => p.id === playSel.value);

$('btnOpen').onclick = () => { const p = selected(); if (p) openView(p, false); };
$('btnEdit').onclick = () => { const p = selected(); if (p) { stopAnim(); view = null; openEditor(p); } };
$('btnNew').onclick = () => {
  stopAnim(); view = null;
  setMode('free');
  openEditor({ id: null, name: '', serving: free.serving, intro: '', start: { pos: clone(free.pos), ball: clone(free.ball) }, steps: [] });
};
$('btnDup').onclick = async () => {
  const p = selected();
  if (!p) return;
  const copy = clone(p);
  delete copy._local;
  copy.name = p.name + ' (copy)';
  copy.id = store.newId(copy.name);
  await persistPlay(copy, $('listMsg'));
};
let delArmed = 0;
$('btnDel').onclick = async () => {
  const p = selected();
  if (!p) return;
  const btn = $('btnDel'), msg = $('listMsg');
  if (Date.now() - delArmed > 3000) {
    delArmed = Date.now(); btn.textContent = 'Really delete?';
    setTimeout(() => { btn.textContent = 'Delete'; }, 3000);
    return;
  }
  delArmed = 0; btn.textContent = 'Delete';
  const inRepo = !p._local || repoIds.has(p.id);
  if (inRepo && !store.canPublish()) { say(msg, 'This play is in the repo. Add a GitHub token (⚙ GitHub settings) to delete it.', 'err'); return; }
  try {
    if (inRepo) { say(msg, 'Deleting from the repo…'); await store.unpublishPlay(p); }
    store.removeLocal(p.id);
    plays = plays.filter((x) => x.id !== p.id);
    if (mode === 'view') { stopAnim(); view = null; setUrlPlay(null); setMode('free'); drawFree(); }
    fillList();
    say(msg, `Deleted “${p.name}”.`, 'ok');
  } catch (e) { say(msg, `Could not delete: ${e.message}`, 'err'); }
};

// ---------- Playback buttons ----------
$('btnPlay').onclick = () => { if (!view) return; if (view.playing) { stopAnim(); drawView(); } else startAnim(false); };
$('btnNext').onclick = () => {
  if (!view) return;
  if (view.playing) { stopAnim(); view.t = 0; view.cursor = Math.min(view.cursor + 1, view.play.steps.length); drawView(); }
  else startAnim(true);
};
$('btnPrev').onclick = () => { if (!view) return; stopAnim(); if (view.t > 0) view.t = 0; else view.cursor = Math.max(0, view.cursor - 1); drawView(); };
$('btnReplay').onclick = () => { if (!view) return; stopAnim(); view.cursor = 0; view.t = 0; drawView(); startAnim(false); };
$('btnShare').onclick = sharePlay;
$('btnCloseView').onclick = () => { closeView(); fillList(playSel.value); };

// ---------- Editor buttons ----------
const addOrUpdate = () => (edit.editing === null ? addStep() : updateStep());
$('edAdd').onclick = addOrUpdate;
$('edCap').addEventListener('keydown', (e) => { if (e.key === 'Enter') addOrUpdate(); });
$('edUndo').onclick = () => { if (edit.editing !== null) stopEditing(); else { resetPending(); drawEdit(); } };
$('edName').oninput = () => { edit.dirty = true; };
$('edTest').onclick = () => {
  edit.draft.name = $('edName').value.trim() || 'Untitled';
  resetPending();
  openView(edit.draft, true);
};
$('edSave').onclick = saveDraft;
$('edDownload').onclick = downloadDraft;
let closeArmed = 0;
$('edClose').onclick = () => {
  const btn = $('edClose');
  if (edit.dirty && Date.now() - closeArmed > 3000) {
    closeArmed = Date.now(); btn.textContent = 'Not saved. Close anyway?';
    setTimeout(() => { btn.textContent = 'Close'; }, 3000);
    return;
  }
  closeArmed = 0; btn.textContent = 'Close';
  edit = null; setMode('free'); fillList(playSel.value); drawFree();
};

// ---------- Free board buttons ----------
$('serveA').onclick = () => { free.serving = 'A'; freeSnap(); drawFree(); };
$('serveB').onclick = () => { free.serving = 'B'; freeSnap(); drawFree(); };
$('rotA').onclick = () => { rotate('A'); drawFree(); };
$('rotB').onclick = () => { rotate('B'); drawFree(); };
$('receive').onchange = (e) => { free.receive = e.target.checked; freeSnap(); drawFree(); };
$('reset').onclick = () => { free.serving = 'A'; free.zones = startZones(); freeSnap(); drawFree(); };
$('showZones').onchange = () => (mode === 'view' ? drawView() : redraw());

// ---------- Settings ----------
const dlg = $('settings');
function fillSettings() {
  const s = store.getSettings();
  $('setOwner').value = s.owner; $('setRepo').value = s.repo; $('setBranch').value = s.branch; $('setToken').value = s.token;
  say($('setMsg'), '');
}
const readSettings = () => ({
  owner: $('setOwner').value.trim(), repo: $('setRepo').value.trim(),
  branch: $('setBranch').value.trim() || 'main', token: $('setToken').value.trim(),
});
$('btnSettings').onclick = () => { fillSettings(); dlg.showModal(); };
$('setClose').onclick = () => dlg.close();
$('setSave').onclick = () => { store.saveSettings(readSettings()); updatePubStatus(); say($('setMsg'), 'Saved in this browser.', 'ok'); };
$('setForget').onclick = () => { const s = readSettings(); s.token = ''; store.saveSettings(s); $('setToken').value = ''; updatePubStatus(); say($('setMsg'), 'Token removed from this browser.', 'ok'); };
$('setTest').onclick = async () => {
  store.saveSettings(readSettings());
  updatePubStatus();
  say($('setMsg'), 'Checking…');
  try {
    const r = await store.testConnection();
    say($('setMsg'), r.push ? `Connected to ${r.fullName}. You can publish.` : `Connected to ${r.fullName}, but this token can't write to it.`, r.push ? 'ok' : 'err');
  } catch (e) { say($('setMsg'), e.message, 'err'); }
};
$('btnCoach').onclick = () => setCoach(!coach);

// ---------- Startup ----------
let repoIds = new Set();
async function init() {
  let repoPlays = [];
  try { repoPlays = await store.loadRepoPlays(); }
  catch (e) { say($('listMsg'), `Couldn't load plays from the site (${e.message}).`, 'err'); }
  repoIds = new Set(repoPlays.map((p) => p.id));
  const drafts = store.getLocal().map((p) => ({ ...p, _local: true }));
  plays = repoPlays.slice();
  for (const d of drafts) upsert(d);

  setCoach(coach);
  freeSnap();
  const wanted = params.get('play');
  fillList(wanted || (plays[0] && plays[0].id));
  setMode('free');
  const p = wanted ? plays.find((x) => x.id === wanted) : plays[0];
  if (wanted && !p) say($('listMsg'), 'That play link was not found. It may have been renamed or deleted.', 'err');
  if (p) openView(p, false); else drawFree();
}
init();
