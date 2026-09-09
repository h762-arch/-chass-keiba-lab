import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const WORKER_ORIGIN = 'https://chass-keiba-lab7.h7625421.workers.dev';
const date = String(process.env.SNAPSHOT_DATE || '').trim();
const slug = String(process.env.TRACK_SLUG || '').trim().toLowerCase();

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error('SNAPSHOT_DATE must use YYYY-MM-DD.');
}
if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
  throw new Error('TRACK_SLUG must be an ASCII slug.');
}

const sourceUrl = `${WORKER_ORIGIN}/api/chass/v1/public/ai-snapshot/${date}/${slug}.json`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15_000);

let response;
try {
  response = await fetch(sourceUrl, {
    headers: { accept: 'application/json' },
    signal: controller.signal,
  });
} finally {
  clearTimeout(timer);
}

if (!response.ok) {
  throw new Error(`Snapshot fetch failed: HTTP ${response.status}`);
}

const contentType = response.headers.get('content-type') || '';
if (!contentType.toLowerCase().includes('application/json')) {
  throw new Error(`Unexpected Content-Type: ${contentType || '(missing)'}`);
}

const payload = await response.json();
if (payload?.ok !== true) throw new Error('Snapshot payload is not ok.');
if (payload?.apiVersion !== 'ability-compact-v1') throw new Error('Unexpected apiVersion.');
if (payload?.evaluationMode !== 'ability-only') throw new Error('Unexpected evaluationMode.');
if (payload?.marketEvaluation !== 'external') throw new Error('Unexpected marketEvaluation.');
if (payload?.date !== date) throw new Error('Snapshot date mismatch.');
if (!Array.isArray(payload?.races)) throw new Error('races must be an array.');
if (payload.raceCount !== payload.races.length) throw new Error('raceCount mismatch.');

const totalHorseCount = payload.races.reduce((sum, race) => {
  if (!Array.isArray(race?.horses)) throw new Error('Every race must contain horses[].');
  if (race.horseCount !== race.horses.length) throw new Error(`horseCount mismatch in race ${race.raceNumber}.`);
  return sum + race.horses.length;
}, 0);
if (payload.totalHorseCount !== totalHorseCount) throw new Error('totalHorseCount mismatch.');

const json = `${JSON.stringify(payload)}\n`;
const bytes = Buffer.byteLength(json, 'utf8');
if (bytes > 100_000) throw new Error(`Snapshot exceeds 100KB safety limit: ${bytes} bytes.`);

const outputDir = path.join('docs', 'ai-snapshot', date);
const outputPath = path.join(outputDir, `${slug}.json`);
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, json, 'utf8');
console.log(JSON.stringify({ sourceUrl, outputPath, bytes, raceCount: payload.raceCount, totalHorseCount }));
