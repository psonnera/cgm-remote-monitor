'use strict';

/*
 * One-time backfill of the lean `iobcob` collection from existing devicestatus
 * documents. Reuses the same extractor (lib/server/iobcob.js -> iob/cob plugin
 * fromDeviceStatus) as the runtime ingest path, so the result is identical.
 *
 * Idempotent: rows are upserted on { mills, device }, so it can be re-run safely.
 *
 *   Usage:  node bin/backfill-iobcob.js
 *
 * Requires the same MongoDB env vars as the server (MONGODB_URI / STORAGE_URI).
 *
 * NOTE: the server now also performs this backfill automatically on the first
 * boot after the iobcob collection was introduced (see lib/server/bootevent.js
 * -> backfillIobCob), so this script is only needed for manual/forced re-runs.
 */

const env = require('../lib/server/env')();
const storageInit = require('../lib/storage/mongo-storage');

function buildCtx (store) {
  // Minimal ctx sufficient for the iob/cob plugin extractors.
  return {
    store: store
    , moment: require('moment-timezone')
    , settings: require('../lib/settings')()
    , language: require('../lib/language')()
    , levels: require('../lib/levels')
  };
}

storageInit(env, function (err, store) {
  if (err || !store) {
    console.error('Failed to connect to MongoDB:', err && err.message ? err.message : err);
    process.exit(1);
  }

  const ctx = buildCtx(store);
  const iobcob = require('../lib/server/iobcob')(env.iobcob_collection, ctx);
  const devicestatus = store.collection(env.devicestatus_collection);

  // Reuse the shared backfill implementation (single source of truth).
  iobcob.backfillFromDeviceStatus(devicestatus, {
    onProgress: function (p) {
      console.log('  scanned ' + p.scanned + ', upserted ' + p.upserted);
    }
  }, function (bErr, result) {
    if (bErr) {
      console.error('Backfill failed:', bErr && bErr.message ? bErr.message : bErr);
      process.exit(1);
    }
    console.log('Backfill complete. Scanned ' + result.scanned + ' devicestatus docs, upserted ' + result.upserted + ' iobcob rows.');
    process.exit(0);
  });
});
