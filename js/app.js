// App: navigation tree, playback, free board, editor (coach mode), sharing and publishing.
import {
  KEYS, clone, clamp, dist, startZones, lineup, buildSnaps, ballPos, sameBall,
  autoTiming, stepArrows, describeStep, render, SHOTS, shotTiming, ballLift,
} from './core.js?v=202611101356';
import * as store from './store.js?v=202611101356';

const $ = (id) => document.getElementById(id);
const svg = $('court');
const params = new URLSearchParams(location.search);

// ---------- State ----------
let plays = [];               // repo plays merged with local drafts (draft wins); each has .folder, drafts have _local = true
let folders = new Set();      // every folder path, including empty ones ("A", "A/B", ...)
let repoIds = new Set();      // ids of plays that exist in the repo
let mode = 'free';            // free | view | edit
const free = { serving: 'A', receive: true, zones: startZones(), pos: {}, ball: null };
let view = null;              // play being watched
let edit = null;              // editor state
let currentId = null;         // play shown on the board (view or edit)
const checked = new Set();    // play ids ticked in the tree (coach mode)
let v3 = null;                // 3D viewer (loaded on first use)
let use3d = false;            // the viewer's 2D/3D choice (remembered, read below)

const showZones = () => $('showZones').checked;
const say = (elm, text, cls) => { elm.textContent = text || ''; elm.className = 'msg' + (cls ? ' ' + cls : ''); };
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
use3d = !!lsGet('cb-3d');
const byId = (id) => plays.find((p) => p.id === id);
const norm = store.normFolder;
const parentOf = (f) => norm(f).split('/').slice(0, -1).join('/');
const baseName = (f) => norm(f).split('/').pop();

function playLink(id) {
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('play', id);
  return u.toString();
}
async function copyLink(play, msgEl) {
  const inRepo = repoIds.has(play.id);
  if (play._local && !inRepo) { say(msgEl, `“${play.name}” is only on this device. Publish it (☁ Publish) before sharing.`, 'err'); return; }
  const link = playLink(play.id);
  const note = play._local ? ' Your latest changes to it are not published yet: press ☁ Publish.' : '';
  try { await navigator.clipboard.writeText(link); say(msgEl, `Link copied: ${link}.${note}`, note ? 'err' : 'ok'); }
  catch { say(msgEl, `Copy this link: ${link}.${note}`, note ? 'err' : 'ok'); }
}

