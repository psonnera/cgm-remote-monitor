'use strict';

var _ = require('lodash');
var async = require('../async-compat');
var moment = require('moment');
var find_options = require('./query');
var purifyForStorage = require('./storage-purifier');
var countParam = require('./count');
var srvDates = require('./srv-dates');
var softDeleted = require('./soft-deleted');

function storage (env, ctx) {
  var ObjectId = require('mongodb').ObjectId;
  var idForms = require('./object-id-forms');
  var fallbackKey = require('./treatment-fallback-key');

  function literal (value) {
    return { $eq: value };
  }

  function validateDedupFields (obj) {
    ['identifier', 'eventType'].forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(obj, field)
        && obj[field] !== null && typeof obj[field] !== 'string') {
        throw new TypeError('Treatment ' + field + ' must be a string');
      }
    });
  }

  function create (objOrArray, fn) {

    function done (err, result) {
      ctx.bus.emit('data-received', { immediate: true });
      fn(err, result);
    }

    try {
      purifyForStorage(ctx, objOrArray);
      (Array.isArray(objOrArray) ? objOrArray : [objOrArray]).forEach(validateDedupFields);
    } catch (err) {
      return fn(err, []);
    }

    if (_.isArray(objOrArray)) {
      var allDocs = [];
      var errs = [];
      async.eachSeries(objOrArray, function (obj, callback) {
        upsert(obj, function upserted (err, docs) {
          allDocs = allDocs.concat(docs);
          errs.push(err);
          callback(err, docs)
        });
      }, function () {
        errs = _.compact(errs);
        done(errs.length > 0 ? errs : null, allDocs);
      });
    } else {
      upsert(objOrArray, function upserted (err, docs) {
        done(err, docs);
      });
    }


  }

  function upsert (obj, fn) {
    var submittedId = obj._id;
    normalizeTreatmentId(obj);

    var results = prepareData(obj);

    // For CGM Sensor events, check for duplicates within 10 seconds
    const sensorEventTypes = ['Sensor Start', 'Sensor Change', 'Sensor Stop'];
    const isSensorEvent = sensorEventTypes.indexOf(obj.eventType) > -1;

    if (isSensorEvent) {
      // Check for existing sensor event within ±10 seconds
      const createdAtTime = new Date(results.created_at).getTime();
      const tenSecondsInMs = 10000;
      const startTime = new Date(createdAtTime - tenSecondsInMs).toISOString();
      const endTime = new Date(createdAtTime + tenSecondsInMs).toISOString();

      const duplicateQuery = {
        eventType: obj.eventType,
        created_at: {
          $gte: startTime,
          $lte: endTime
        }
      };

      api().findOne(duplicateQuery).then(function (existingDoc) {
        if (existingDoc) {
          // Found a duplicate within 10 seconds, skip insertion
          console.log('Skipping duplicate CGM Sensor event within 10 seconds', {
            eventType: obj.eventType,
            existing: existingDoc.created_at,
            new: results.created_at
          });
          // Return the existing document instead of creating a duplicate
          ctx.bus.emit('data-update', {
            type: 'treatments',
            op: 'update',
            changes: ctx.ddata.processRawDataForRuntime([existingDoc])
          });
          fn(null, [existingDoc]);
        } else {
          // No duplicate found, proceed with normal upsert
          performUpsert();
        }
      }).catch(function (findErr) {
        console.error('Error checking for duplicate sensor event', findErr);
        // Continue with normal upsert on error
        performUpsert();
      });
    } else {
      // Not a sensor event, use normal upsert logic
      performUpsert();
    }

    function performUpsert() {
      var query = upsertQueryFor(obj, results);
      var stale = staleFormsFor(submittedId, query);

      function complete (err, updateResults) {

      if (err) console.error('Problem upserting treatment', err);

      if (!err && updateResults) {
        // mongodb driver 6: upsertedId is the ObjectId itself (or null).
        if (updateResults.upsertedCount == 1 && updateResults.upsertedId) {
          obj._id = updateResults.upsertedId;
        }
      }

      // TODO document this feature
      if (!err && obj.preBolus) {
        //create a new object to insert copying only the needed fields
        var pbTreat = {
          created_at: (new Date(new Date(results.created_at).getTime() + (obj.preBolus * 60000))).toISOString(),
          eventType: obj.eventType,
          carbs: results.preBolusCarbs
        };

        if (obj.notes) {
          pbTreat.notes = obj.notes;
        }

        function pbComplete (err, updateResults) {

          if (!err && updateResults) {
            if (updateResults.upsertedCount == 1 && updateResults.upsertedId) {
              pbTreat._id = updateResults.upsertedId;
            }
          }

          var treatments = _.compact([obj, pbTreat]);

          // We prefer to emit the persisted documents (read back from Mongo) after
          // an upsert rather than emitting the raw input objects. Emitting the
          // input objects can propagate incomplete/derived-field-less documents
          // (for example, missing `endmills`) into the runtime cache which can
          // make temp-basal entries disappear from clients even though the DB
          // contains the full data. Reading the saved docs and emitting those
          // ensures the runtime reflects what is actually stored.
          //
          // We still include safe fallbacks: if the read fails for any reason
          // we emit the original input objects so the system remains functional.
          try {
            const ids = [];
            if (obj && obj._id) ids.push(new ObjectId(obj._id));
            if (pbTreat && pbTreat._id) ids.push(new ObjectId(pbTreat._id));

            if (ids.length > 0) {
              api().find({ _id: { $in: ids } }).toArray().then(function (docs) {
                if (docs && docs.length > 0) {
                  ctx.bus.emit('data-update', {
                    type: 'treatments',
                    op: 'update',
                    changes: ctx.ddata.processRawDataForRuntime(docs)
                  });
                  fn(err, docs);
                  return;
                }

                // fallback to emitting the input objects
                ctx.bus.emit('data-update', {
                  type: 'treatments',
                  op: 'update',
                  changes: ctx.ddata.processRawDataForRuntime(treatments)
                });
                fn(err, treatments);
              }).catch(function (findErr) {
                // fallback to emitting the input objects
                ctx.bus.emit('data-update', {
                  type: 'treatments',
                  op: 'update',
                  changes: ctx.ddata.processRawDataForRuntime(treatments)
                });
                fn(err, treatments);
              });
            } else {
              ctx.bus.emit('data-update', {
                type: 'treatments',
                op: 'update',
                changes: ctx.ddata.processRawDataForRuntime(treatments)
              });
              fn(err, treatments);
            }
          } catch (e) {
            ctx.bus.emit('data-update', {
              type: 'treatments',
              op: 'update',
              changes: ctx.ddata.processRawDataForRuntime(treatments)
            });
            fn(err, treatments);
          }
        }

        var pbQuery = {
          created_at: literal(pbTreat.created_at),
          eventType: literal(pbTreat.eventType)
        };
        srvDates.carryForReplace(api(), [{ filter: pbQuery, doc: pbTreat }])
          .then(function () { return api( ).replaceOne(pbQuery, pbTreat, {upsert: true}); })
          .then(function (updateResults) { pbComplete(null, updateResults); })
          .catch(function (err) { pbComplete(err); });
      } else {

        // For the simple (non-preBolus) upsert path we do the same: when the
        // operation has produced an _id we attempt to read the saved document
        // back from Mongo and emit that. This prevents the case where an
        // upsert/replace call omitted derived fields and those omissions were
        // pushed into the cache. If the find fails we still emit the input
        // object as a fallback to avoid losing updates.
        try {
          if (obj && obj._id) {
            const objId = new ObjectId(obj._id);
            api().findOne({ _id: objId }).then(function (saved) {
              if (saved) {
                ctx.bus.emit('data-update', {
                  type: 'treatments',
                  op: 'update',
                  changes: ctx.ddata.processRawDataForRuntime([saved])
                });
                fn(err, [saved]);
                return;
              }

              // fallback
              ctx.bus.emit('data-update', {
                type: 'treatments',
                op: 'update',
                changes: ctx.ddata.processRawDataForRuntime([obj])
              });
              fn(err, [obj]);
            }).catch(function (findErr) {
              // fallback
              ctx.bus.emit('data-update', {
                type: 'treatments',
                op: 'update',
                changes: ctx.ddata.processRawDataForRuntime([obj])
              });
              fn(err, [obj]);
            });
          } else {
            ctx.bus.emit('data-update', {
              type: 'treatments',
              op: 'update',
              changes: ctx.ddata.processRawDataForRuntime([obj])
            });
            fn(err, [obj]);
          }
        } catch (e) {
          ctx.bus.emit('data-update', {
            type: 'treatments',
            op: 'update',
            changes: ctx.ddata.processRawDataForRuntime([obj])
          });
          fn(err, [obj]);
        }
      }

    }

      (async function () {
        var updateResults;
        try {
          // srvModified on the write, srvCreated/identifier kept from the record
          // it replaces (API v3 history reads them; see srv-dates).
          await srvDates.carryForReplace(api(), [{ filter: query, doc: obj }]);
          updateResults = await api().replaceOne(query, obj, {upsert: true});
          // 15.0.6 and earlier stored a 24-hex _id as the string itself; an
          // upsert by the ObjectId form cannot see it, so remove it after.
          if (stale.length > 0) {
            await api().deleteMany({ _id: { $in: stale } });
          }
          if (updateResults && updateResults.matchedCount >= 1 && obj.identifier && !obj._id) {
            // On update by identifier, fetch the existing _id
            try {
              var existing = await api().findOne(query);
              if (existing) {
                obj._id = existing._id;
              }
            } catch (findErr) {
              // update success does not fail if the lookup fails.
            }
          }
        } catch (err) {
          return complete(err);
        }
        complete(null, updateResults);
      })();
    } // End of performUpsert
  }

  function list (opts, fn) {

    function limit ( ) {
      // A count of zero answers with no documents rather than an unbounded read.
      return countParam.applyCount(this, opts);
    }

    var cursor;
    try {
      cursor = limit.call(api()
        .find(query_for(opts))
        .sort(opts && opts.sort || {created_at: -1}), opts);
    } catch (err) {
      // A refused query (operator allowlist, JavaScript guard, bad date) is
      // reported to the caller instead of escaping as a synchronous throw.
      return fn(err);
    }

    return cursor
      .toArray()
      .then(function (results) { fn(null, results); })
      .catch(function (err) { fn(err); });
  }

  // Reads leave out deleted records (isValid: false; see soft-deleted).
  function query_for (opts) {
    return softDeleted.visible(stored_query_for(opts), opts);
  }

  // Every stored record the query names, deleted or not: what DELETE removes.
  function stored_query_for (opts) {
    var asked = opts && opts.find && opts.find._id;
    // find[_id]=<hex> (also used by DELETE /treatments/:id) comes back as an
    // ObjectId; also match a treatment stored with the same id as a string,
    // as 15.0.6 and earlier stored a 24-hex _id.
    return idForms.matchEitherForm(find_options(opts, storage.queryOpts), asked);
  }

  function remove (opts, fn) {
    // The id as asked: query_for rewrites opts.find._id into a filter.
    var asked = opts && opts.find ? opts.find._id : undefined;
    var query;
    try {
      query = stored_query_for(opts);
    } catch (err) {
      return fn(err);
    }
    return api( ).deleteMany(query).then(function (stat) {
        //TODO: this is triggering a read from Mongo, we can do better
        //console.log('Treatment removed', opts); // , stat);
        var deletedCount = stat.deletedCount;

        ctx.bus.emit('data-update', {
          type: 'treatments',
          op: 'remove',
          count: deletedCount,
          changes: idForms.cacheRemoval(asked, deletedCount)
        });

        ctx.bus.emit('data-received', { immediate: true });
        fn(null, stat);
      }).catch(function (err) {
        fn(err);
      });
  }

  function save (obj, fn) {
    try {
      purifyForStorage(ctx, obj);
      validateDedupFields(obj);
    } catch (err) {
      return fn(err, obj);
    }

    var submittedId = obj._id;
    normalizeTreatmentId(obj);
    if (obj._id == null && !obj.identifier) {
      obj._id = new ObjectId();
    }
    prepareData(obj);

    var query = upsertQueryFor(obj, { created_at: obj.created_at });
    var stale = staleFormsFor(submittedId, query);

    function saved (err, created) {
      if (!err) {
        // console.log('Treatment updated', created);

        ctx.ddata.processRawDataForRuntime(obj);

        ctx.bus.emit('data-update', {
          type: 'treatments',
          op: 'update',
          changes: ctx.ddata.processRawDataForRuntime([obj])
        });

      }
      if (err) console.error('Problem saving treating', err);

      fn(err, created);
    }

    (async function () {
      var updateResults;
      try {
        await srvDates.carryForReplace(api(), [{ filter: query, doc: obj }]);
        updateResults = await api().replaceOne(query, obj, { upsert: true });
        if (stale.length > 0) {
          await api().deleteMany({ _id: { $in: stale } });
        }
        if (updateResults && updateResults.upsertedCount == 1 && updateResults.upsertedId) {
          obj._id = updateResults.upsertedId;
        } else if (updateResults && updateResults.matchedCount >= 1 && obj.identifier && !obj._id) {
          // On update by identifier, fetch the existing _id
          try {
            var existing = await api().findOne(query);
            if (existing) {
              obj._id = existing._id;
            }
          } catch (findErr) {
            // update success does not fail if the lookup fails.
          }
        }
      } catch (err) {
        return saved(err);
      }
      saved(null, updateResults);
    })();

    ctx.bus.emit('data-received', { immediate: true });
  }

  function api ( ) {
    return ctx.store.collection(env.treatments_collection);
  }

  // 15.0.6 and earlier stored a 24-hex _id as the string itself. When a write
  // matches its record by _id, the ObjectId filter cannot see such a record,
  // so after the upsert delete the string form of the same id: the write
  // leaves one record rather than a copy beside the original. `submittedId`
  // is the _id as the client sent it, so an upper-case string is matched too.
  function staleFormsFor (submittedId, query) {
    return query && query._id ? idForms.staleStringForms([submittedId]) : [];
  }

  /**
   * Build upsert query: identifier-first lookup
   * Priority: identifier > _id > time+type
   *
   * IMPORTANT: When returning identifier-based query, also removes _id from obj
   * because MongoDB doesn't allow changing _id on upsert update.
   */
  function upsertQueryFor (obj, results) {
    // 1. Prefer identifier for dedup (API v3 clients)
    if (obj.identifier) {
      // Remove _id from replacement - MongoDB will use existing _id on update,
      // or generate new one on insert
      var identifierValue = obj.identifier;
      delete obj._id;
      return { identifier: literal(identifierValue) };
    }
    // 2. Fall back to _id if present and valid
    if (Object.prototype.hasOwnProperty.call(obj, '_id') && obj._id !== null && obj._id !== '') {
      return { _id: literal(obj._id) };
    }
    // 3. Last resort: time + eventType, with the client's identity, or for a
    // write without one its carbs and insulin (BF-121; see treatment-fallback-key)
    return fallbackKey.fallbackQuery(obj, results.created_at, { withAmounts: true });
  }

  /**
   * Normalize treatment ID. A 24-hex string _id becomes the ObjectId it
   * names; any other _id that is not a usable id is dropped so the server
   * assigns one (myscout has no UUID_HANDLING, so a UUID _id is not moved
   * to `identifier`).
   */
  function normalizeTreatmentId (obj) {
    idForms.dropEmptyId(obj);
    if (typeof obj._id === 'string' && !idForms.isHexId(obj._id)) {
      // Non-ObjectId string in _id: delete so the server generates an ObjectId
      delete obj._id;
    } else if (Object.prototype.hasOwnProperty.call(obj, '_id') && obj._id !== null && obj._id !== '') {
      // Convert valid ObjectId strings to ObjectId objects
      obj._id = idForms.toStoredId(obj._id);
    }
  }

  api.list = list;
  api.create = create;
  api.query_for = query_for;
  api.indexedFields = [
    'created_at'
    , 'eventType'
    , 'insulin'
    , 'carbs'
    , 'glucose'
    , 'enteredBy'
    , 'boluscalc.foods._id'
    , 'notes'
    , 'NSCLIENT_ID'
    , 'percent'
    , 'absolute'
    , 'duration'
    , 'identifier'  // Client sync identity (API v3 / identifier-first upsert)
    , { 'eventType' : 1, 'duration' : 1, 'created_at' : 1 }
    // Serves the sensor-event de-duplication lookup (equality on eventType +
    // range on created_at). ESR order: equality field first, then range.
    , { 'eventType' : 1, 'created_at' : 1 }
    // Covers API v3 sort tiebreakers for "latest N of eventType" queries
    , { 'eventType' : 1, 'created_at' : -1, 'identifier' : -1, 'date' : -1, '_id' : -1 }
  ];

  api.remove = remove;
  api.save = save;
  api.aggregate = require('./aggregate')({ }, api);

  return api;
}

