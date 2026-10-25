'use strict';

var find_options = require('./query');
var consts = require('../constants');
var purifyForStorage = require('./storage-purifier');
var countParam = require('./count');
var srvDates = require('./srv-dates');
var softDeleted = require('./soft-deleted');

function storage (collection, ctx) {
   var ObjectId = require('mongodb').ObjectId;
   var idForms = require('./object-id-forms');

  // A profile's _id is an ObjectId. Store a 24-hex string _id as the ObjectId
  // it names, as treatments do, so that save, remove and find[_id] - which all
  // look profiles up by ObjectId - find the profile that was created. The
  // v1 API refuses any other string _id with a 400; storage callers inside the
  // server (the connector's internal output) keep theirs as given.
  //
  // `storedAsString` holds the ids already stored as strings. Those keep the
  // string form, so re-sending a stored profile still collides with it on
  // insert, as it always has, instead of adding an ObjectId copy beside it.
  function normalizeProfileId (doc, storedAsString) {
    if (idForms.isHexId(doc._id) && !storedAsString.has(doc._id)) {
      doc._id = idForms.toStoredId(doc._id);
    }
  }

  async function idsStoredAsString (docs) {
    var hexIds = docs
      .map(function (doc) { return doc._id; })
      .filter(idForms.isHexId);
    if (hexIds.length === 0) return new Set();
    var stored = await api()
      .find({ _id: { $in: hexIds } }, { projection: { _id: 1 } })
      .toArray();
    return new Set(stored.map(function (doc) { return doc._id; }));
  }

  function create (obj, fn) {
    try {
      purifyForStorage(ctx, obj);
    } catch (err) {
      return fn(err, obj);
    }
    obj.created_at = (new Date( )).toISOString( );
    (async function () {
      try {
        const storedAsString = await idsStoredAsString([obj]);
        normalizeProfileId(obj, storedAsString);
        // API v3 history reads these (see srv-dates).
        srvDates.stampCreated(obj);
        await api().insertOne(obj);
      } catch (err) {
        // kept: a failed insert has always been answered with the document
      }
      fn(null, obj);
    })();
    ctx.bus.emit('data-received', { immediate: true });
  }

  function save (obj, fn) {
    try {
      purifyForStorage(ctx, obj);
    } catch (err) {
      return fn(err, obj);
    }
    // A hex or ObjectId _id names the profile to replace; anything else,
    // including a 12-character string the driver would read as raw bytes,
    // gets a new ObjectId.
    var submittedId = obj._id;
    if (obj._id instanceof ObjectId || idForms.isHexId(obj._id)) {
      obj._id = new ObjectId(obj._id);
    } else {
      obj._id = new ObjectId();
      submittedId = undefined;
    }
    if (!obj.created_at) {
      obj.created_at = (new Date( )).toISOString( );
    }
    // Match existing profiles by _id only. The profile editor rewrites created_at on save.
    // A stored profile whose _id is still the hex string is replaced by the
    // ObjectId document and then removed, so the edit leaves one profile
    // rather than adding a copy beside the original. Upserting first means
    // the profile is never absent between the two writes.
    (async function () {
      try {
        await srvDates.carryForReplace(api(), [{ filter: { _id: obj._id }, doc: obj }]);
        await api().replaceOne({ _id: obj._id }, obj, { upsert: true });
        if (submittedId !== undefined) {
          await api().deleteMany({ _id: { $in: idForms.stringIdForms(submittedId) } });
        }
      } catch (err) {
        return fn(err, obj);
      }
      fn(null, obj);
    })();
    ctx.bus.emit('data-received', { immediate: true });
  }

  function list (fn, count) {
    // A supplied `count` that is not a positive whole number of documents is
    // not a limit at all - MongoDB reads `.limit(0)` as "no limit" - so fall
    // back to the endpoint's default rather than to an unbounded read.
    // A count of zero asks for no profiles, and gets none.
    if (countParam.isZeroCount(count)) {
      return fn(null, [ ]);
    }
    const limit = (count === undefined || count === null) ? Number(consts.PROFILES_DEFAULT_COUNT)
      : countParam.parseCount(count) || Number(consts.PROFILES_DEFAULT_COUNT);
    return api( ).find(softDeleted.visible({ })).limit(limit).sort({startDate: -1, _id: -1}).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function list_query (opts, fn) {

    // `walker: {}` keeps query.js's default `date`/`sgv` numeric reading off
    // profile, which has never had it; the schema still types its fields.
    storage.queryOpts = {
      collection: 'profile'
      , walker: {}
      , dateField: 'startDate'
    };

    function limit () {
        // A count of zero answers with no documents rather than an unbounded read.
        return countParam.applyCount(this, opts);
    }

    var cursor;
    try {
      cursor = limit.call(api()
        .find(query_for(opts))
        .sort(opts && opts.sort && query_sort(opts) || { startDate: -1 }), opts);
    } catch (err) {
      // A refused query is reported to the caller instead of thrown.
      return fn(err);
    }
    return cursor
      .toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function query_for (opts) {
      var asked = opts && opts.find && opts.find._id;
      // find[_id]=<hex> comes back as an ObjectId; also match a profile
      // stored with the same id as a string.
      // Reads leave out deleted records (isValid: false; see soft-deleted).
      return softDeleted.visible(idForms.matchEitherForm(find_options(opts, storage.queryOpts), asked), opts);
  }

  function query_sort (opts) {
    if (opts && opts.sort) {
      var sortKeys = Object.keys(opts.sort);

      for (var i = 0; i < sortKeys.length; i++) {
        if (opts.sort[sortKeys[i]] == '1') {
          opts.sort[sortKeys[i]] = 1;
        }
        else {
          opts.sort[sortKeys[i]] = -1;
        }
      }
      return opts.sort;
    }
  }


  function last (fn) {
    return api().find(softDeleted.visible({ })).sort({startDate: -1, _id: -1}).limit(1).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function remove (_id, fn) {
    // Remove the profile whichever form its _id is stored in, and both forms
    // where an earlier edit left an ObjectId copy beside a string original.
    // An id that is not 24-hex matches nothing instead of throwing.
    var filter = idForms.idFilter(_id);
    api( ).deleteMany({ '_id': filter }).then(function (result) { fn(null, result); }).catch(fn);

    ctx.bus.emit('data-received', { immediate: true });
  }

  function api () {
    return ctx.store.collection(collection);
  }
  
  api.list = list;
  api.list_query = list_query;
  api.create = create;
  api.save = save;
  api.remove = remove;
  api.last = last;
  api.indexedFields = ['startDate'];
  return api;
}

module.exports = storage;
