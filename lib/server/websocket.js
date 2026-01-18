'use strict';

var times = require('../times');
var calcData = require('../data/calcdelta');
var ObjectID = require('mongodb').ObjectID;
const forwarded = require('forwarded-for');

function getRemoteIP (req) {
  const address = forwarded(req, req.headers);
  return address.ip;
}

function init (env, ctx, server) {

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
      Object.keys(io.sockets.sockets).forEach(function(s) {
        io.sockets.sockets[s].disconnect(true);
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

      socket.on('loadRetro', function loadRetro (opts, callback) {
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
            console.info('sent retroUpdate (combined data)', opts);
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

            console.log('SGV Query:', JSON.stringify(sgvQuery), 'Collection:', env.entries_collection);
            
            // Check total count and date range in the database
            ctx.store.collection(env.entries_collection).countDocuments({}, function(err, count) {
              if (!err) {
                console.log('Total entries in database:', count);
              }
            });
            
            ctx.store.collection(env.entries_collection).find({}).sort({ date: 1 }).limit(1).toArray(function(err, first) {
              if (!err && first && first.length > 0) {
                var dateField = first[0].date || first[0].mills;
                if (dateField) {
                  try {
                    console.log('Database oldest entry:', new Date(dateField).toISOString(), 'value:', dateField);
                  } catch(e) {
                    console.log('Database oldest entry value:', dateField, '(invalid date)');
                  }
                }
              }
            });
            
            ctx.store.collection(env.entries_collection).find({}).sort({ date: -1 }).limit(1).toArray(function(err, last) {
              if (!err && last && last.length > 0) {
                var dateField = last[0].date || last[0].mills;
                if (dateField) {
                  try {
                    console.log('Database newest entry:', new Date(dateField).toISOString(), 'value:', dateField);
                  } catch(e) {
                    console.log('Database newest entry value:', dateField, '(invalid date)');
                  }
                }
              }
            });
            
            // Count entries in the query range
            ctx.store.collection(env.entries_collection).countDocuments(sgvQuery, function(err, rangeCount) {
              if (!err) {
                console.log('Entries in query range:', rangeCount);
              }
            });
            
            console.log('Requested range: from', opts.from, 'to', opts.to);
            
            // Sample a few entries to see their structure
            ctx.store.collection(env.entries_collection).find({}).limit(3).toArray(function(err, samples) {
              if (!err && samples && samples.length > 0) {
                console.log('Sample entry structure:', JSON.stringify(samples[0]));
              }
            });
            
            ctx.store.collection(env.entries_collection).find(sgvQuery).sort({ date: 1 }).toArray(function(err, docs) {
              if (err) {
                console.error('loadRetro sgv query error', err);
                retroData.sgvs = [];
              } else {
                console.log('SGV Query returned', docs.length, 'entries');
                
                // Normalize data: ensure all entries have 'mills' field
                // Some databases use 'date' instead of 'mills'
                docs.forEach(function(doc) {
                  if (!doc.mills && doc.date) {
                    doc.mills = doc.date;
                  }
                });
                
                if (docs.length > 0) {
                  console.log('First returned entry:', JSON.stringify(docs[0]));
                  console.log('Last returned entry:', JSON.stringify(docs[docs.length - 1]));
                }
                retroData.sgvs = docs;
              }
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

            ctx.store.collection(env.treatments_collection).find(treatmentQuery).sort({ created_at: 1 }).toArray(function(err, docs) {
              if (err) {
                console.error('loadRetro treatments query error', err);
                retroData.treatments = [];
              } else {
                // Normalize data: ensure all treatments have 'mills' field from created_at
                docs.forEach(function(doc) {
                  if (!doc.mills && doc.created_at) {
                    doc.mills = new Date(doc.created_at).getTime();
                  }
                });
                retroData.treatments = docs;
              }
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
            ctx.store.collection(env.profile_collection).find({}).toArray(function(err, docs) {
              if (err) {
                console.error('loadRetro profile query error', err);
                retroData.profiles = [];
              } else {
                retroData.profiles = docs;
              }
              checkComplete();
            });
          } catch (e) {
            console.error('loadRetro profile handler exception', e);
            retroData.profiles = [];
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

            ctx.store.collection(env.devicestatus_collection).find(query).sort({ created_at: 1 }).toArray(function(err, docs) {
              if (err) {
                console.error('loadRetro devicestatus query error', err);
                retroData.devicestatus = [];
              } else {
                // process raw docs into runtime-ready objects
                try {
                  var processed = ctx.ddata.processRawDataForRuntime(docs);
                  retroData.devicestatus = processed;
                } catch (procErr) {
                  console.error('processing devicestatus docs failed', procErr);
                  retroData.devicestatus = [];
                }
              }
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
          console.info('sent retroUpdate (default)', opts);
        }
      });

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
        var id;
        try {
          id = new ObjectID(data._id);
        } catch (err) {
          console.error(err);
          id = new ObjectID();
        }

        ctx.store.collection(collection).update({ '_id': id }
          , { $set: data.data }
          , function(err, results) {

            if (!err) {
              ctx.store.collection(collection).findOne({ '_id': id }
                , function(err, results) {
                  console.log('Got results', results);
                  if (!err && results !== null) {
                    ctx.bus.emit('data-update', {
                      type: data.collection
                      , op: 'update'
                      , changes: ctx.ddata.processRawDataForRuntime([results])
                    });
                  }
                });
            }
          }
        );

        if (callback) {
          callback({ result: 'success' });
        }
        ctx.bus.emit('data-received');
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

        var objId = new ObjectID(data._id);
        ctx.store.collection(collection).update({ '_id': objId }, { $unset: data.data }
          , function(err, results) {

            if (!err) {
              ctx.store.collection(collection).findOne({ '_id': objId }
                , function(err, results) {
                  console.log('Got results', results);
                  if (!err && results !== null) {
                    ctx.bus.emit('data-update', {
                      type: data.collection
                      , op: 'update'
                      , changes: ctx.ddata.processRawDataForRuntime([results])
                    });
                  }
                });
            }
          });

        if (callback) {
          callback({ result: 'success' });
        }
        ctx.bus.emit('data-received');
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

        if (data.collection === 'treatments' && !('eventType' in data.data)) {
          data.data.eventType = '<none>';
        }
        if (!('created_at' in data.data)) {
          data.data.created_at = new Date().toISOString();
        }

        // treatments deduping
        if (data.collection === 'treatments') {
          var query;
          if (data.data.NSCLIENT_ID) {
            query = { NSCLIENT_ID: data.data.NSCLIENT_ID };
          } else {
            query = {
              created_at: data.data.created_at
              , eventType: data.data.eventType
            };
          }

          // try to find exact match
          ctx.store.collection(collection).find(query).toArray(function findResult (err, array) {
            if (err) {
              console.error(err);
              callback([]);
              return;
            }

            if (array.length > 0) {
              console.log(LOG_DEDUP + 'Exact match');
              if (callback) {
                callback([array[0]]);
              }
              return;
            }

            var selected = false;
            var query_similiar = {
              created_at: { $gte: new Date(new Date(data.data.created_at).getTime() - maxtimediff).toISOString(), $lte: new Date(new Date(data.data.created_at).getTime() + maxtimediff).toISOString() }
            };
            if (data.data.insulin) {
              query_similiar.insulin = data.data.insulin;
              selected = true;
            }
            if (data.data.carbs) {
              query_similiar.carbs = data.data.carbs;
              selected = true;
            }
            if (data.data.percent) {
              query_similiar.percent = data.data.percent;
              selected = true;
            }
            if (data.data.absolute) {
              query_similiar.absolute = data.data.absolute;
              selected = true;
            }
            if (data.data.duration) {
              query_similiar.duration = data.data.duration;
              selected = true;
            }
            if (data.data.NSCLIENT_ID) {
              query_similiar.NSCLIENT_ID = data.data.NSCLIENT_ID;
              selected = true;
            }
            // if none assigned add at least eventType
            if (!selected) {
              query_similiar.eventType = data.data.eventType;
            }
            // try to find similiar
            ctx.store.collection(collection).find(query_similiar).toArray(function findSimiliarResult (err, array) {
              // if found similiar just update date. next time it will match exactly

              if (err) {
                console.error(err);
                callback([]);
                return;
              }

              if (array.length > 0) {
                console.log(LOG_DEDUP + 'Found similiar', array[0]);
                array[0].created_at = data.data.created_at;
                var objId = new ObjectID(array[0]._id);
                ctx.store.collection(collection).update({ '_id': objId }, { $set: { created_at: data.data.created_at } });
                if (callback) {
                  callback([array[0]]);
                }
                ctx.bus.emit('data-received');
                return;
              }
              // if not found create new record
              console.log(LOG_DEDUP + 'Adding new record');
              ctx.store.collection(collection).insert(data.data, function insertResult (err, doc) {
                if (err != null && err.message) {
                  console.log('treatments data insertion error: ', err.message);
                  return;
                }

                ctx.bus.emit('data-update', {
                  type: data.collection
                  , op: 'update'
                  , changes: ctx.ddata.processRawDataForRuntime(doc.ops)
                });

                if (callback) {
                  callback(doc.ops);
                }
                ctx.bus.emit('data-received');
              });
            });
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

          // try to find exact match
          ctx.store.collection(collection).find(queryDev).toArray(function findResult (err, array) {
            if (err) {
              console.error(err);
              callback([]);
              return;
            }

            if (array.length > 0) {
              console.log(LOG_DEDUP + 'Devicestatus exact match');
              if (callback) {
                callback([array[0]]);
              }
              return;
            }

          });

          ctx.store.collection(collection).insert(data.data, function insertResult (err, doc) {
            if (err != null && err.message) {
              console.log('devicestatus insertion error: ', err.message);
              return;
            }

            ctx.bus.emit('data-update', {
              type: 'devicestatus'
              , op: 'update'
              , changes: ctx.ddata.processRawDataForRuntime(doc.ops)
            });

            if (callback) {
              callback(doc.ops);
            }
            ctx.bus.emit('data-received');
          });
        } else {
          ctx.store.collection(collection).insert(data.data, function insertResult (err, doc) {
            if (err != null && err.message) {
              console.log(data.collection + ' insertion error: ', err.message);
              return;
            }

            ctx.bus.emit('data-update', {
              type: data.collection
              , op: 'update'
              , changes: ctx.ddata.processRawDataForRuntime(doc.ops)
            });

            if (callback) {
              callback(doc.ops);
            }
            ctx.bus.emit('data-received');
          });
        }
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

        var objId = new ObjectID(data._id);
        ctx.store.collection(collection).remove({ '_id': objId }
          , function(err, stat) {

            if (!err) {
              ctx.bus.emit('data-update', {
                type: data.collection
                , op: 'remove'
                , count: stat.result.n
                , changes: data._id
              });

            }
          });

        if (callback) {
          callback({ result: 'success' });
        }
        ctx.bus.emit('data-received');
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

            if (lastData && lastData.dataWithRecentStatuses) {
              let data = lastData.dataWithRecentStatuses();

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
    lastData = ctx.ddata.clone();
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
