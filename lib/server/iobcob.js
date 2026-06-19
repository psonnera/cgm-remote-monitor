'use strict';

/*
 * Lean IOB/COB time-series collection (myscout).
 *
 * The main chart only needs compact { mills, iob, cob } samples to draw the
 * IOB and COB lines, but devicestatus documents are large (5-20 KB each) and
 * were previously shipped in full and re-parsed on every redraw. This helper
 * maintains a tiny derived collection so retro queries move ~40-byte rows
 * instead of full blobs, and the client never re-parses devicestatus.
 *
 * The extraction logic is NOT reimplemented here: it reuses the existing,
 * already-correct `iob.fromDeviceStatus` / `cob.fromDeviceStatus` plugin
 * methods as the single source of truth for OpenAPS/Loop/pump parsing.
 */

function storage (collection, ctx) {

  // Reuse the plugin extractors. `ctx` must provide moment/language/levels/settings
  // (the server ctx does; the backfill script builds a minimal one). Instantiated
  // lazily so this module can be created during boot before ctx.levels et al. are
  // set — the extractors are only needed at data-load / retro time.
  var iobPlugin, cobPlugin;
  function plugins () {
    if (!iobPlugin) iobPlugin = require('../plugins/iob')(ctx);
    if (!cobPlugin) cobPlugin = require('../plugins/cob')(ctx);
    return { iob: iobPlugin, cob: cobPlugin };
  }

  function api () {
    return ctx.store.collection(collection);
  }

  // Build a lean { mills, iob, cob, device } row from one runtime-processed
  // devicestatus doc, or null if neither IOB nor COB could be extracted.
  function deriveRow (status) {
    if (!status) return null;

    var p = plugins();
    var iobData, cobData;
    try { iobData = p.iob.fromDeviceStatus(status); } catch (e) { iobData = null; }
    try { cobData = p.cob.fromDeviceStatus(status); } catch (e) { cobData = null; }

    var iobVal = (iobData && iobData.iob !== undefined && iobData.iob !== null) ? iobData.iob : null;
    var cobVal = (cobData && cobData.cob !== undefined && cobData.cob !== null) ? cobData.cob : null;

    if (iobVal === null && cobVal === null) return null;

    // Prefer the timestamp the extractor resolved (the inner openaps/loop
    // reading timestamp), fall back to the record's own mills.
    var mills = (iobData && iobData.mills) || (cobData && cobData.mills) || status.mills;
    mills = Number(mills);
    if (!mills || !isFinite(mills)) return null;

    return {
      mills: mills
      , iob: iobVal
      , cob: cobVal
      , device: status.device || null
    };
  }

  // Upsert lean rows derived from an array of runtime-processed devicestatus
  // docs. Idempotent: keyed on { mills, device } so re-loads / overlapping
  // windows don't create duplicates. fn(err, upsertedCount).
  function upsertFromDeviceStatus (statuses, fn) {
    fn = fn || function () {};
    if (!statuses || !statuses.length) return fn(null, 0);

    var ops = [];
    for (var i = 0; i < statuses.length; i++) {
      var row = deriveRow(statuses[i]);
      if (!row) continue;
      ops.push({
        updateOne: {
          filter: { mills: row.mills, device: row.device }
          , update: { $set: row }
          , upsert: true
        }
      });
    }

    if (!ops.length) return fn(null, 0);

    api().bulkWrite(ops, { ordered: false }).then(function () {
      fn(null, ops.length);
    }).catch(function (err) {
      fn(err);
    });
  }

  // Promise wrapper around upsertFromDeviceStatus for the async backfill loop.
  function upsertBatchAsync (batch) {
    return new Promise(function (resolve, reject) {
      upsertFromDeviceStatus(batch, function (err, count) {
        if (err) return reject(err);
        resolve(count || 0);
      });
    });
  }

  // Cheap (metadata-only) check: does this collection warrant a one-time
  // backfill? True when iobcob is empty but devicestatus already has docs,
  // i.e. the first boot after the upgrade that introduced this collection.
  // fn(err, needed). `devicestatusCollection` is a raw mongo collection.
  function needsBackfill (devicestatusCollection, fn) {
    fn = fn || function () {};
    if (!devicestatusCollection) return fn(null, false);
    api().estimatedDocumentCount().then(function (iobcobCount) {
      if (iobcobCount > 0) return fn(null, false);
      return devicestatusCollection.estimatedDocumentCount().then(function (dsCount) {
        fn(null, dsCount > 0);
      });
    }).catch(function (err) { fn(err); });
  }

  // One-time backfill of the lean iobcob collection from existing devicestatus
  // documents. Streams in batches to bound memory and reuses the same upsert
  // path as runtime ingest, so it is idempotent (keyed on { mills, device })
  // and safe to re-run or to run concurrently with the live dataloader.
  // options: { batchSize, onProgress(p) }. fn(err, { scanned, upserted }).
  function backfillFromDeviceStatus (devicestatusCollection, options, fn) {
    if (typeof options === 'function') { fn = options; options = {}; }
    options = options || {};
    fn = fn || function () {};
    var batchSize = options.batchSize || 1000;
    var onProgress = options.onProgress || function () {};

    var scanned = 0;
    var upserted = 0;

    (async function run () {
      try {
        var cursor = devicestatusCollection.find({}).sort({ created_at: 1 });
        var batch = [];

        while (await cursor.hasNext()) {
          var doc = await cursor.next();
          scanned++;
          // Mirror runtime processing minimally: ensure a numeric `mills`.
          if (!doc.mills && doc.created_at) {
            doc.mills = new Date(doc.created_at).getTime();
          }
          batch.push(doc);

          if (batch.length >= batchSize) {
            upserted += await upsertBatchAsync(batch);
            batch = [];
            onProgress({ scanned: scanned, upserted: upserted });
          }
        }

        if (batch.length) {
          upserted += await upsertBatchAsync(batch);
        }

        fn(null, { scanned: scanned, upserted: upserted });
      } catch (e) {
        fn(e);
      }
    })();
  }

  // Run the backfill only if needed. fn(err, result|null) where result is the
  // backfill summary, or null when no backfill was performed.
  function maybeBackfill (devicestatusCollection, options, fn) {
    if (typeof options === 'function') { fn = options; options = {}; }
    fn = fn || function () {};
    needsBackfill(devicestatusCollection, function (err, needed) {
      if (err) return fn(err);
      if (!needed) return fn(null, null);
      backfillFromDeviceStatus(devicestatusCollection, options, fn);
    });
  }

  // Return compact sorted [{ mills, iob, cob }] for a time range. fn(err, rows).
  function listRange (from, to, fn) {
    var mq = {};
    if (from !== undefined && from !== null) mq.$gte = Number(from);
    if (to !== undefined && to !== null) mq.$lte = Number(to);
    var query = Object.keys(mq).length ? { mills: mq } : {};

    api().find(query, { projection: { _id: 0, mills: 1, iob: 1, cob: 1 } })
      .sort({ mills: 1 }).toArray()
      .then(function (rows) { fn(null, rows); })
      .catch(function (err) { fn(err); });
  }

  api.deriveRow = deriveRow;
  api.upsertFromDeviceStatus = upsertFromDeviceStatus;
  api.needsBackfill = needsBackfill;
  api.backfillFromDeviceStatus = backfillFromDeviceStatus;
  api.maybeBackfill = maybeBackfill;
  api.listRange = listRange;
  api.indexedFields = ['mills', { mills: 1, device: 1 }];
  return api;
}

module.exports = storage;
