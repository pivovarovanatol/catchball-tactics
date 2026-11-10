// Where plays live:
//   1. In the repo: plays/<id>.json, listed in plays/index.json. Everyone reads these.
//   2. On this device: drafts in localStorage (plays not yet published to the repo).
// Coaches publish to the repo through the GitHub API with their own token (see Settings).

const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- Settings ----------

function guessRepo() {
  const h = location.hostname;
  if (h.endsWith('.github.io')) {
    const owner = h.split('.')[0];
    const first = location.pathname.split('/').filter(Boolean)[0];
    return { owner, repo: first || `${owner}.github.io` };
  }
  return {};
}

export function getSettings() {
  const s = LS.get('cb-settings') || {};
  const g = guessRepo();
  return {
    owner: s.owner || g.owner || '',
    repo: s.repo || g.repo || '',
    branch: s.branch || 'main',
    token: s.token || '',
  };
}
export function saveSettings(s) { LS.set('cb-settings', s); }
export const canPublish = () => { const s = getSettings(); return !!(s.owner && s.repo && s.token); };

// ---------- Reading plays from the site ----------

export async function loadRepoPlays() {
  const r = await fetch('plays/index.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`plays/index.json: ${r.status}`);
  const idx = await r.json();
  const plays = await Promise.all((idx.plays || []).map(async (e) => {
    try {
      const pr = await fetch(`plays/${e.file}`, { cache: 'no-cache' });
      return pr.ok ? await pr.json() : null;
    } catch { return null; }
  }));
  return plays.filter(Boolean);
}

// ---------- Local drafts ----------

export const getLocal = () => LS.get('cb-local-plays') || [];
export function putLocal(play) {
  const list = getLocal().filter((p) => p.id !== play.id);
  list.push(clean(play));
  LS.set('cb-local-plays', list);
}
export function removeLocal(id) { LS.set('cb-local-plays', getLocal().filter((p) => p.id !== id)); }

// ---------- File format ----------

const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Math.round(v) : v);
function roundPositions(obj) {
  const out = {};
  for (const k in obj) out[k] = round(obj[k]);
  return out;
}

/** The exact shape written to plays/<id>.json (see docs/PLAY_FORMAT.md). */
export function clean(play) {
  return {
    format: 1,
    id: play.id,
    name: play.name,
    serving: play.serving,
    intro: play.intro || '',
    updated: play.updated || new Date().toISOString(),
    start: { pos: roundPositions(play.start.pos), ball: play.start.ball.point ? { point: round(play.start.ball.point) } : { holder: play.start.ball.holder } },
    steps: play.steps.map((s) => ({
      cap: s.cap || '',
      dur: s.dur,
      arc: Math.round(s.arc || 0),
      moves: roundPositions(s.moves || {}),
      ball: s.ball ? (s.ball.point ? { point: round(s.ball.point) } : { holder: s.ball.holder }) : null,
    })),
  };
}

export function newId(name) {
  const slug = (name || 'play').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'play';
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- GitHub API ----------

const b64 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

async function gh(path, opts = {}) {
  const s = getSettings();
  const r = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${s.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).message || msg; } catch { /* not JSON */ }
    const err = new Error(`GitHub ${r.status}: ${msg}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

async function getFile(path) {
  try {
    return await gh(`/contents/${path}?ref=${encodeURIComponent(getSettings().branch)}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function putFile(path, text, message, sha) {
  return gh(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64(text), branch: getSettings().branch, ...(sha ? { sha } : {}) }),
  });
}

async function updateIndex(mutate, message) {
  const cur = await getFile('plays/index.json');
  const idx = cur ? JSON.parse(unb64(cur.content)) : { plays: [] };
  idx.plays = idx.plays || [];
  mutate(idx);
  await putFile('plays/index.json', JSON.stringify(idx, null, 2) + '\n', message, cur && cur.sha);
}

/** Checks the token and returns { ok, push, fullName }. */
export async function testConnection() {
  const r = await gh('');
  return { ok: true, push: !!(r.permissions && r.permissions.push), fullName: r.full_name };
}

/** Commit plays/<id>.json and add/update its entry in plays/index.json. */
export async function publishPlay(play) {
  const data = clean(play);
  const path = `plays/${data.id}.json`;
  const cur = await getFile(path);
  await putFile(path, JSON.stringify(data, null, 2) + '\n', `${cur ? 'Update' : 'Add'} play: ${data.name}`, cur && cur.sha);
  await updateIndex((idx) => {
    const entry = { id: data.id, name: data.name, file: `${data.id}.json`, updated: data.updated };
    const i = idx.plays.findIndex((e) => e.id === data.id);
    if (i >= 0) idx.plays[i] = entry; else idx.plays.push(entry);
  }, `Index: ${data.name}`);
}

/** Delete plays/<id>.json and its index entry. */
export async function unpublishPlay(play) {
  const path = `plays/${play.id}.json`;
  const cur = await getFile(path);
  if (cur) {
    await gh(`/contents/${path}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: `Delete play: ${play.name}`, sha: cur.sha, branch: getSettings().branch }),
    });
  }
  await updateIndex((idx) => { idx.plays = idx.plays.filter((e) => e.id !== play.id); }, `Index: remove ${play.name}`);
}
