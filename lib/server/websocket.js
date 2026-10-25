'use strict';

var idForms = require('./object-id-forms');
var fallbackKey = require('./treatment-fallback-key');
var srvDates = require('./srv-dates');
var softDeleted = require('./soft-deleted');
var times = require('../times');
var calcData = require('../data/calcdelta');
var ObjectId = require('mongodb').ObjectId;
const { clientIPFor } = require('./client-ip');
var _ = require('lodash');

// The records a client means by an _id. A 24-hex id (or an ObjectId) matches
// the record whichever form its _id is stored in: the ObjectId, or the
// string, as dbAdd and the v1 routes stored it before. Both forms can be
// stored at once (an ObjectId copy left beside a string one by an earlier
// write), so writes by such an id reach every copy (`many`). Any other id,
// such as a custom string, matches exactly one record, as given.
function idMatch (id) {
  if (id instanceof ObjectId || idForms.isHexId(id)) {
    return { filter: { _id: { $in: idForms.idForms(id) } }, many: true };
  }
  return { filter: { _id: id }, many: false };
}

// The collections API v3 serves: writes to them carry srvModified and
// srvCreated, which v3 history reads (see srv-dates). activity has no v3
// endpoint.
var v3Collections = ['treatments', 'entries', 'devicestatus', 'profile', 'food'];
function servedByV3 (name) {
  return v3Collections.indexOf(name) !== -1;
}

function literal (value) {
  return { $eq: value };
}

