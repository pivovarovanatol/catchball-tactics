# catchball-tactics

An animated tactics board for **catchball**: the volleyball-style game where you catch and throw instead of hitting the ball.
Coaches record set plays step by step. Players open a link and watch the play animate, or step through it forward and back.

**Live site:** https://pivovarovanatol.github.io/catchball-tactics/ (after GitHub Pages is turned on; see below)

## What it does

- **Browse plays** in the sidebar: a folder tree with search. Click a play to open it.
- **Watch plays.** Press ▶ Play, or use ⏮ ⏭ to go one step at a time. Blue arrows show where players run, the dashed line shows the ball.
- **Share a play.** The 🔗 next to a play (or 🔗 Share under the court) copies a direct link such as
  `…/catchball-tactics/?play=switch-3-and-4-attack-by-3`. The link opens straight into that play.
- **Free board** (📌 at the top of the list). Drag players around, choose the serving team, and rotate either team.
- **Coach mode** (button at the top right): create, edit, copy and delete plays.
  - **Organize the tree:** **+ Folder** creates a folder; hover a folder for **+** (subfolder), **✎** (rename) and **✕** (delete; its plays move up a level).
    Drag plays or whole folders onto a folder to move them, or onto *“Drop here to move to the top level”*.
    Tick checkboxes to select several plays (ticking a folder selects everything in it), then **📁 Move** or **Delete**.
  - **+ Play** records a play starting from whatever is on the free board. The editor has a *Folder* field too.
  - In each step, drag the players who run, then tap a player to throw them the ball or tap the floor where it lands. Press **+ Add step**.
  - ✎ next to a step changes it later. **0. Starting lineup** changes where the play starts.
  - **Save** publishes the play to this repo (see *Publishing* below).

## How plays are stored

Every play is one JSON file in [`plays/`](plays/). [`plays/index.json`](plays/index.json) holds the navigation: the folder list
and, for each play, its folder. Moving or renaming folders only changes `index.json` (one commit), never the play files.
The format is described in [docs/PLAY_FORMAT.md](docs/PLAY_FORMAT.md).

```
catchball-tactics/
├── index.html              # the app (static, no build step)
├── css/style.css
├── js/
│   ├── core.js             # court geometry, play model helpers, drawing
│   ├── store.js            # loading plays, local drafts, GitHub publishing
│   └── app.js              # UI: list, playback, free board, editor, settings
├── plays/
│   ├── index.json          # folders + list of plays and the folder each one is in
│   └── <play-id>.json      # one file per play; the id is also the share link
├── scripts/build-index.mjs # rebuilds plays/index.json from the files
└── docs/PLAY_FORMAT.md
```

## Access

| Who | What they can do | What they need |
|---|---|---|
| Anyone with the link | Watch every play, step through, share links | Nothing. The site is public. |
| Coach (you) | Create, edit, copy, delete, publish plays | A GitHub token with write access to this repo, entered once per browser |
| Collaborator | Same as coach | Added as a collaborator on the repo, plus their own token |

The site never stores a token in the repo. It stays in the browser's local storage on the coach's device only.
Without a token, coach mode still works: plays are saved **on that device** (marked “• on this device”). You can then
download the JSON (⬇ JSON) and commit it by hand.

## Publishing (one-time setup)

1. **Turn on GitHub Pages:** repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
   About a minute later the site is at `https://pivovarovanatol.github.io/catchball-tactics/`.
2. **Create a token:** [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Repository access: **Only select repositories → catchball-tactics**
   - Permissions → Repository permissions → **Contents: Read and write**
   - Pick an expiry you're comfortable with (you can always make a new one).
3. On the site: **Coach mode → ⚙ GitHub settings**. Owner `pivovarovanatol`, repository `catchball-tactics`, branch `main`, paste the token, press **Test**, then **Save**.

From then on, **Save** in the editor commits `plays/<id>.json` and updates `plays/index.json`. GitHub Pages redeploys
within a minute or two, and the play is then visible to everyone.

## Adding plays by hand

Put the JSON file in `plays/` and run:

```sh
node scripts/build-index.mjs
```

## Running locally

The app loads plays with `fetch`, so open it through a local web server rather than as a file:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Court and numbering

- 18 × 9 m court, net in the middle, attack lines 3 m from the net. Blue plays on the left, Red on the right.
- Zones as in volleyball: front row 4 · 3 · 2, back row 5 · 6 · 1. The player in zone 1 serves.
- Each player is numbered by the zone they start in and keeps that number when the team rotates (clockwise).
