'use strict';

var find_options = require('./query');
var purifyForStorage = require('./storage-purifier');
var countParam = require('./count');


function storage (env, ctx) {
   var ObjectId = require('mongodb').ObjectId;
   var idForms = require('./object-id-forms');

  function create (obj, fn) {
    try {
      purifyForStorage(ctx, obj);
    } catch (err) {
      return fn(err.message, null);
    }
    obj.created_at = (new Date( )).toISOString( );
    // Store a 24-hex string _id as the ObjectId it names, as treatments do,
    // so PUT, DELETE and find[_id] find the record that was created.
    idForms.dropEmptyId(obj);
    obj._id = idForms.toStoredId(obj._id);
    if (obj._id === undefined) delete obj._id;
    api().insertOne(obj).then(function (result) {
      fn(null, [obj]);
    }).catch(function (err) {
      console.log('Activity data insertion error', err.message);
      fn(err.message, null);
    });
  }

  function save (obj, fn) {
    try {
      purifyForStorage(ctx, obj);
    } catch (err) {
      return fn(err, obj);
    }
    // A hex or ObjectId _id names the record to replace; anything else,
    // including a 12-character string the driver would read as raw bytes,
    // gets a new ObjectId.
    var stale = idForms.staleStringForms([obj._id]);
    if (obj._id instanceof ObjectId || idForms.isHexId(obj._id)) {
      obj._id = new ObjectId(obj._id);
    } else {
      obj._id = new ObjectId();
    }
    obj.created_at = (new Date( )).toISOString( );
    (async function () {
      try {
        await api().replaceOne({ _id: obj._id }, obj, { upsert: true });
        // A stored record whose _id is still the hex string is replaced by
        // the ObjectId document and then removed, so the edit leaves one
        // record rather than adding a copy beside the original.
        if (stale.length > 0) {
          await api().deleteMany({ _id: { $in: stale } });
        }
      } catch (err) {
        return fn(err, obj);
      }
      fn(null, obj);
    })();
  }

  function query_for (opts) {
    var asked = opts && opts.find && opts.find._id;
    // find[_id]=<hex> comes back as an ObjectId; also match a record stored
    // with the same id as a string.
    return idForms.matchEitherForm(find_options(opts, storage.queryOpts), asked);
  }

  function list(opts, fn) {
    // these functions, find, sort, and limit, are used to
    // dynamically configure the request, based on the options we've
    // been given

    // determine sort options
    function sort ( ) {
      return opts && opts.sort || {created_at: -1};
    }

    // configure the limit portion of the current query
    function limit ( ) {
      // A count of zero answers with no documents rather than an unbounded read.
      return countParam.applyCount(this, opts);
    }

    // now just stitch them all together
    var cursor;
    try {
      cursor = limit.call(api( )
          .find(query_for(opts))
          .sort(sort( ))
      );
    } catch (err) {
      // A refused query is reported to the caller instead of thrown.
      return fn(err);
    }
    cursor.toArray().then(function (entries) { fn(null, entries); }).catch(fn);
  }

  function remove (_id, fn) {
    // Remove the record whichever form its _id is stored in, and both forms
    // where an earlier edit left an ObjectId copy beside a string original.
    // An id that is not 24-hex matches nothing instead of throwing.
    var filter = idForms.idFilter(_id);
    return api( ).deleteMany({ '_id': filter }).then(function (result) { fn(null, result); }).catch(fn);
  }

  function api ( ) {
    return ctx.store.collection(env.activity_collection);
  }
  
  api.list = list;
  api.create = create;
  api.query_for = query_for;
  api.save = save;
  api.remove = remove;
  api.indexedFields = ['created_at'];
  return api;
}

module.exports = storage;

storage.queryOpts = {
  // The activity schema declares neither `date` nor `sgv`, so both keep the
  // numeric default reading (see query.js legacyNumericDefaults).
  collection: 'activity'
  , dateField: 'created_at'
};