function init (env, ctx, server) {
  const getRemoteIP = clientIPFor(env);

  function websocket () {
    return websocket;
  }

  //var log_yellow = '\x1B[33m';
  var log_green = '\x1B[32m';
  var log_magenta = '\x1B[35m';
  var log_reset = '\x1B[0m';
  var LOG_WS = log_green + 'WS: ' + log_reset;
  var LOG_DEDUP = log_magenta + 'DEDUPE: ' + log_reset;

  var io;
  var watchers = 0;
  var lastData = {};
  var lastProfileSwitch = null;

  // Shallow array copies are sufficient here (no per-element deep clone). The
  // dataloader rebuilds ddata arrays from the cache (which hands out deep clones
  // via getData) on every load, so the elements captured in this snapshot are
  // never mutated in place afterwards. calcdelta's only in-place change is an
  // idempotent _id.toString(). slice() guards against array-level mutation
  // (sort/push/splice) while avoiding the heavy deep clone that ran every cycle.
  function snapshotForDelta () {
    return {
      sgvs: (ctx.ddata.sgvs || []).slice()
      , treatments: (ctx.ddata.treatments || []).slice()
      , mbgs: (ctx.ddata.mbgs || []).slice()
      , cals: (ctx.ddata.cals || []).slice()
      , devicestatus: (ctx.ddata.devicestatus || []).slice()
      , profiles: (ctx.ddata.profiles || []).slice()
      , lastUpdated: ctx.ddata.lastUpdated
    };
  }

  // TODO: this would be better to have somehow integrated/improved
  var supportedCollections = {
    'treatments': env.treatments_collection
    , 'entries': env.entries_collection
    , 'devicestatus': env.devicestatus_collection
    , 'profile': env.profile_collection
    , 'food': env.food_collection
    , 'activity': env.activity_collection
  };

  // This is little ugly copy but I was unable to pass testa after making module from status and share with /api/v1/status
  function status () {
    var versionNum = 0;
    const vString = '' + env.version;
    const verParse = vString.split('.');
    if (verParse) {
      versionNum = 10000 * Number(verParse[0]) + 100 * Number(verParse[1]) + 1 * Number(verParse[2]);
    }

    var apiEnabled = env.enclave.isApiKeySet();

    var activeProfile = ctx.ddata.lastProfileFromSwitch;

    var info = {
      status: 'ok'
      , name: env.name
      , version: env.version
      , versionNum: versionNum
      , serverTime: new Date().toISOString()
      , apiEnabled: apiEnabled
      , careportalEnabled: apiEnabled && env.settings.enable.indexOf('careportal') > -1
      , boluscalcEnabled: apiEnabled && env.settings.enable.indexOf('boluscalc') > -1
      , settings: env.settings
      , extendedSettings: ctx.plugins && ctx.plugins.extendedClientSettings ? ctx.plugins.extendedClientSettings(env.extendedSettings) : {}
    };

    if (activeProfile) {
      info.activeProfile = activeProfile;
    }
    return info;
  }

  function start () {
    io = require('socket.io')({
      'log level': 0
    }).listen(server, {
      //these only effect the socket.io.js file that is sent to the client, but better than nothing
      // compat with v2 client
      allowEIO3: true
      , 'browser client minification': true
      , 'browser client etag': true
      , 'browser client gzip': false
      , 'perMessageDeflate': {
        threshold: 512
      }
      , transports: ["polling", "websocket"]
      , httpCompression: {
        threshold: 512
      }
    });

    ctx.bus.on('teardown', function serverTeardown () {
      // socket.io v4: io.sockets.sockets is a Map, not a plain object
      io.sockets.sockets.forEach(function(s) {
        s.disconnect(true);
      });
      io.close();
    });
	
    ctx.bus.on('data-processed', function() {
      update();
    });

  }

  function verifyAuthorization (message, ip, callback) {

    if (!message) message = {};

    ctx.authorization.resolve({ api_secret: message.secret, token: message.token, ip: ip }, function resolved (err, result) {

      if (err) {
        return callback(err, {
          read: false
          , write: false
          , write_treatment: false
          , error: true
        });
      }

      return callback(null, {
        read: ctx.authorization.checkMultiple('api:*:read', result.shiros)
        , write: ctx.authorization.checkMultiple('api:*:create,update,delete', result.shiros)
        , write_treatment: ctx.authorization.checkMultiple('api:treatments:create,update,delete', result.shiros)
      });
    });
  }

  function emitData (delta) {
    if (lastData.cals) {
      // console.log(LOG_WS + 'running websocket.emitData', ctx.ddata.lastUpdated);
      if (lastProfileSwitch !== ctx.ddata.lastProfileFromSwitch) {
        // console.log(LOG_WS + 'profile switch detected OLD: ' + lastProfileSwitch + ' NEW: ' + ctx.ddata.lastProfileFromSwitch);
        delta.status = status(ctx.ddata.profiles);
        lastProfileSwitch = ctx.ddata.lastProfileFromSwitch;
      }
      io.to('DataReceivers').compress(true).emit('dataUpdate', delta);
    }
  }

  function listeners () {
    io.sockets.on('connection', function onConnection (socket) {
      var socketAuthorization = null;
      var clientType = null;
      var timeDiff;
      var history;

      const remoteIP = getRemoteIP(socket.request);
      console.log(LOG_WS + 'Connection from client ID: ', socket.client.id, ' IP: ', remoteIP);

      io.emit('clients', ++watchers);
      socket.on('disconnect', function onDisconnect () {
        io.emit('clients', --watchers);
        console.log(LOG_WS + 'Disconnected client ID: ', socket.client.id);
      });

      function checkConditions (action, data) {
        var collection = supportedCollections[data.collection];
        if (!collection) {
          console.log('WS dbUpdate/dbAdd call: ', 'Wrong collection', data);
          return { result: 'Wrong collection' };
        }

        if (!socketAuthorization) {
          console.log('WS dbUpdate/dbAdd call: ', 'Not authorized', data);
          return { result: 'Not authorized' };
        }

        if (data.collection === 'treatments') {
          if (!socketAuthorization.write_treatment) {
            console.log('WS dbUpdate/dbAdd call: ', 'Not permitted', data);
            return { result: 'Not permitted' };
          }
        } else {
          if (!socketAuthorization.write) {
            console.log('WS dbUpdate call: ', 'Not permitted', data);
            return { result: 'Not permitted' };
          }
        }

        if (action === 'dbUpdate' && !data._id) {
          console.log('WS dbUpdate/dbAddnot sure abou documentati call: ', 'Missing _id', data);
          return { result: 'Missing _id' };
        }

        return null;
      }

      /* Resolve read access for a socket that may never have sent `authorize`.
       *
       * An authorized socket already carries the decision the `authorize`
       * handler made. An anonymous one carries nothing, and asking
       * verifyAuthorization with an empty message resolves exactly the default
       * permissions `authorize` would have resolved for it - the same
       * AUTH_DEFAULT_ROLES shiros the REST surface answers with. So an instance
       * left on the documented `readable` default keeps serving anonymous
       * clients, and one on `denied` refuses them here as it does everywhere
       * else.
       */
      function resolveReadAccess (next) {
        if (socketAuthorization) return next(Boolean(socketAuthorization.read));

        verifyAuthorization({}, remoteIP, function resolved (err, authorization) {
          next(!err && Boolean(authorization && authorization.read));
        });
      }

      socket.on('loadRetro', function loadRetro (opts, callback) {
        resolveReadAccess(function withReadAccess (permitted) {
          if (!permitted) {
            console.log(LOG_WS + 'loadRetro: ', 'Not permitted');
            if (callback) callback({ result: 'Not permitted' });
            return;
          }
          sendRetro(opts, callback);
        });
      });

      function sendRetro (opts, callback) {
        opts = opts || {};
        if (callback) {
          callback({ result: 'success' });
        }

        var retroData = {
          delta: false  // This is a full data load, not a delta update
        };
        var pendingQueries = 0;
        var completedQueries = 0;

        function checkComplete() {
          completedQueries++;
          if (completedQueries === pendingQueries) {
            socket.compress(true).emit('retroUpdate', retroData);
          }
        }

        // Load SGV data if requested
        if (opts.sgv && (opts.from || opts.to)) {
          pendingQueries++;
          try {
            // Build query that supports both 'date' and 'mills' fields
            var sgvQuery = { type: 'sgv' };
            var timeQuery;
            
            // Query entries using 'date' field as per entries storage definition
            if (opts.from && opts.to) {
              timeQuery = {
                date: { $gte: Number(opts.from), $lte: Number(opts.to) }
              };
            } else if (opts.from) {
              timeQuery = {
                date: { $gte: Number(opts.from) }
              };
            } else if (opts.to) {
              timeQuery = {
                date: { $lte: Number(opts.to) }
              };
            }
            
            if (timeQuery) {
              sgvQuery = { $and: [{ type: 'sgv' }, timeQuery] };
            }
            
            ctx.store.collection(env.entries_collection).find(sgvQuery).sort({ date: 1 }).toArray().then(function(docs) {
              // Normalize data: ensure all entries have 'mills' field
              // Some databases use 'date' instead of 'mills'
              // Also ensure 'mgdl' field exists (some databases use 'sgv')
              docs.forEach(function(doc) {
                if (!doc.mills && doc.date) {
                  doc.mills = doc.date;
                }
                if (!doc.mgdl && doc.sgv) {
                  doc.mgdl = doc.sgv;
                }
              });
              retroData.sgvs = docs;
              checkComplete();
            }).catch(function(err) {
              console.error('loadRetro sgv query error', err);
              retroData.sgvs = [];
              checkComplete();
            });
          } catch (e) {
            console.error('loadRetro sgv handler exception', e);
            retroData.sgvs = [];
            checkComplete();
          }
        }

        // Load treatments data if requested
        if (opts.treatments && (opts.from || opts.to)) {
          pendingQueries++;
          try {
            // Query treatments using 'created_at' field as per treatments storage definition
            var treatmentQuery = {};
            if (opts.from && opts.to) {
              treatmentQuery = {
                created_at: { $gte: new Date(Number(opts.from)).toISOString(), $lte: new Date(Number(opts.to)).toISOString() }
              };
            } else if (opts.from) {
              treatmentQuery = {
                created_at: { $gte: new Date(Number(opts.from)).toISOString() }
              };
            } else if (opts.to) {
              treatmentQuery = {
                created_at: { $lte: new Date(Number(opts.to)).toISOString() }
              };
            }

            ctx.store.collection(env.treatments_collection).find(treatmentQuery).sort({ created_at: 1 }).toArray().then(function(docs) {
              // Normalize data: ensure all treatments have 'mills' field from created_at
              docs.forEach(function(doc) {
                if (!doc.mills && doc.created_at) {
                  doc.mills = new Date(doc.created_at).getTime();
                }
              });
              retroData.treatments = docs;
              checkComplete();
            }).catch(function(err) {
              console.error('loadRetro treatments query error', err);
              retroData.treatments = [];
              checkComplete();
            });
          } catch (e) {
            console.error('loadRetro treatments handler exception', e);
            retroData.treatments = [];
            checkComplete();
          }
        }

        // Load profile data if requested
        if (opts.profile) {
          pendingQueries++;
          try {
            ctx.store.collection(env.profile_collection).find({}).toArray().then(function(docs) {
              retroData.profiles = docs;
              checkComplete();
            }).catch(function(err) {
              console.error('loadRetro profile query error', err);
              retroData.profiles = [];
              checkComplete();
            });
          } catch (e) {
            console.error('loadRetro profile handler exception', e);
            retroData.profiles = [];
            checkComplete();
          }
        }

        // Lean IOB/COB series request (myscout): return compact { mills, iob, cob }
        // rows instead of full devicestatus blobs. Falls back to the devicestatus
        // path if the derived collection is empty (e.g. not yet backfilled).
        if (opts.iobcob && (opts.from || opts.to) && ctx.iobcob) {
          pendingQueries++;
          try {
            ctx.iobcob.listRange(opts.from, opts.to, function (err, rows) {
              if (err) {
                console.error('loadRetro iobcob query error', err);
                retroData.iobcob = [];
                return checkComplete();
              }
              if (rows && rows.length) {
                retroData.iobcob = rows;
                return checkComplete();
              }

              // Empty series -> fall back to devicestatus so pre-backfill setups still work.
              var dsQuery = {};
              if (opts.from && opts.to) {
                dsQuery = { created_at: { $gte: new Date(Number(opts.from)).toISOString(), $lte: new Date(Number(opts.to)).toISOString() } };
              } else if (opts.from) {
                dsQuery = { created_at: { $gte: new Date(Number(opts.from)).toISOString() } };
              } else if (opts.to) {
                dsQuery = { created_at: { $lte: new Date(Number(opts.to)).toISOString() } };
              }
              ctx.store.collection(env.devicestatus_collection).find(dsQuery).sort({ created_at: 1 }).toArray().then(function (docs) {
                try {
                  retroData.devicestatus = ctx.ddata.processRawDataForRuntime(docs);
                } catch (procErr) {
                  console.error('processing devicestatus docs failed', procErr);
                  retroData.devicestatus = [];
                }
                checkComplete();
              }).catch(function (dsErr) {
                console.error('loadRetro iobcob fallback devicestatus error', dsErr);
                retroData.devicestatus = [];
                checkComplete();
              });
            });
          } catch (e) {
            console.error('loadRetro iobcob handler exception', e);
            retroData.iobcob = [];
            checkComplete();
          }
        }

        // If the client requests only devicestatus and provides a time range,
        // query the DB for those device-status entries and send them back.
        if (opts.devicestatus && (opts.from || opts.to)) {
          pendingQueries++;
          try {
            // Query devicestatus using 'created_at' field as per devicestatus storage definition
            var query = {};
            if (opts.from && opts.to) {
              query = {
                created_at: { $gte: new Date(Number(opts.from)).toISOString(), $lte: new Date(Number(opts.to)).toISOString() }
              };
            } else if (opts.from) {
              query = {
                created_at: { $gte: new Date(Number(opts.from)).toISOString() }
              };
            } else if (opts.to) {
              query = {
                created_at: { $lte: new Date(Number(opts.to)).toISOString() }
              };
            }

            ctx.store.collection(env.devicestatus_collection).find(query).sort({ created_at: 1 }).toArray().then(function(docs) {
              // process raw docs into runtime-ready objects
              try {
                var processed = ctx.ddata.processRawDataForRuntime(docs);
                retroData.devicestatus = processed;
              } catch (procErr) {
                console.error('processing devicestatus docs failed', procErr);
                retroData.devicestatus = [];
              }
              checkComplete();
            }).catch(function(err) {
              console.error('loadRetro devicestatus query error', err);
              retroData.devicestatus = [];
              checkComplete();
            });
          } catch (e) {
            console.error('loadRetro devicestatus handler exception', e);
            retroData.devicestatus = [];
            checkComplete();
          }
        } else if (opts.devicestatus) {
          // Default behavior: send last cached device-status snapshot
          retroData.devicestatus = lastData.devicestatus;
        }

        // If no queries were made, send default devicestatus
        if (pendingQueries === 0) {
          socket.compress(true).emit('retroUpdate', { devicestatus: lastData.devicestatus });
        }
      }

      // dbUpdate message
      //  {
      //    collection: treatments
      //    _id: 'some mongo record id'
      //    data: {
      //      field_1: new_value,
      //      field_2: another_value
      //    }
      //  }
      socket.on('dbUpdate', function dbUpdate (data, callback) {
        console.log(LOG_WS + 'dbUpdate client ID: ', socket.client.id, ' data: ', data);
        var collection = supportedCollections[data.collection];

        var check = checkConditions('dbUpdate', data);
        if (check) {
          if (callback) {
            callback(check);
          }
          return;
        }
        var match = idMatch(data._id);

        // Sanitize free-text fields before persisting the $set update -
        // mirrors the purification applied on dbAdd / REST writes.
        try {
          ctx.purifier.purifyObject(data.data);
        } catch (err) {
          console.error(err);
          if (callback) {
            callback({ result: 'Unable to process update' });
          }
          return;
        }

        var setFields = data.data;
        if (servedByV3(data.collection)) {
          // API v3 history reads srvModified (see srv-dates).
          setFields = Object.assign({}, data.data);
          srvDates.stampModified(setFields);
        }
        var mongoCollection = ctx.store.collection(collection);
        (match.many
          ? mongoCollection.updateMany(match.filter, { $set: setFields })
          : mongoCollection.updateOne(match.filter, { $set: setFields })
        ).then(function() {
          mongoCollection.findOne(match.filter)
            .then(function(results) {
              console.log('Got results', results);
              if (results !== null) {
                ctx.bus.emit('data-update', {
                  type: data.collection
                  , op: 'update'
                  , changes: ctx.ddata.processRawDataForRuntime([results])
                });
              }
            }).catch(function(err) { console.error(err); });
        }).catch(function(err) { console.error(err); });

        if (callback) {
          callback({ result: 'success' });
        }
        ctx.bus.emit('data-received', { immediate: true });
      });

      // dbUpdateUnset message
      //  {
      //    collection: treatments
      //    _id: 'some mongo record id'
      //    data: {
      //      field_1: 1,
      //      field_2: 1
      //    }
      //  }
      socket.on('dbUpdateUnset', function dbUpdateUnset (data, callback) {
        console.log(LOG_WS + 'dbUpdateUnset client ID: ', socket.client.id, ' data: ', data);
        var collection = supportedCollections[data.collection];

        var check = checkConditions('dbUpdate', data);
        if (check) {
          if (callback) {
            callback(check);
          }
          return;
        }

        var unsetMatch = idMatch(data._id);
        var unsetUpdate = { $unset: data.data };
        if (servedByV3(data.collection)) {
          // The server's own times cannot be unset; srvModified is set.
          var unsetFields = Object.assign({}, data.data);
          delete unsetFields.srvModified;
          delete unsetFields.srvCreated;
          unsetUpdate = { $set: {} };
          srvDates.stampModified(unsetUpdate.$set);
          if (Object.keys(unsetFields).length > 0) unsetUpdate.$unset = unsetFields;
        }
        var unsetCollection = ctx.store.collection(collection);
        (unsetMatch.many
          ? unsetCollection.updateMany(unsetMatch.filter, unsetUpdate)
          : unsetCollection.updateOne(unsetMatch.filter, unsetUpdate)
        ).then(function() {
            unsetCollection.findOne(unsetMatch.filter)
              .then(function(results) {
                console.log('Got results', results);
                if (results !== null) {
                  ctx.bus.emit('data-update', {
                    type: data.collection
                    , op: 'update'
                    , changes: ctx.ddata.processRawDataForRuntime([results])
                  });
                }
              }).catch(function(err) { console.error(err); });
          }).catch(function(err) { console.error(err); });

        if (callback) {
          callback({ result: 'success' });
        }
        ctx.bus.emit('data-received', { immediate: true });
      });

      // dbAdd message
      //  {
      //    collection: treatments
      //    data: {
      //      field_1: new_value,
      //      field_2: another_value
      //    }
      //  }
      socket.on('dbAdd', function dbAdd (data, callback) {
        console.log(LOG_WS + 'dbAdd client ID: ', socket.client.id, ' data: ', data);
        var collection = supportedCollections[data.collection];
        var maxtimediff = times.secs(2).msecs;

        var check = checkConditions('dbAdd', data);
        if (check) {
          if (callback) {
            callback(check);
          }
          return;
        }

        // Sanitize free-text fields before they are persisted. REST writes
        // already do this through the storage adapters; dbAdd writes to the
        // collection directly, so without it a client with only a write
        // scope could store raw HTML/script that executes when rendered.
        try {
          ctx.purifier.purifyObject(data.data);
        } catch (err) {
          console.error(err);
          if (callback) {
            callback([]);
          }
          return;
        }

        if (data.collection === 'treatments' && !('eventType' in data.data)) {
          data.data.eventType = '<none>';
        }
        if (!('created_at' in data.data)) {
          data.data.created_at = new Date().toISOString();
        }

        // A 24-hex _id is stored as the ObjectId it names, as the v1 routes
        // store it, unless the same id is already stored as a string: then the
        // stored value is kept, so the insert collides with that record as a
        // re-sent record always has, instead of adding an ObjectId copy beside
        // it. One read, only for a record that carries a 24-hex _id. Any other
        // _id (a custom string or a number) is kept as given.
        function storeIdAsObjectId (mongoCollection, document) {
          if (!idForms.isHexId(document._id)) return Promise.resolve();
          return mongoCollection.findOne(
            { _id: { $in: idForms.stringIdForms(document._id) } }
            , { projection: { _id: 1 } }
          ).then(function (stale) {
            document._id = stale ? stale._id : idForms.toStoredId(document._id);
          });
        }

        storeIdAsObjectId(ctx.store.collection(collection), data.data).then(function () {
          processDbAdd();
        }).catch(function (err) {
          console.error(err);
          if (callback) { callback([]); }
        });

        function processDbAdd () {
        // treatments deduping
        if (data.collection === 'treatments') {
          var query;
          if (data.data.NSCLIENT_ID) {
            query = { NSCLIENT_ID: literal(data.data.NSCLIENT_ID) };
          } else {
            // created_at + eventType, with the client's identity (BF-121; see
            // treatment-fallback-key). Amounts are not added here: a socket
            // re-send after a lost reply may carry an edited amount.
            query = fallbackKey.fallbackQuery(data.data, data.data.created_at);
          }

          // try to find exact match
          // A deleted record (isValid: false) is not a copy of a new one.
          ctx.store.collection(collection).find(softDeleted.visible(query)).toArray().then(function findResult (array) {

            if (array.length > 0) {
              console.log(LOG_DEDUP + 'Exact match');
              if (callback) {
                callback([array[0]]);
              }
              return;
            }

            var baseTime = new Date(data.data.created_at).getTime();
            var query_similiar = {
              created_at: { $gte: new Date(baseTime - maxtimediff).toISOString(), $lte: new Date(baseTime + maxtimediff).toISOString() }
            };
            if (data.data.insulin) {
              query_similiar.insulin = literal(data.data.insulin);
            }
            if (data.data.carbs) {
              query_similiar.carbs = literal(data.data.carbs);
            }
            if (data.data.percent) {
              query_similiar.percent = literal(data.data.percent);
            }
            if (data.data.absolute) {
              query_similiar.absolute = literal(data.data.absolute);
            }
            if (data.data.duration) {
              query_similiar.duration = literal(data.data.duration);
            }
            if (data.data.NSCLIENT_ID) {
              query_similiar.NSCLIENT_ID = literal(data.data.NSCLIENT_ID);
            }
            // A similar record is always of the same eventType, whether or not an
            // amount was matched: a Meal Bolus with the same carbs as a Carb
            // Correction a second earlier is a second entry, not a copy (BF-121).
            query_similiar.eventType = literal(data.data.eventType);
            // try to find similiar
            ctx.store.collection(collection).find(softDeleted.visible(query_similiar)).toArray().then(function findSimiliarResult (array) {
              // if found similiar just update date. next time it will match exactly

              if (array.length > 0) {
                console.log(LOG_DEDUP + 'Found similiar', array[0]);
                array[0].created_at = data.data.created_at;
                // array[0]._id is the stored value itself, whichever form it has.
                var similarFields = { created_at: data.data.created_at };
                srvDates.stampModified(similarFields);
                array[0].srvModified = similarFields.srvModified;
                ctx.store.collection(collection).updateOne({ '_id': array[0]._id }, { $set: similarFields }).catch(function (err) { console.error(err); });
                if (callback) {
                  callback([array[0]]);
                }
                ctx.bus.emit('data-received', { immediate: true });
                return;
              }
              // if not found create new record
              console.log(LOG_DEDUP + 'Adding new record');
              // API v3 history reads these (see srv-dates).
              srvDates.stampCreated(data.data);
              ctx.store.collection(collection).insertOne(data.data).then(function insertResult (result) {

                ctx.bus.emit('data-update', {
                  type: data.collection
                  , op: 'update'
                  , changes: ctx.ddata.processRawDataForRuntime([data.data])
                });

                if (callback) {
                  callback([data.data]);
                }
                ctx.bus.emit('data-received', { immediate: true });
              }).catch(function (err) {
                console.log('treatments data insertion error: ', err.message);
              });
            }).catch(function (err) {
              console.error(err);
              callback([]);
            });
          }).catch(function (err) {
            console.error(err);
            callback([]);
          });
          // devicestatus deduping
        } else if (data.collection === 'devicestatus') {
          var queryDev;
          if (data.data.NSCLIENT_ID) {
            queryDev = { NSCLIENT_ID: data.data.NSCLIENT_ID };
          } else {
            queryDev = {
              created_at: data.data.created_at
            };
          }

          // try to find exact match; insert only when there is none
          // (a deleted record, isValid: false, is not a copy of a new one)
          ctx.store.collection(collection).find(softDeleted.visible(queryDev)).toArray().then(function findResult (array) {

            if (array.length > 0) {
              console.log(LOG_DEDUP + 'Devicestatus exact match');
              if (callback) {
                callback([array[0]]);
              }
              return;
            }

            // API v3 history reads these (see srv-dates).
            srvDates.stampCreated(data.data);
            ctx.store.collection(collection).insertOne(data.data).then(function insertResult (result) {

              ctx.bus.emit('data-update', {
                type: 'devicestatus'
                , op: 'update'
                , changes: ctx.ddata.processRawDataForRuntime([data.data])
              });

              if (callback) {
                callback([data.data]);
              }
              ctx.bus.emit('data-received', { immediate: true });
            }).catch(function (err) {
              console.log('devicestatus insertion error: ', err.message);
              if (callback) { callback([]); }
            });
          }).catch(function (err) {
            console.error(err);
            if (callback) { callback([]); }
          });
        } else {
          if (servedByV3(data.collection)) srvDates.stampCreated(data.data);
          ctx.store.collection(collection).insertOne(data.data).then(function insertResult (result) {

            ctx.bus.emit('data-update', {
              type: data.collection
              , op: 'update'
              , changes: ctx.ddata.processRawDataForRuntime([data.data])
            });

            if (callback) {
              callback([data.data]);
            }
            ctx.bus.emit('data-received', { immediate: true });
          }).catch(function (err) {
            console.log(data.collection + ' insertion error: ', err.message);
          });
        }
        } // end processDbAdd
      });
      // dbRemove message
      //  {
      //    collection: treatments
      //    _id: 'some mongo record id'
      //  }
      socket.on('dbRemove', function dbRemove (data, callback) {
        console.log(LOG_WS + 'dbRemove client ID: ', socket.client.id, ' data: ', data);
        var collection = supportedCollections[data.collection];

        var check = checkConditions('dbUpdate', data);
        if (check) {
          if (callback) {
            callback(check);
          }
          return;
        }

        var removeMatch = idMatch(data._id);
        var removeCollection = ctx.store.collection(collection);
        (removeMatch.many
          ? removeCollection.deleteMany(removeMatch.filter)
          : removeCollection.deleteOne(removeMatch.filter)
        ).then(function(stat) {
            var deletedCount = stat.deletedCount;

            ctx.bus.emit('data-update', {
              type: data.collection
              , op: 'remove'
              , count: deletedCount
              , changes: idForms.cacheRemoval(data._id, deletedCount)
            });
          }).catch(function(err) { console.error(err); });

        if (callback) {
          callback({ result: 'success' });
        }
        ctx.bus.emit('data-received', { immediate: true });
      });

      // Authorization message
      // {
      //  client: 'web' | 'phone' | 'pump'
      //  , secret: 'secret_hash'
      //  [, history : history_in_hours ]
      //  [, status : true ]
      // }
      socket.on('authorize', function authorize (message, callback) {
        const remoteIP = getRemoteIP(socket.request);
        verifyAuthorization(message, remoteIP, function verified (err, authorization) {

          if (err) {
            console.log('Websocket authorization failed:', err);
            socket.disconnect();
            return;
          }

          socket.emit('connected');

          socketAuthorization = authorization;
          clientType = message.client;
          history = message.history || 48; //default history is 48 hours

          if (socketAuthorization.read) {
            socket.join('DataReceivers');

            if (ctx.ddata && ctx.ddata.dataWithRecentStatuses) {
              let data = ctx.ddata.dataWithRecentStatuses();
              data.lastUpdated = ctx.ddata.lastUpdated;

              if (message.status) {
                data.status = status(data.profiles);
              }

              socket.emit('dataUpdate', data);
            }
          }
          // console.log(LOG_WS + 'Authetication ID: ', socket.client.id, ' client: ', clientType, ' history: ' + history);
          if (callback) {
            callback(socketAuthorization);
          }
        });
      });
    });
  }

  function update () {
    // console.log(LOG_WS + 'running websocket.update');
    if (lastData.sgvs) {
      var delta = calcData(lastData, ctx.ddata);
      if (delta.delta) {
        // console.log('lastData full size', JSON.stringify(lastData).length,'bytes');
        // if (delta.sgvs) { console.log('patientData update size', JSON.stringify(delta).length,'bytes'); }
        emitData(delta);
      }; // else { console.log('delta calculation indicates no new data is present'); }
    }
    lastData = snapshotForDelta();
  };

  start();
  listeners();

  if (ctx.storageSocket) {
    ctx.storageSocket.init(io);
  }

  if (ctx.alarmSocket) {
    ctx.alarmSocket.init(io);
  }

  return websocket();
}

module.exports = init;