// ---------- Coach mode ----------
let coach = params.get('coach') === '1' || !!lsGet('cb-coach');
function setCoach(on) {
  coach = on;
  lsSet('cb-coach', on);
  document.body.classList.toggle('coach', on);
  $('btnCoach').textContent = on ? 'Exit coach mode' : 'Coach mode';
  if (!on) checked.clear();
  updatePubStatus();
  renderTree();
}
function updatePubStatus() {
  const s = store.getSettings();
  $('pubStatus').innerHTML = store.canPublish()
    ? `Saving commits to <b>${s.owner}/${s.repo}</b> (${s.branch}).`
    : 'Not connected: plays you save stay on this device. Add a GitHub token with ⚙ to publish.';
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
function showFree() {
  stopAnim(); view = null; currentId = null;
  setUrlPlay(null); setMode('free'); drawFree(); renderTree();
}

function setMode(m) {
  mode = m;
  $('freeBar').classList.toggle('hide', m !== 'free');
  $('playbar').classList.toggle('hide', m !== 'view');
  $('editor').classList.toggle('hide', m !== 'edit');
  svg.classList.toggle('locked', m === 'view');
  show3d(m === 'view' && use3d);
  const lock = m === 'edit' || (m === 'view' && view && view.returnToEdit);
  document.body.classList.toggle('tree-locked', lock);
  ['btnNew', 'btnEdit', 'btnDup', 'btnMove', 'btnDel'].forEach((id) => { $(id).disabled = lock; });
  updateToolbar();
  const p = currentId && byId(currentId);
  $('subtitle').textContent = p && m !== 'free' ? (p.folder ? `${p.folder.replace(/\//g, ' › ')} › ` : '') + p.name
    : '18 × 9 m court · 6 players a side · zones numbered as in volleyball';
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
  if (!returnToEdit) currentId = play.id;
  setMode('view');
  renderTree();
  if (!returnToEdit && window.matchMedia('(max-width: 900px)').matches) document.body.classList.add('nav-closed');
  $('btnCloseView').textContent = returnToEdit ? '← Back to editor' : '✕ Close';
  $('btnShare').classList.toggle('hide', !!returnToEdit);
  say($('shareMsg'), '');
  const dots = $('dots');
  dots.innerHTML = '';
  play.steps.forEach(() => dots.appendChild(document.createElement('span')));
  if (!returnToEdit) setUrlPlay(play.id);
  if (v3) v3.snapPlayers();
  drawView();
}
function closeView() {
  stopAnim();
  const back = view && view.returnToEdit;
  view = null;
  if (back) { setMode('edit'); drawEdit(); } else showFree();
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
    const st = play.steps[cursor];
    ballDraw = { x: s[0] + (f[0] - s[0]) * t, y: s[1] + (f[1] - s[1]) * t, lift: ballLift(t, st.arc, st.shot) };
  } else {
    const s = moving ? a : snaps[cursor];
    if (s.ball.holder) holder = s.ball.holder;
    else { ballDraw = { x: s.ball.point[0], y: s.ball.point[1], lift: 0 }; landing = s.ball.point; }
  }

  const arrows = [];
  const last = moving ? cursor : cursor - 1;
  for (let k = 0; k <= last && k < n; k++) arrows.push(...stepArrows(snaps[k], snaps[k + 1], play.steps[k].arc, k === last ? 1 : 0.3, play.steps[k].shot));

  render({ pos, serving: play.serving, holder, ballDraw, arrows, landing, showZones: showZones() });
  if (v3 && use3d) {
    const flying = moving && !sameBall(a.ball, b.ball);
    const st = play.steps[Math.min(cursor, n - 1)];
    // The next throw by whoever holds the ball (so a server or attacker can carry it one-handed)
    let next = null;
    const ni = moving ? cursor + 1 : cursor;
    if (holder && ni < n && !sameBall(snaps[ni].ball, snaps[ni + 1].ball)) next = { from: snaps[ni].ball, to: snaps[ni + 1].ball, shot: play.steps[ni].shot || 'normal' };
    v3.update({ pos, holder, step: cursor, next, flight: flying ? { from: a.ball, to: b.ball, t, arc: st.arc, shot: st.shot || 'normal' } : null, rest: landing });
  }

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

const sharePlay = () => view && copyLink(view.play, $('shareMsg'));

// ---------- Editor ----------
function openEditor(play) {
  edit = { draft: clone(play), dirty: false, editing: null, shot: 'normal' }; // editing: null = adding a step, -1 = start, i = step i
  $('edName').value = play.name || '';
  $('edFolder').value = play.folder || '';
  currentId = play.id || null;
  $('edCap').value = '';
  say($('edMsg'), '');
  resetPending();
  setMode('edit');
  renderTree();
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
  edit.shot = (i >= 0 && edit.draft.steps[i].shot) || 'normal';
  resetPending(); renderSteps(); drawEdit();
  say($('edMsg'), '');
}
function stopEditing() {
  edit.editing = null;
  edit.shot = 'normal';
  $('edCap').value = '';
  resetPending(); renderSteps(); drawEdit();
}
function stepFromPending() {
  const moves = {};
  for (const k of KEYS) if (dist(edit.base.pos[k], edit.pending.pos[k]) > 3) moves[k] = roundPt(edit.pending.pos[k]);
  const b = clone(edit.pending.ball);
  if (b.point) b.point = roundPt(b.point);
  const moved = !sameBall(edit.base.ball, edit.pending.ball);
  const shot = moved && edit.shot !== 'normal' ? edit.shot : undefined;
  const tm = shotTiming(edit.base, edit.pending, shot);
  return { cap: $('edCap').value.trim(), dur: tm.dur, arc: Math.round(tm.arc), moves, ball: moved ? b : null, ...(shot ? { shot } : {}) };
}
function addStep() {
  if (!pendingChanged()) return;
  edit.draft.steps.push(stepFromPending());
  $('edCap').value = '';
  edit.shot = 'normal';
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
  if (prevIdx >= 0) { const snaps = buildSnaps(d); arrows.push(...stepArrows(snaps[prevIdx], snaps[prevIdx + 1], d.steps[prevIdx].arc, 0.3, d.steps[prevIdx].shot)); }
  const ballMoved = !sameBall(edit.base.ball, edit.pending.ball);
  const tm = shotTiming(edit.base, edit.pending, ballMoved ? edit.shot : undefined);
  arrows.push(...stepArrows(edit.base, edit.pending, tm.arc, 1, ballMoved ? edit.shot : undefined));
  // Shot picker: only meaningful when the ball goes somewhere in this step
  $('shotRow').classList.toggle('disabled', !ballMoved || ei === -1);
  for (const b of $('shotSeg').children) b.classList.toggle('on', b.dataset.shot === edit.shot);
  $('shotHint').textContent = !ballMoved ? 'Move the ball in this step to pick a shot.' : (SHOTS[edit.shot].hint || '');
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
// ---------- Saving and publishing ----------
function upsert(p) {
  const i = plays.findIndex((x) => x.id === p.id);
  if (i >= 0) plays[i] = p; else plays.push(p);
}
const addFolderPath = (f) => { for (const a of store.ancestors(f)) folders.add(a); };

/** Save a play on this device, then publish it to the repo if a token is set. */
async function persistPlay(play, msgEl) {
  play.updated = new Date().toISOString();
  play.folder = norm(play.folder);
  addFolderPath(play.folder);
  const data = { ...store.clean(play), folder: play.folder };
  store.putLocal(data);
  upsert({ ...data, _local: true });
  renderTree();
  if (!store.canPublish()) {
    say(msgEl, 'Saved on this device. To publish it for everyone, add a GitHub token (⚙) and save again, or download the JSON and commit it.', 'ok');
    return true;
  }
  say(msgEl, 'Publishing to GitHub…');
  try {
    await store.publishPlay(data);
    store.removeLocal(data.id);
    repoIds.add(data.id);
    upsert(data);
    renderTree();
    say(msgEl, 'Published. The shared site updates in about a minute.', 'ok');
    return true;
  } catch (e) {
    say(msgEl, `Saved on this device, but publishing failed: ${e.message}`, 'err');
    return false;
  }
}

async function saveDraft() {
  const d = edit.draft, msg = $('edMsg');
  if (edit.editing !== null) { say(msg, 'Finish editing first: press “✓ Update” or “Cancel”.', 'err'); return; }
  d.name = $('edName').value.trim() || 'Untitled';
  d.folder = norm($('edFolder').value);
  if (!d.steps.length) { say(msg, 'Add at least one step first.', 'err'); return; }
  if (!d.id) d.id = store.newId(d.name);
  currentId = d.id;
  await persistPlay(d, msg);
  edit.dirty = false;
}

function downloadDraft() {
  const d = edit.draft;
  d.name = $('edName').value.trim() || 'Untitled';
  d.folder = norm($('edFolder').value);
  if (!d.id) d.id = store.newId(d.name);
  const blob = new Blob([JSON.stringify({ ...store.clean(d), folder: d.folder }, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${d.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say($('edMsg'), `Downloaded ${d.id}.json. Put it in plays/ and run “node scripts/build-index.mjs”.`, 'ok');
}

// ---------- Folder structure changes ----------

/** Persist the folder tree (one commit to plays/index.json). */
async function commitLayout(message, touchesRepo = true) {
  for (const p of plays) if (p._local) store.putLocal({ ...p, folder: norm(p.folder) });
  renderTree();
  const msg = $('listMsg');
  if (!touchesRepo) { say(msg, 'Saved on this device.', 'ok'); return; }
  if (!store.canPublish()) { say(msg, 'Changed here only. Add a GitHub token (⚙) to save the folder structure for everyone.', 'err'); return; }
  say(msg, 'Saving folders…');
  try {
    const folderOf = new Map(plays.filter((p) => repoIds.has(p.id)).map((p) => [p.id, norm(p.folder)]));
    await store.saveLayout(folders, folderOf, message);
    say(msg, 'Folders saved.', 'ok');
  } catch (e) { say(msg, `Couldn't save folders: ${e.message}`, 'err'); }
}

const inFolder = (f, root) => f === root || f.startsWith(root + '/');

function renamePrefix(src, dst) {
  const swap = (f) => (inFolder(f, src) ? dst + f.slice(src.length) : f);
  folders = new Set([...folders].map(swap));
  for (const p of plays) p.folder = swap(norm(p.folder));
  closed = new Set([...closed].map(swap));
  saveClosed();
}

async function movePlays(ids, folder) {
  folder = norm(folder);
  addFolderPath(folder);
  const list = ids.map(byId).filter(Boolean);
  for (const p of list) p.folder = folder;
  checked.clear();
  if (folder) { closed.delete(folder); saveClosed(); }
  await commitLayout(`Move ${list.length === 1 ? list[0].name : list.length + ' plays'} to ${folder || 'top level'}`, list.some((p) => repoIds.has(p.id)));
}

async function moveFolder(src, destParent) {
  const dst = destParent ? `${destParent}/${baseName(src)}` : baseName(src);
  if (dst === src) return;
  if (inFolder(destParent, src)) { say($('listMsg'), "A folder can't go inside itself.", 'err'); return; }
  if (folders.has(dst)) { say($('listMsg'), `There is already a folder “${dst}”.`, 'err'); return; }
  renamePrefix(src, dst);
  await commitLayout(`Move folder ${src} to ${destParent || 'top level'}`);
}

async function newFolder(parent) {
  const name = (prompt(parent ? `New folder inside “${parent}”:` : 'New folder name:') || '').replace(/\//g, '-').trim();
  if (!name) return;
  const path = parent ? `${parent}/${name}` : name;
  if (folders.has(path)) { say($('listMsg'), `“${path}” already exists.`, 'err'); return; }
  addFolderPath(path);
  if (parent) { closed.delete(parent); saveClosed(); }
  await commitLayout(`Add folder ${path}`);
}

async function renameFolder(path) {
  const name = (prompt('Rename folder:', baseName(path)) || '').replace(/\//g, '-').trim();
  if (!name || name === baseName(path)) return;
  const dst = parentOf(path) ? `${parentOf(path)}/${name}` : name;
  if (folders.has(dst)) { say($('listMsg'), `There is already a folder “${dst}”.`, 'err'); return; }
  renamePrefix(path, dst);
  await commitLayout(`Rename folder ${path} to ${dst}`);
}

async function deleteFolder(path) {
  const inside = plays.filter((p) => inFolder(norm(p.folder), path));
  const up = parentOf(path);
  if (inside.length && !confirm(`Delete folder “${baseName(path)}”? Its ${inside.length} play${inside.length > 1 ? 's' : ''} move to ${up ? `“${up}”` : 'the top level'}.`)) return;
  folders = new Set([...folders].filter((f) => !inFolder(f, path)));
  for (const p of inside) p.folder = up;
  await commitLayout(`Delete folder ${path}`);
}

// ---------- Navigation tree ----------
let closed = new Set(lsGet('cb-closed-folders') || []);   // folders the user collapsed
const saveClosed = () => lsSet('cb-closed-folders', [...closed]);
let dragging = null;                                       // { type: 'plays', ids } | { type: 'folder', path }

function buildTree() {
  const root = { path: '', kids: new Map(), plays: [] };
  const node = (path) => {
    let n = root, acc = '';
    for (const seg of norm(path).split('/').filter(Boolean)) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!n.kids.has(seg)) n.kids.set(seg, { path: acc, kids: new Map(), plays: [] });
      n = n.kids.get(seg);
    }
    return n;
  };
  for (const f of folders) node(f);
  for (const p of plays) node(p.folder).plays.push(p);
  return root;
}
const playsUnder = (n) => [...n.plays, ...[...n.kids.values()].flatMap(playsUnder)];

function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function nameWithMatch(text, q) {
  const span = mk('span', 'nm');
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) { span.textContent = text; return span; }
  span.append(text.slice(0, i), mk('mark', '', text.slice(i, i + q.length)), text.slice(i + q.length));
  return span;
}
function actionBtn(text, title, fn) {
  const b = mk('button', 'ta', text);
  b.title = title;
  b.onclick = (e) => { e.stopPropagation(); fn(); };
  return b;
}

function canDropOn(folder) {
  if (!dragging) return false;
  if (dragging.type === 'folder') return !inFolder(folder, dragging.path) && parentOf(dragging.path) !== folder;
  return true;
}
function makeDropTarget(el, folder) {
  el.addEventListener('dragover', (e) => { if (canDropOn(folder)) { e.preventDefault(); el.classList.add('dropok'); } });
  el.addEventListener('dragleave', () => el.classList.remove('dropok'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('dropok');
    const ok = canDropOn(folder), d = dragging;
    dragging = null;
    document.body.classList.remove('dragging');
    if (!ok) return;
    if (d.type === 'plays') await movePlays(d.ids, folder);
    else await moveFolder(d.path, folder);
  });
}
function makeDraggable(el, data) {
  if (!coach) return;
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    dragging = data();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'catchball');
    setTimeout(() => document.body.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => { dragging = null; document.body.classList.remove('dragging'); document.querySelectorAll('.dropok').forEach((x) => x.classList.remove('dropok')); });
}

function folderRow(n, open, q) {
  const all = playsUnder(n);
  const r = mk('div', 'tnode folder' + (open ? ' open' : ''));
  r.setAttribute('role', 'treeitem');
  r.setAttribute('aria-expanded', open);
  r.append(mk('span', 'tw', '▸'));
  if (coach) {
    const cb = mk('input');
    cb.type = 'checkbox';
    const n1 = all.filter((p) => checked.has(p.id)).length;
    cb.checked = all.length > 0 && n1 === all.length;
    cb.indeterminate = n1 > 0 && n1 < all.length;
    cb.disabled = !all.length;
    cb.title = 'Check every play in this folder';
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => { for (const p of all) { if (cb.checked) checked.add(p.id); else checked.delete(p.id); } renderTree(); };
    r.append(cb);
  }
  r.append(mk('span', 'ic', open ? '📂' : '📁'), nameWithMatch(baseName(n.path), q), mk('span', 'ct', String(all.length)));
  if (coach) {
    r.append(actionBtn('+', 'New subfolder', () => newFolder(n.path)), actionBtn('✎', 'Rename folder', () => renameFolder(n.path)), actionBtn('✕', 'Delete folder', () => deleteFolder(n.path)));
  }
  r.onclick = () => { if (closed.has(n.path)) closed.delete(n.path); else closed.add(n.path); saveClosed(); renderTree(); };
  makeDraggable(r, () => ({ type: 'folder', path: n.path }));
  if (coach) makeDropTarget(r, n.path);
  return r;
}

function playRow(p, q) {
  const r = mk('div', 'tnode play' + (p.id === currentId && mode !== 'free' ? ' current' : ''));
  r.setAttribute('role', 'treeitem');
  r.append(mk('span', 'tw', ''));
  if (coach) {
    const cb = mk('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(p.id);
    cb.title = 'Select for Move or Delete';
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => { if (cb.checked) checked.add(p.id); else checked.delete(p.id); renderTree(); };
    r.append(cb);
  }
  r.append(mk('span', 'ic', '▷'), nameWithMatch(p.name, q));
  if (p._local) { const l = mk('span', 'loc', 'local'); l.title = 'Only saved on this device'; r.append(l); }
  r.append(actionBtn('🔗', 'Copy a link to this play', () => copyLink(p, $('listMsg'))));
  r.onclick = () => openView(p, false);
  makeDraggable(r, () => ({ type: 'plays', ids: checked.has(p.id) ? [...checked] : [p.id] }));
  return r;
}

function renderTree() {
  const tree = $('tree');
  tree.innerHTML = '';
  const q = $('search').value.trim().toLowerCase();
  const match = (p) => !q || p.name.toLowerCase().includes(q) || norm(p.folder).toLowerCase().includes(q);

  const fb = mk('div', 'tnode pinned' + (mode === 'free' ? ' current' : ''));
  fb.append(mk('span', 'tw', ''), mk('span', 'ic', '📌'), mk('span', 'nm', 'Free board'));
  fb.onclick = showFree;
  tree.append(fb, mk('div', 'tsep'));

  // Folders that contain the open play stay open.
  const cur = currentId && byId(currentId);
  const forcedOpen = new Set(cur ? store.ancestors(cur.folder) : []);

  let shown = 0;
  function renderNode(n, box) {
    for (const k of [...n.kids.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const hits = playsUnder(k).filter(match);
      if (q && !hits.length && !baseName(k.path).toLowerCase().includes(q)) continue;
      const open = !!q || forcedOpen.has(k.path) || !closed.has(k.path);
      box.append(folderRow(k, open, q));
      const kids = mk('div', 'tkids' + (open ? '' : ' closed'));
      kids.setAttribute('role', 'group');
      box.append(kids);
      renderNode(k, kids);
    }
    for (const p of n.plays.filter(match)) { box.append(playRow(p, q)); shown++; }
  }
  renderNode(buildTree(), tree);

  if (!shown) tree.append(mk('div', 'tempty', q ? 'No plays match.' : 'No plays yet.'));
  if (coach) {
    const top = mk('div', 'tnode tdrop', '⤒ Drop here to move to the top level');
    makeDropTarget(top, '');
    tree.append(top);
  }
  updateToolbar();
  const dl = $('folderList');
  dl.innerHTML = '';
  for (const f of [...folders].sort()) dl.append(new Option(f));
}

// ---------- Coach toolbar ----------
const openPlay = () => (mode === 'view' && view && !view.returnToEdit ? view.play : null);
const targets = () => (checked.size ? [...checked].map(byId).filter(Boolean) : (openPlay() ? [openPlay()] : []));

function updateToolbar() {
  if (!$('selInfo')) return;
  const info = $('selInfo');
  info.innerHTML = '';
  if (checked.size) {
    info.append(`${checked.size} checked · `);
    const a = mk('a', '', 'clear');
    a.onclick = () => { checked.clear(); renderTree(); };
    info.append(a);
  } else if (openPlay()) info.textContent = `Open: ${openPlay().name}`;
  else info.textContent = 'Click a play to open it, or tick plays to move or delete them.';
  const lock = document.body.classList.contains('tree-locked');
  $('btnEdit').disabled = lock || !openPlay();
  $('btnDup').disabled = lock || !openPlay();
  $('btnMove').disabled = lock || !targets().length;
  $('btnDel').disabled = lock || !targets().length;
  const locals = plays.filter((p) => p._local).length;
  $('btnPublish').classList.toggle('hide', !locals);
  $('btnPublish').disabled = lock;
  $('btnPublish').textContent = `☁ Publish ${locals} local play${locals === 1 ? '' : 's'}`;
}

$('btnEdit').onclick = () => { const p = openPlay(); if (p) { stopAnim(); view = null; openEditor(p); } };
$('btnNew').onclick = () => {
  stopAnim(); view = null;
  setMode('free');
  const folder = (openPlay() && openPlay().folder) || '';
  openEditor({ id: null, name: '', folder, serving: free.serving, intro: '', start: { pos: clone(free.pos), ball: clone(free.ball) }, steps: [] });
};
$('btnFolder').onclick = () => newFolder('');
$('btnPublish').onclick = async () => {
  const list = plays.filter((p) => p._local);
  const msg = $('listMsg');
  if (!list.length) return;
  if (!store.canPublish()) { say(msg, 'Add a GitHub token first (⚙).', 'err'); return; }
  say(msg, `Publishing ${list.length} play${list.length === 1 ? '' : 's'}…`);
  try {
    const clean = list.map((p) => { const q = { ...p }; delete q._local; return q; });
    await store.publishPlays(clean);
    for (const p of clean) { store.removeLocal(p.id); repoIds.add(p.id); upsert(p); }
    if (view && !view.returnToEdit) view.play = byId(view.play.id) || view.play;
    renderTree();
    say(msg, 'Published. The shared site updates in about a minute.', 'ok');
  } catch (e) { say(msg, `Publishing failed: ${e.message}`, 'err'); }
};
$('btnDup').onclick = async () => {
  const p = openPlay();
  if (!p) return;
  const copy = clone(p);
  delete copy._local;
  copy.name = p.name + ' (copy)';
  copy.id = store.newId(copy.name);
  await persistPlay(copy, $('listMsg'));
  openView(byId(copy.id), false);
};
$('btnMove').onclick = () => {
  const list = targets();
  if (!list.length) return;
  $('moveWhat').textContent = list.length === 1 ? `“${list[0].name}”` : `${list.length} plays`;
  const same = new Set(list.map((p) => norm(p.folder)));
  $('moveFolder').value = same.size === 1 ? [...same][0] : '';
  say($('moveMsg'), '');
  $('moveDlg').showModal();
  $('moveFolder').focus();
};
$('moveCancel').onclick = () => $('moveDlg').close();
$('moveOk').onclick = async () => {
  const ids = targets().map((p) => p.id);
  $('moveDlg').close();
  await movePlays(ids, $('moveFolder').value);
};
let delArmed = 0;
$('btnDel').onclick = async () => {
  const list = targets();
  if (!list.length) return;
  const btn = $('btnDel'), msg = $('listMsg');
  if (Date.now() - delArmed > 3000) {
    delArmed = Date.now();
    btn.textContent = list.length > 1 ? `Delete ${list.length}?` : 'Really delete?';
    setTimeout(() => { btn.textContent = 'Delete'; }, 3000);
    return;
  }
  delArmed = 0; btn.textContent = 'Delete';
  const inRepo = list.filter((p) => repoIds.has(p.id));
  if (inRepo.length && !store.canPublish()) { say(msg, 'These plays are in the repo. Add a GitHub token (⚙) to delete them.', 'err'); return; }
  try {
    if (inRepo.length) { say(msg, 'Deleting from the repo…'); await store.unpublishPlays(inRepo); }
    const ids = new Set(list.map((p) => p.id));
    for (const id of ids) { store.removeLocal(id); repoIds.delete(id); checked.delete(id); }
    plays = plays.filter((x) => !ids.has(x.id));
    if (currentId && ids.has(currentId)) showFree(); else renderTree();
    say(msg, list.length > 1 ? `Deleted ${list.length} plays.` : `Deleted “${list[0].name}”.`, 'ok');
  } catch (e) { say(msg, `Could not delete: ${e.message}`, 'err'); }
};

// ---------- Dragging and tapping on the court ----------
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

// ---------- Playback buttons ----------
$('btnPlay').onclick = () => { if (!view) return; if (view.playing) { stopAnim(); drawView(); } else startAnim(false); };
$('btnNext').onclick = () => {
  if (!view) return;
  if (view.playing) { stopAnim(); view.t = 0; view.cursor = Math.min(view.cursor + 1, view.play.steps.length); drawView(); }
  else startAnim(true);
};
$('btnPrev').onclick = () => { if (!view) return; stopAnim(); if (view.t > 0) view.t = 0; else view.cursor = Math.max(0, view.cursor - 1); if (v3) v3.snapPlayers(); drawView(); };
$('btnReplay').onclick = () => { if (!view) return; stopAnim(); view.cursor = 0; view.t = 0; if (v3) v3.snapPlayers(); drawView(); startAnim(false); };

// ---------- 3D ----------
async function load3d() {
  if (v3) return v3;
  $('load3d').classList.remove('hide');
  try {
    // Same ?v= as this file, so a new release never mixes old and new code.
    const mod = await import(new URL('./view3d.js' + new URL(import.meta.url).search, import.meta.url));
    v3 = mod.create($('stage3d'));
    v3.setCamera($('cam3d').value);
  } catch (e) {
    $('load3d').textContent = `Couldn't load 3D: ${e.message}`;
    throw e;
  }
  $('load3d').classList.add('hide');
  return v3;
}
function show3d(on) {
  $('stage3d').classList.toggle('hide', !on);
  svg.classList.toggle('hide', on);
  $('cam3d').classList.toggle('hide', !on);
  $('btnFull').classList.toggle('hide', !on);
  $('btn3d').classList.toggle('on', on);
  $('btn3d').textContent = on ? '▦ 2D' : '🧊 3D';
  $('btn3d').title = on ? 'Back to the 2D board' : 'Watch this play in 3D';
  if (!on) { if (v3) v3.stop(); return; }
  load3d().then((v) => { v.snapPlayers(); v.start(); if (view) drawView(); }).catch(() => {});
}
$('btn3d').onclick = () => { use3d = !use3d; lsSet('cb-3d', use3d); show3d(mode === 'view' && use3d); };
$('cam3d').onchange = () => { if (v3) v3.setCamera($('cam3d').value); lsSet('cb-cam', $('cam3d').value); };
$('btnFull').onclick = () => { const st = $('stage3d'); if (document.fullscreenElement) document.exitFullscreen(); else if (st.requestFullscreen) st.requestFullscreen().catch(() => {}); };
{ const c = lsGet('cb-cam'); if (c && [...$('cam3d').options].some((o) => o.value === c)) $('cam3d').value = c; }
$('btnShare').onclick = sharePlay;
$('btnCloseView').onclick = closeView;

// ---------- Editor buttons ----------
const addOrUpdate = () => (edit.editing === null ? addStep() : updateStep());
for (const b of $('shotSeg').children) b.onclick = () => { edit.shot = b.dataset.shot; drawEdit(); };
$('edAdd').onclick = addOrUpdate;
$('edCap').addEventListener('keydown', (e) => { if (e.key === 'Enter') addOrUpdate(); });
$('edUndo').onclick = () => { if (edit.editing !== null) stopEditing(); else { resetPending(); drawEdit(); } };
$('edName').oninput = () => { edit.dirty = true; };
$('edFolder').oninput = () => { edit.dirty = true; };
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
  const saved = edit.draft.id && byId(edit.draft.id);
  edit = null;
  if (saved) openView(saved, false); else showFree();
};

// ---------- Free board buttons ----------
$('serveA').onclick = () => { free.serving = 'A'; freeSnap(); drawFree(); };
$('serveB').onclick = () => { free.serving = 'B'; freeSnap(); drawFree(); };
$('rotA').onclick = () => { rotate('A'); drawFree(); };
$('rotB').onclick = () => { rotate('B'); drawFree(); };
$('receive').onchange = (e) => { free.receive = e.target.checked; freeSnap(); drawFree(); };
$('reset').onclick = () => { free.serving = 'A'; free.zones = startZones(); freeSnap(); drawFree(); };
$('showZones').onchange = () => (mode === 'view' ? drawView() : redraw());
$('search').oninput = renderTree;
$('btnNav').onclick = () => document.body.classList.toggle('nav-closed');

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
async function init() {
  try {
    const repo = await store.loadRepo();
    plays = repo.plays;
    folders = new Set(repo.folders);
  } catch (e) { say($('listMsg'), `Couldn't load plays from the site (${e.message}).`, 'err'); }
  repoIds = new Set(plays.map((p) => p.id));
  for (const d of store.getLocal()) upsert({ ...d, folder: norm(d.folder), _local: true });
  for (const p of plays) addFolderPath(p.folder);

  setCoach(coach);
  freeSnap();
  const wanted = params.get('play');
  const p = wanted ? byId(wanted) : null;
  if (wanted && !p) say($('listMsg'), 'That play link was not found. It may have been deleted.', 'err');
  if (p) openView(p, false); else showFree();
}
// Test hook: jump to an exact moment of the open play (used by automated screenshots).
window.cbSeek = (cursor, t) => { if (!view) return; stopAnim(); view.cursor = cursor; view.t = t; drawView(); };
window.cbBall = () => (v3 ? v3.ballPosition() : null);
window.cbBody = (k) => (v3 ? v3.bodyHeights(k) : null);
init();
