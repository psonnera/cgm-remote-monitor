'use strict';

/* Memory-leak soak test: simulates a continuously uploading AAPS instance
 * against a local Nightscout and samples /api/v1/memory along the way.
 *
 * Usage:
 *   bun bin/soak-test.js [--url http://localhost:1337] [--secret <API_SECRET>]
 *                        [--interval 3] [--sample-every 20] [--csv soak.csv]
 *
 * Every <interval> seconds it POSTs an sgv entry and a realistic (fat)
 * devicestatus via API v3, plus an occasional treatment. Every
 * <sample-every> uploads it calls GET /api/v1/memory?gc=true and appends
 * the snapshot to the CSV.
 *
 * What to look for:
 *   - pre-fix leak signature: dataLoads tracks uploads 1:1, and jsc
 *     objectCount / timers climb monotonically even after gc.
 *   - post-fix: dataLoads ~= elapsed/5s, objectCount sawtooths around a
 *     flat baseline, timers constant, rssMB plateaus.
 */

const fs = require('fs');
const crypto = require('crypto');

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE_URL = arg('url', 'http://localhost:1337');
const API_SECRET = arg('secret', process.env.API_SECRET || '');
const INTERVAL_SECS = parseInt(arg('interval', '3'), 10);
const SAMPLE_EVERY = parseInt(arg('sample-every', '20'), 10);
const CSV_FILE = arg('csv', 'soak.csv');
// Backdating pushes docs outside the server cache's retention window so the
// in-memory cache stays constant-size while upload/reload churn continues —
// separates "RSS tracks cache size" from "RSS leaks per operation".
const BACKDATE_MS = parseInt(arg('backdate-days', '0'), 10) * 86400000;

function docTime () {
  return Date.now() - BACKDATE_MS;
}

if (!API_SECRET) {
  console.error('Provide --secret <API_SECRET> (or set API_SECRET env var)');
  process.exit(1);
}

const secretHash = crypto.createHash('sha1').update(API_SECRET).digest('hex');

// Admin (api-secret) headers: used for /api/v1/memory sampling and for
// bootstrapping the API v3 subject below.
const headers = {
  'Content-Type': 'application/json'
  , 'api-secret': secretHash
};

// API v3 only accepts Authorization: Bearer <JWT>, obtained from an
// access-token subject — same flow AAPS uses.
const SUBJECT_NAME = 'soak-uploader';
let jwt = null;
let jwtExp = 0;