function prepareData(obj) {

  // Convert all dates to UTC dates

  // TODO remove this -> must not create new date if missing
  const d = moment(obj.created_at).isValid() ? moment.parseZone(obj.created_at) : moment();
  obj.created_at = d.toISOString();

  var results = {
    created_at: obj.created_at
    , preBolusCarbs: ''
  };

  const offset = d.utcOffset();
  obj.utcOffset = offset;
  results.offset = offset;

  obj.glucose = Number(obj.glucose);
  obj.targetTop = Number(obj.targetTop);
  obj.targetBottom = Number(obj.targetBottom);
  obj.carbs = Number(obj.carbs);
  obj.insulin = Number(obj.insulin);
  obj.duration = Number(obj.duration);
  obj.percent = Number(obj.percent);
  obj.absolute = Number(obj.absolute);
  obj.relative = Number(obj.relative);
  obj.preBolus = Number(obj.preBolus);

  //NOTE: the eventTime is sent by the client, but deleted, we only store created_at
  var eventTime;
  if (obj.eventTime) {
    eventTime = new Date(obj.eventTime).toISOString();
    results.created_at = eventTime;
  }

  obj.created_at = results.created_at;
  if (obj.preBolus && obj.preBolus !== 0 && obj.carbs) {
    results.preBolusCarbs = obj.carbs;
    delete obj.carbs;
  }

  if (obj.eventType === 'Announcement') {
    obj.isAnnouncement = true;
  }

  // clean data
  delete obj.eventTime;

  function deleteIfEmpty (field) {
    if (!obj[field] || obj[field] === 0) {
      delete obj[field];
    }
  }

  function deleteIfNaN (field) {
    if (isNaN(obj[field])) {
      delete obj[field];
    }
  }

  deleteIfEmpty('targetTop');
  deleteIfEmpty('targetBottom');
  deleteIfEmpty('carbs');
  deleteIfEmpty('insulin');
  deleteIfEmpty('percent');
  deleteIfEmpty('relative');
  deleteIfEmpty('notes');
  deleteIfEmpty('preBolus');

  deleteIfNaN('absolute');
  deleteIfNaN('duration');

  if (obj.glucose === 0 || isNaN(obj.glucose)) {
    delete obj.glucose;
    delete obj.glucoseType;
    delete obj.units;
  }

  return results;
}

storage.queryOpts = {
  // Field types come from the treatments schema (lib/server/query-coercion.json),
  // so insulin/carbs/glucose bounds are read as numbers without truncation;
  // the walker keeps only the conversions that are not type claims.
  collection: 'treatments'
  , walker: {
    notes: find_options.parseRegEx
    , eventType: find_options.parseRegEx
    , enteredBy: find_options.parseRegEx
  }
  , dateField: 'created_at'
};

module.exports = storage;
