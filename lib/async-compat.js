'use strict';

/* Minimal drop-in replacements for the only `async` functions this project
 * uses, preserving async@0.9.2's node-callback semantics:
 *   - ordered results (results[i] matches task i),
 *   - first-error short-circuit (final callback invoked once, with the first
 *     error; no double-callback),
 *   - result value shape (cb(err, value) -> results[i] = value; multiple values
 *     -> array; no value -> undefined),
 *   - empty input -> (null, []) for parallel/series/parallelLimit, (null) for
 *     eachSeries.
 * This replaces the legacy `async` npm dependency. Only array task lists are
 * supported (the object form is not used in this codebase).
 */

function collect (args) {
  // args is the arguments object of the step callback; index 0 is err
  const rest = Array.prototype.slice.call(args, 1);
  return rest.length <= 1 ? rest[0] : rest;
}

function parallel (tasks, callback) {
  callback = callback || function () {};
  const n = tasks.length;
  if (!n) return callback(null, []);
  const results = new Array(n);
  let done = 0;
  let finished = false;
  tasks.forEach(function (task, i) {
    task(function (err) {
      if (finished) return;
      if (err) { finished = true; return callback(err); }
      results[i] = collect(arguments);
      if (++done === n) { finished = true; callback(null, results); }
    });
  });
}

function series (tasks, callback) {
  callback = callback || function () {};
  const results = [];
  let i = 0;
  (function run () {
    if (i === tasks.length) return callback(null, results);
    tasks[i](function (err) {
      if (err) return callback(err, results);
      results.push(collect(arguments));
      i++;
      run();
    });
  })();
}

function eachSeries (arr, iteratee, callback) {
  callback = callback || function () {};
  let i = 0;
  (function run () {
    if (i === arr.length) return callback(null);
    iteratee(arr[i], function (err) {
      if (err) return callback(err);
      i++;
      run();
    });
  })();
}

function parallelLimit (tasks, limit, callback) {
  callback = callback || function () {};
  const n = tasks.length;
  if (!n) return callback(null, []);
  const results = new Array(n);
  let done = 0;
  let next = 0;
  let running = 0;
  let finished = false;
  (function launch () {
    while (running < limit && next < n) {
      const i = next++;
      running++;
      tasks[i](function (err) {
        if (finished) return;
        running--;
        if (err) { finished = true; return callback(err); }
        results[i] = collect(arguments);
        if (++done === n) { finished = true; return callback(null, results); }
        launch();
      });
    }
  })();
}

module.exports = { parallel, series, eachSeries, parallelLimit };
