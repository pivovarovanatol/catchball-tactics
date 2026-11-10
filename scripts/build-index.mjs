#!/usr/bin/env node
// Rebuilds plays/index.json from the play files in plays/.
// Run it after adding or editing play JSON files by hand:  node scripts/build-index.mjs
// (Plays saved from the site in coach mode update the index automatically.)
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plays');
const indexPath = path.join(dir, 'index.json');

let previous = { plays: [] };
try { previous = JSON.parse(await readFile(indexPath, 'utf8')); } catch { /* no index yet */ }
const order = new Map(previous.plays.map((e, i) => [e.id, i]));

const entries = [];
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
  const play = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
  if (!play.id || !play.name || !play.start || !Array.isArray(play.steps)) {
    console.warn(`Skipping ${file}: not a play file`);
    continue;
  }
  if (`${play.id}.json` !== file) console.warn(`Note: ${file} has id "${play.id}"; share links use the id.`);
  entries.push({ id: play.id, name: play.name, file, updated: play.updated || null });
}
// Keep the existing order; new plays go to the end.
entries.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || a.name.localeCompare(b.name));

await writeFile(indexPath, JSON.stringify({ plays: entries }, null, 2) + '\n');
console.log(`plays/index.json: ${entries.length} plays`);
