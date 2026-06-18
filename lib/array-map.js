'use strict';

/* Apply an async (item, next) iterator over an in-memory array in order,
 * collecting the mapped results, then call done(err, results).
 *
 * Replaces the in-memory event-stream pipelines previously used in entries
 * handling (es.pipeline(es.readArray(arr), es.map(iter), es.writeArray(done))).
 * Matches es.map semantics: items whose mapped value is null/undefined are
 * skipped, and a step error short-circuits to done(err, collectedSoFar).
 */
function mapSeries (arr, iter, done) {
  const results = [];
  let i = 0;
  (function step () {
    if (i >= arr.length) return done(null, results);
    iter(arr[i++], function (err, mapped) {
      if (err) return done(err, results);
      if (mapped !== null && mapped !== undefined) results.push(mapped);
      step();
    });
  })();
}

module.exports = { mapSeries };
