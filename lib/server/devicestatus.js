'use strict';

var moment = require('moment');
var find_options = require('./query');

function storage (collection, ctx) {

  function create (statuses, fn) {

    if (!Array.isArray(statuses)) { statuses = [statuses]; }

    const r = [];
    let errorOccurred = false;

    for (let i = 0; i < statuses.length; i++) {

      const obj = statuses[i];

      if (errorOccurred) return;

      // Normalize all dates to UTC
      const d = moment(obj.created_at).isValid() ? moment.parseZone(obj.created_at) : moment();
      obj.created_at = d.toISOString();
      obj.utcOffset = d.utcOffset();

      // Check if document with this _id already exists (deduplication)
      if (obj._id) {
        api().findOne({ _id: obj._id }).then(function (existingDoc) {
          if (existingDoc) {
            // Document already exists, skip insertion
            console.log('Skipping duplicate device status with _id:', obj._id);
            r.push(existingDoc);

            // Still emit data-update to keep cache in sync
            ctx.bus.emit('data-update', {
              type: 'devicestatus'
              , op: 'update'
              , changes: ctx.ddata.processRawDataForRuntime([existingDoc])
            });

            // Last object! Return results
            if (i == statuses.length - 1) {
              fn(null, r);
              ctx.bus.emit('data-received');
            }
          } else {
            // No duplicate, proceed with insert
            performInsert();
          }
        }).catch(function (findErr) {
          console.log('Error checking for duplicate device status', findErr.message);
          // Continue with insert attempt on error
          performInsert();
        });
      } else {
        // No _id provided, proceed with normal insert
        performInsert();
      }

      function performInsert() {
        api().insertOne(obj).then(function (results) {
          if (!obj._id) obj._id = results.insertedId;
          r.push(obj);

          ctx.bus.emit('data-update', {
            type: 'devicestatus'
            , op: 'update'
            , changes: ctx.ddata.processRawDataForRuntime([obj])
          });

          // Last object! Return results
          if (i == statuses.length - 1) {
            fn(null, r);
            ctx.bus.emit('data-received');
          }
        }).catch(function (err) {
          console.log('Error inserting the device status object', err.message);
          errorOccurred = true;
          fn(err.message, null);
        });
      }
    };
  }

  function last (fn) {
    return list({ count: 1 }, function(err, entries) {
      if (entries && entries.length > 0) {
        fn(err, entries[0]);
      } else {
        fn(err, null);
      }
    });
  }

  function query_for (opts) {
    return find_options(opts, storage.queryOpts);
  }

  function list (opts, fn) {
    // these functions, find, sort, and limit, are used to
    // dynamically configure the request, based on the options we've
    // been given

    // determine sort options
    function sort () {
      return opts && opts.sort || { created_at: -1 };
    }

    // configure the limit portion of the current query
    function limit () {
      if (opts && opts.count) {
        return this.limit(parseInt(opts.count));
      }
      return this;
    }

    // now just stitch them all together
    limit.call(api()
      .find(query_for(opts))
      .sort(sort())
    ).toArray()
      .then(function (entries) { fn(null, entries); })
      .catch(function (err) { fn(err); });
  }

  function remove (opts, fn) {

    function removed (err, stat) {
      // Handle both v3 and v4 driver result structure
      var deletedCount = stat.deletedCount !== undefined ? stat.deletedCount : (stat.result ? stat.result.n : 0);

      ctx.bus.emit('data-update', {
        type: 'devicestatus'
        , op: 'remove'
        , count: deletedCount
        , changes: opts.find._id
      });

      fn(err, stat);
    }

    return api().deleteMany(query_for(opts))
      .then(function (stat) { removed(null, stat); })
      .catch(function (err) { fn(err); });
  }

  function api () {
    return ctx.store.collection(collection);
  }

  api.list = list;
  api.create = create;
  api.query_for = query_for;
  api.last = last;
  api.remove = remove;
  api.aggregate = require('./aggregate')({}, api);
  api.indexedFields = [
    'created_at'




    , 'NSCLIENT_ID'
  ];
  return api;
}

storage.queryOpts = {
  dateField: 'created_at'
};

module.exports = storage;
