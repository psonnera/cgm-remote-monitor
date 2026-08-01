'use strict';

/* Lightweight memory monitor for diagnosing slow leaks in production.
 *
 * Emits a single greppable JSON line ("MEMMON {...}") to the console on a
 * fixed interval and exposes the same snapshot plus JSC heap snapshots to
 * the admin-only /api/v1/memory endpoints.
 *
 * Heap statistics come from bun:jsc when running under Bun; under Node the
 * module degrades to process.memoryUsage() only.
 */

const fs = require('fs');
const path = require('path');

function init (env, ctx) {

  const memmon = {};

  const enabled = (process.env.MEMORY_MONITOR || 'true').toLowerCase() !== 'false';
  const intervalSecs = parseInt(process.env.MEMORY_MONITOR_INTERVAL, 10) || 300;
  const snapshotDir = process.env.MEMORY_SNAPSHOT_DIR || require('os').tmpdir();

  let jsc = null;
  try {
    jsc = require('bun:jsc');
  } catch (e) {
    // not running under Bun
  }

  const counters = {
    dataLoads: 0
    , dataReceived: 0
    , startedMills: Date.now()
  };

  ctx.bus.on('data-loaded', function countLoad () { counters.dataLoads++; });
  ctx.bus.on('data-received', function countReceived () { counters.dataReceived++; });

  function toMB (bytes) {
    return Math.round(bytes / 1048576 * 10) / 10;
  }

  memmon.snapshot = function snapshot () {
    const mu = process.memoryUsage();
    const result = {
      ts: new Date().toISOString()
      , uptimeMins: Math.round((Date.now() - counters.startedMills) / 60000)
      , rssMB: toMB(mu.rss)
      , heapUsedMB: toMB(mu.heapUsed)
      , heapTotalMB: toMB(mu.heapTotal)
      , externalMB: toMB(mu.external || 0)
      , dataLoads: counters.dataLoads
      , dataReceived: counters.dataReceived
      , cache: {
        treatments: ctx.cache.treatments.length
        , devicestatus: ctx.cache.devicestatus.length
        , entries: ctx.cache.entries.length
      }
    };

    if (jsc) {
      const stats = jsc.heapStats();
      result.jsc = {
        heapSizeMB: toMB(stats.heapSize)
        , heapCapacityMB: toMB(stats.heapCapacity)
        , extraMemorySizeMB: toMB(stats.extraMemorySize)
        , objectCount: stats.objectCount
        , protectedObjectCount: stats.protectedObjectCount
        , globalObjectCount: stats.globalObjectCount
      };
      const types = stats.objectTypeCounts || {};
      result.jsc.timers = types.Timeout || types.Timer || 0;
      result.jsc.functions = types.Function || 0;
      result.jsc.promises = types.Promise || 0;
    }

    return result;
  };

  memmon.gc = function gc () {
    if (typeof Bun !== 'undefined' && Bun.gc) {
      Bun.gc(true);
      return true;
    }
    if (typeof global.gc === 'function') {
      global.gc();
      return true;
    }
    return false;
  };

  memmon.writeHeapSnapshot = function writeHeapSnapshot () {
    if (typeof Bun === 'undefined' || !Bun.generateHeapSnapshot) {
      throw new Error('Bun.generateHeapSnapshot not available; heap snapshots require the Bun runtime');
    }
    const snapshot = Bun.generateHeapSnapshot();
    const file = path.join(snapshotDir, 'heap-' + Date.now() + '.json');
    fs.writeFileSync(file, typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot));
    return { file: file, bytes: fs.statSync(file).size };
  };

  if (enabled) {
    const timer = setInterval(function logSnapshot () {
      try {
        console.info('MEMMON', JSON.stringify(memmon.snapshot()));
      } catch (e) {
        console.error('MEMMON snapshot failed', e);
      }
    }, intervalSecs * 1000);
    if (timer.unref) timer.unref();
    ctx.bus.on('teardown', function stopMemmon () {
      clearInterval(timer);
    });
  }

  return memmon;
}

module.exports = init;
