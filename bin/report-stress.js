'use strict';

/* Report-path stress test: replays the API v1 request pattern the reports
 * client (lib/report/reportclient.js) generates — 7-day chunk prefetches of
 * entries/treatments/devicestatus, profile lookups, food — continuously with
 * 2 concurrent workers (matching PREFETCH_CONCURRENCY), while sampling
 * /api/v1/memory to a CSV.
 *
 * Usage:
 *   bun bin/report-stress.js [--url http://localhost:1337] [--secret <API_SECRET>]
 *                            [--days 30] [--csv report-stress.csv]
 *
 * Watch for: rssMB/objectCount/timers trends while requests hammer the
 * buffered toArray -> JSON.stringify -> gzip pipeline.
 */

const fs = require('fs');
const crypto = require('crypto');

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE_URL = arg('url', 'http://localhost:1337');
const API_SECRET = arg('secret', process.env.API_SECRET || '');
const DATA_DAYS = parseInt(arg('days', '30'), 10);
const CSV_FILE = arg('csv', 'report-stress.csv');

if (!API_SECRET) {
  console.error('Provide --secret <API_SECRET> (or set API_SECRET env var)');
  process.exit(1);
}

const headers = { 'api-secret': crypto.createHash('sha1').update(API_SECRET).digest('hex') };

let requests = 0;
let bytes = 0;
let errors = 0;

async function get (path) {
  try {
    const res = await fetch(BASE_URL + path, { headers: headers });
    const text = await res.text();
    requests++;
    bytes += text.length;
    if (res.status >= 400) {
      errors++;
      console.error('GET ' + path.slice(0, 90) + ' -> ' + res.status);
    }
    return text;
  } catch (e) {
    errors++;
    console.error('GET failed: ' + e.message);
    return '';
  }
}

function randomWindow () {
  // random 7-day chunk inside the seeded range, like the prefetch does
  const now = Date.now();
  const maxStart = DATA_DAYS - 7;
  const startDaysAgo = 7 + Math.floor(Math.random() * maxStart);
  const from = now - startDaysAgo * 86400000;
  const to = from + 7 * 86400000;
  return { from: from, to: to };
}

// One iteration ~= one report view over a 7-day chunk
async function reportView (worker) {
  const w = randomWindow();
  const fromISO = new Date(w.from).toISOString();
  const toISO = new Date(w.to).toISOString();

  await get('/api/v1/entries.json?find[date][$gte]=' + w.from + '&find[date][$lt]=' + w.to + '&count=20000');
  await get('/api/v1/treatments.json?find[created_at][$gte]=' + fromISO + '&find[created_at][$lt]=' + toISO + '&count=5000');
  // daytoday / loopalyzer path — the fattest response
  await get('/api/v1/devicestatus.json?find[created_at][$gte]=' + fromISO + '&find[created_at][$lt]=' + toISO + '&count=20000');
  await get('/api/v1/profiles?find[startDate][$lte]=' + toISO + '&count=1000');
  await get('/api/v1/food/regular.json');

  // every few views: calibration entries + a type-only query, which exercises
  // the in-memory cache shortcut (double cloneDeep per request)
  if (worker === 0 && Math.random() < 0.3) {
    await get('/api/v1/entries.json?find[type]=cal&find[date][$gte]=' + w.from + '&count=1000');
    await get('/api/v1/entries.json?find[type]=sgv&count=1000');
  }
}

async function worker (id) {
  for (;;) {
    try {
      await reportView(id);
    } catch (e) {
      errors++;
      console.error('worker error: ' + e.message);
    }
  }
}

async function sampleMemory () {
  try {
    const res = await fetch(BASE_URL + '/api/v1/memory?gc=true', { headers: headers });
    const body = await res.json();
    const m = body.message || body;
    const row = [
      m.ts, requests, Math.round(bytes / 1048576), errors, m.rssMB, m.heapUsedMB
      , m.jsc ? m.jsc.objectCount : '', m.jsc ? m.jsc.timers : '', m.jsc ? m.jsc.heapSizeMB : ''
      , m.dataLoads
    ].join(',');
    fs.appendFileSync(CSV_FILE, row + '\n');
    console.log('SAMPLE requests=' + requests + ' fetchedMB=' + Math.round(bytes / 1048576) +
      ' errors=' + errors + ' rss=' + m.rssMB + 'MB' +
      (m.jsc ? ' objects=' + m.jsc.objectCount + ' timers=' + m.jsc.timers : ''));
  } catch (e) {
    console.error('memory sample failed: ' + e.message);
  }
}

fs.writeFileSync(CSV_FILE, 'ts,requests,fetchedMB,errors,rssMB,heapUsedMB,objectCount,timers,jscHeapMB,dataLoads\n');
console.log('Stressing report endpoints on ' + BASE_URL + ' with 2 workers (Ctrl+C to stop)');

sampleMemory().then(function () {
  worker(0);
  worker(1);
  setInterval(sampleMemory, 30000);
});