async function fetchJSON (path, opts) {
  const res = await fetch(BASE_URL + path, opts);
  if (res.status >= 400) {
    throw new Error(path + ' -> HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
  return res.json();
}

async function ensureJwt () {
  if (jwt && Date.now() / 1000 < jwtExp - 120) return jwt;

  let subjects = await fetchJSON('/api/v2/authorization/subjects', { headers: headers });
  let subject = subjects.find(function (s) { return s.name === SUBJECT_NAME; });
  if (!subject) {
    await fetchJSON('/api/v2/authorization/subjects', {
      method: 'POST'
      , headers: headers
      , body: JSON.stringify({ name: SUBJECT_NAME, roles: ['admin'], notes: 'soak-test' })
    });
    subjects = await fetchJSON('/api/v2/authorization/subjects', { headers: headers });
    subject = subjects.find(function (s) { return s.name === SUBJECT_NAME; });
  }
  if (!subject || !subject.accessToken) {
    throw new Error('could not create/find soak-test subject');
  }

  const auth = await fetchJSON('/api/v2/authorization/request/' + subject.accessToken, { headers: headers });
  jwt = auth.token;
  jwtExp = auth.exp || (Date.now() / 1000 + 600);
  console.log('JWT acquired for subject ' + SUBJECT_NAME + ', expires ' + new Date(jwtExp * 1000).toISOString());
  return jwt;
}

let uploads = 0;
let glucose = 120;
let trend = 1;

function nowISO () {
  return new Date().toISOString();
}

function nextGlucose () {
  glucose += trend * (2 + Math.random() * 4);
  if (glucose > 200) trend = -1;
  if (glucose < 80) trend = 1;
  return Math.round(glucose);
}

function makeEntry () {
  return {
    type: 'sgv'
    , sgv: nextGlucose()
    , date: docTime()
    , utcOffset: 0
    , app: 'soak-test'
    , dateString: new Date(docTime()).toISOString()
    , direction: trend > 0 ? 'FortyFiveUp' : 'FortyFiveDown'
    , device: 'soak-test'
  };
}

function makeDeviceStatus () {
  // Realistic AAPS-style payload: predBGs make devicestatus docs fat, which
  // is exactly what the server has to chew through per upload.
  const preds = [];
  for (let i = 0; i < 48; i++) {
    preds.push(Math.round(100 + 50 * Math.sin(i / 5) + Math.random() * 10));
  }
  return {
    device: 'openaps://soak-test'
    , date: docTime()
    , utcOffset: 0
    , app: 'soak-test'
    , created_at: new Date(docTime()).toISOString()
    , openaps: {
      iob: { iob: Math.random() * 3, time: nowISO() }
      , suggested: {
        temp: 'absolute'
        , bg: glucose
        , eventualBG: Math.round(glucose + Math.random() * 20 - 10)
        , insulinReq: Math.random()
        , COB: Math.round(Math.random() * 40)
        , IOB: Math.random() * 3
        , reason: 'soak test synthetic reason string with some length to be realistic'
        , predBGs: { IOB: preds, COB: preds, ZT: preds, UAM: preds }
        , timestamp: nowISO()
      }
      , enacted: { rate: Math.random() * 2, duration: 30, timestamp: nowISO() }
    }
    , pump: {
      battery: { percent: 75 }
      , reservoir: 120 - (uploads % 100)
      , status: { status: 'normal', bolusing: false, suspended: false, timestamp: nowISO() }
      , clock: nowISO()
    }
    , uploader: { battery: 80 }
  };
}

function makeTreatment () {
  return {
    eventType: 'Correction Bolus'
    , insulin: Math.round(Math.random() * 20) / 10
    , date: docTime()
    , utcOffset: 0
    , app: 'soak-test'
    , created_at: new Date(docTime()).toISOString()
    , enteredBy: 'soak-test'
  };
}

async function post (path, body) {
  const token = await ensureJwt();
  const res = await fetch(BASE_URL + path, {
    method: 'POST'
    , headers: {
      'Content-Type': 'application/json'
      , 'Authorization': 'Bearer ' + token
    }
    , body: JSON.stringify(body)
  });
  if (res.status === 401) {
    jwt = null; // force refresh on the next tick
  }
  if (res.status >= 400) {
    console.error('POST ' + path + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
  return res;
}

async function sampleMemory () {
  try {
    const res = await fetch(BASE_URL + '/api/v1/memory?gc=true', { headers: headers });
    if (res.status >= 400) {
      console.error('GET /api/v1/memory -> ' + res.status);
      return;
    }
    const body = await res.json();
    const m = body.message || body; // sendJSONStatus wraps as {status, message}
    const row = [
      m.ts, uploads, m.rssMB, m.heapUsedMB, m.dataLoads, m.dataReceived
      , m.jsc ? m.jsc.objectCount : ''
      , m.jsc ? m.jsc.timers : ''
      , m.jsc ? m.jsc.heapSizeMB : ''
      , m.cache.entries, m.cache.devicestatus, m.cache.treatments
    ].join(',');
    fs.appendFileSync(CSV_FILE, row + '\n');
    console.log('SAMPLE uploads=' + uploads + ' rss=' + m.rssMB + 'MB dataLoads=' + m.dataLoads +
      (m.jsc ? ' objects=' + m.jsc.objectCount + ' timers=' + m.jsc.timers : ''));
  } catch (e) {
    console.error('memory sample failed:', e.message);
  }
}

async function tick () {
  try {
    await post('/api/v3/entries', makeEntry());
    await post('/api/v3/devicestatus', makeDeviceStatus());
    if (uploads % 10 === 0) {
      await post('/api/v3/treatments', makeTreatment());
    }
    uploads++;
    if (uploads % SAMPLE_EVERY === 0) {
      await sampleMemory();
    }
  } catch (e) {
    console.error('upload failed:', e.message);
  }
}

fs.writeFileSync(CSV_FILE,
  'ts,uploads,rssMB,heapUsedMB,dataLoads,dataReceived,objectCount,timers,jscHeapMB,cacheEntries,cacheDevicestatus,cacheTreatments\n');

console.log('Soaking ' + BASE_URL + ' every ' + INTERVAL_SECS + 's, sampling every ' +
  SAMPLE_EVERY + ' uploads -> ' + CSV_FILE + ' (Ctrl+C to stop)');

sampleMemory().then(function () {
  setInterval(tick, INTERVAL_SECS * 1000);
});
