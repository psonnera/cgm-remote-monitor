'use strict';

var find_options = require('./query');
var ObjectId = require('mongodb').ObjectId;
var moment = require('moment');
var purifyForStorage = require('./storage-purifier');
var countParam = require('./count');
var srvDates = require('./srv-dates');
var softDeleted = require('./soft-deleted');

// The 24-hex _id rule lives in object-id-forms.
var idForms = require('./object-id-forms');

/**********\
 * Entries
 * Encapsulate persistent storage of sgv entries.
\**********/

function storage (env, ctx) {

  // TODO: Code is a little redundant.

  // query for entries from storage
  function list (opts, fn) {
    // these functions, find, sort, and limit, are used to
    // dynamically configure the request, based on the options we've
    // been given

    // determine sort options
    function sort () {
      return opts && opts.sort || { date: -1 };
    }

    // configure the limit portion of the current query
    function limit () {
      // A count of zero answers with no documents rather than an unbounded read.
      return countParam.applyCount(this, opts);
    }

    // now just stitch them all together
    var cursor;
    try {
      cursor = limit.call(api()
        .find(query_for(opts))
        .sort(sort())
      );
    } catch (err) {
      // A refused query (operator allowlist, JavaScript guard, bad date) is
      // reported to the caller instead of escaping as a synchronous throw.
      return fn(err);
    }
    cursor.toArray().then(function (entries) { fn(null, entries); }).catch(fn);
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
    api().deleteMany(query).then(function (stat) {
      var deletedCount = stat.deletedCount;

      ctx.bus.emit('data-update', {
        type: 'entries'
        , op: 'remove'
        , count: deletedCount
        , changes: idForms.cacheRemoval(asked, deletedCount)
      });

      //TODO: this is triggering a read from Mongo, we can do better
      ctx.bus.emit('data-received');
      fn(null, stat);
    }).catch(function (err) {
      fn(err);
    });
  }

  // persist all records: batch insert the entire list, then call fn(err, result)
  function persist (docs, fn) {
    create(docs, fn);
  }

  //TODO: implement
  //function update (fn) {
  //}
  //

  // store new documents using the storage mechanism
  function create (docs, fn) {
    // Handle empty array case - call callback immediately
    if (!docs || docs.length === 0) {
      return fn(null, docs || []);
    }

    try {
      purifyForStorage(ctx, docs);
      docs.forEach(function (doc) {
        if (Object.prototype.hasOwnProperty.call(doc, 'type')
          && doc.type !== null && typeof doc.type !== 'string') {
          throw new TypeError('Entry type must be a string');
        }
      });
    } catch (err) {
      return fn(err, docs);
    }

    // Prepare all documents and build bulk operations
    var bulkOps = docs.map(function(doc) {
      // Normalize entry ID: 24-hex string becomes an ObjectId, an unusable
      // _id is dropped so the server assigns one
      normalizeEntryId(doc);

      // Normalize dates to be in UTC, store offset in utcOffset
      var _sysTime;

      if (doc.dateString) { _sysTime = moment.parseZone(doc.dateString); }
      if (!_sysTime && doc.date) { _sysTime = moment(doc.date); }
      if (!_sysTime) _sysTime = moment();

      doc.utcOffset = _sysTime.utcOffset();
      doc.sysTime = _sysTime.toISOString();
      if (doc.dateString) doc.dateString = doc.sysTime;

      // Build upsert query - sysTime+type, with a server id as fallback
      var query = upsertQueryFor(doc);

      // An _id is set only when the upsert inserts. When it matches a stored
      // entry (same sysTime and type), that entry keeps its own _id, as it
      // does for a POST without _id; writing the sent _id into the update
      // would make MongoDB refuse it whenever the stored _id differs, for
      // example an entry stored with the string form by 15.0.6 or earlier.
      // srvModified on every write, srvCreated only when the upsert inserts
      // (API v3 history reads them; see srv-dates).
      srvDates.stampModified(doc);
      var update = { $set: doc };
      if (Object.prototype.hasOwnProperty.call(doc, '_id')) {
        var fields = Object.assign({}, doc);
        delete fields._id;
        update = { $set: fields, $setOnInsert: { _id: doc._id } };
      }
      update.$setOnInsert = Object.assign({}, update.$setOnInsert, { srvCreated: doc.srvModified });
      // An entry sent again for a reading that was deleted (isValid: false)
      // stores it again, as a v1 treatment, a v3 POST and an entry after a
      // hard delete all do.
      if (!Object.prototype.hasOwnProperty.call(doc, 'isValid')) {
        update.$unset = { isValid: '' };
      }

      return {
        updateOne: {
          filter: query,
          update: update,
          upsert: true
        }
      };
    });

    // An entry that updated a stored one (same sysTime and type) is answered
    // with the stored entry's _id, not the _id it was sent with or none, so
    // every item in the response names the record it is stored as. One read
    // for the whole batch, and only when some entry matched.
    async function assignStoredIds (ops, upsertedIds) {
      var matched = [];
      ops.forEach(function (op, index) {
        var filter = op.updateOne.filter;
        if (!Object.prototype.hasOwnProperty.call(upsertedIds, index) && filter.sysTime && filter.type) {
          matched.push(index);
        }
      });
      if (matched.length === 0) return;

      var key = function (sysTime, type) { return sysTime + '\u0000' + type; };
      var stored = await api().find(
        { $or: matched.map(function (index) { return ops[index].updateOne.filter; }) }
        , { projection: { _id: 1, sysTime: 1, type: 1 } }
      ).toArray();
      var byKey = {};
      stored.forEach(function (entry) { byKey[key(entry.sysTime, entry.type)] = entry._id; });
      matched.forEach(function (index) {
        var filter = ops[index].updateOne.filter;
        var id = byKey[key(filter.sysTime.$eq, filter.type.$eq)];
        if (id !== undefined) docs[index]._id = id;
      });
    }

    (async function () {
      var bulkResult;

      try {
        // Use bulkWrite for batch upsert
        bulkResult = await api().bulkWrite(bulkOps, { ordered: true });
      } catch (err) {
        console.error('Problem upserting entries batch', err);
        return fn(err, docs);
      }

      // Assign _ids from upserted results (driver 6: upsertedIds maps the
      // operation index to the ObjectId itself)
      var upserted = (bulkResult && bulkResult.upsertedIds) || {};
      Object.keys(upserted).forEach(function(index) {
        docs[index]._id = upserted[index];
        docs[index].srvCreated = docs[index].srvModified;
      });

      try {
        await assignStoredIds(bulkOps, upserted);
      } catch (err) {
        // The entries are stored; a failed read-back leaves their _id as sent.
        console.error('Problem reading back stored entry ids', err);
      }

      ctx.bus.emit('data-update', {
        type: 'entries'
        , op: 'update'
        , changes: ctx.ddata.processRawDataForRuntime(docs)
      });

      //TODO: this is triggering a read from Mongo, we can do better
      ctx.bus.emit('data-received');
      fn(null, docs);
    })();
  }

  function getEntry (id, fn) {
    // 15.0.6 and earlier stored a 24-hex _id as the string itself; match
    // an entry stored either way. Anything that is not a 24-hex id matches
    // nothing instead of throwing a BSONError.
    var filter = idForms.isHexId(id) ? { $in: idForms.idForms(id) } : { $eq: id };
    api().findOne(softDeleted.visible({ "_id": filter })).then(function (entry) {
      fn(null, entry);
    }).catch(function (err) {
      fn(err);
    });
  }

  // Reads leave out deleted records (isValid: false; see soft-deleted).
  function query_for (opts) {
    return softDeleted.visible(stored_query_for(opts), opts);
  }

  // Every stored record the query names, deleted or not: what DELETE removes.
  function stored_query_for (opts) {
    var asked = opts && opts.find && opts.find._id;
    // find[_id]=<hex> (also used by DELETE /entries/:id) comes back as an
    // ObjectId; also match an entry stored with the same id as a string, as
    // 15.0.6 and earlier stored a 24-hex _id.
    return idForms.matchEitherForm(find_options(opts, storage.queryOpts), asked);
  }

  /**
   * Build upsert query for entry.
   *
   * For CGM entries, sysTime+type is ALWAYS the primary dedup key.
   * This ensures only one SGV reading per timestamp, regardless of source.
   */
  function upsertQueryFor (doc) {
    // Always strip non-ObjectId _id to avoid "immutable field '_id'" error
    if (doc._id && typeof doc._id === 'string' && !idForms.isHexId(doc._id)) {
      delete doc._id;
    }

    // Standard CGM dedup: sysTime + type (one reading per timestamp per type)
    if (doc.sysTime && doc.type) {
      return { sysTime: { $eq: doc.sysTime }, type: { $eq: doc.type } };
    }
    // Never use the submitted document itself as a MongoDB selector. A fresh
    // server id makes the fallback an insert-only upsert and prevents nested
    // values such as {$ne: null} from becoming query operators.
    if (!(doc._id instanceof ObjectId)) {
      doc._id = new ObjectId();
    }
    return { _id: { $eq: doc._id } };
  }

  /**
   * Normalize entry ID: a 24-hex string _id becomes the ObjectId it names;
   * an _id that is not a usable id is dropped so the server assigns one
   * (myscout has no UUID_HANDLING, so a UUID _id is not moved to `identifier`).
   */
  function normalizeEntryId (doc) {
    idForms.dropEmptyId(doc);
    if (typeof doc._id === 'string' && !idForms.isHexId(doc._id)) {
      // Non-ObjectId string in _id: delete so the server generates an ObjectId
      delete doc._id;
    } else if (Object.prototype.hasOwnProperty.call(doc, '_id') && doc._id !== null && doc._id !== '') {
      // Convert valid ObjectId strings to ObjectId objects
      doc._id = idForms.toStoredId(doc._id);
    }
  }

  // closure to represent the API
  function api () {
    // obtain handle usable for querying the collection associated
    // with these records
    return ctx.store.collection(env.entries_collection);
  }

  // Expose all the useful functions
  api.list = list;
  api.create = create;
  api.remove = remove;
  api.persist = persist;
  api.query_for = query_for;
  api.getEntry = getEntry;
  api.aggregate = require('./aggregate')({}, api);
  api.indexedFields = [
    'date'
    , 'type'
    , 'sgv'
    , 'mbg'
    , 'sysTime'
    , 'dateString'
    , 'identifier'  // Client sync identity (API v3)
    , { 'type': 1, 'date': -1, 'dateString': 1 }
    // API v3 parseSort always appends identifier/created_at/date as
    // tiebreakers; without a compound index Mongo falls back to a
    // COLLSCAN + in-memory sort for "latest N" queries.
    , { 'date': -1, 'identifier': -1, 'created_at': -1, '_id': -1 }
 ];
  return api;
}

storage.queryOpts = {
  // Field types (date, sgv, mbg, filtered, unfiltered, rssi, noise, ...) come
  // from the entries schema (lib/server/query-coercion.json), so numeric
  // bounds are read as numbers without truncation.
  collection: 'entries'
  , useEpoch: true
};

// expose module
storage.storage = storage;
module.exports = storage;
