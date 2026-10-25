'use strict';

var purifyForStorage = require('./storage-purifier');
var quickpick = require('../food/quickpick');
var srvDates = require('./srv-dates');
var softDeleted = require('./soft-deleted');

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
    // API v3 history reads these (see srv-dates).
    srvDates.stampCreated(obj);
    api().insertOne(obj).then(function (result) {
      fn(null, [obj]);
    }).catch(function (err) {
      console.log('Data insertion error', err.message);
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
        // srvModified on the write, srvCreated kept from the record it
        // replaces (API v3 history reads them; see srv-dates).
        await srvDates.carryForReplace(api(), [{ filter: { _id: obj._id }, doc: obj }]);
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

  function list (fn) {
    // Reads leave out deleted records (isValid: false; see soft-deleted).
    return api( ).find(softDeleted.visible({ })).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function listquickpicks (fn) {
    // `hidden` and `position` have no settled type on disk (the built-in editor
    // form-encodes strings, a JSON client writes boolean/number; see
    // lib/food/quickpick.js). { hidden: 'false' } hid every JSON-written pick and
    // every record saved before the field existed; $nin also admits a missing
    // field. Sorted here, not in the query: a string sort puts '10' before '2'.
    return api( ).find({ $and: [ { 'type': 'quickpick'} , { 'hidden' : { $nin: [ true, 'true' ] } }, softDeleted.notDeleted() ] }).toArray()
      .then(function (docs) { fn(null, docs.sort(quickpick.byPosition)); }).catch(fn);
  }

  function listregular (fn) {
    return api( ).find(softDeleted.visible({ 'type': 'food'})).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function remove (_id, fn) {
    // Remove the record whichever form its _id is stored in, and both forms
    // where an earlier edit left an ObjectId copy beside a string original.
    // An id that is not 24-hex matches nothing instead of throwing.
    var filter = idForms.idFilter(_id);
    return api( ).deleteMany({ '_id': filter }).then(function (result) { fn(null, result); }).catch(fn);
  }



  function api ( ) {
    return ctx.store.collection(env.food_collection);
  }
  
  api.list = list;
  api.listquickpicks = listquickpicks;
  api.listregular = listregular;
  api.create = create;
  api.save = save;
  api.remove = remove;
  api.indexedFields = ['type','position','hidden'];
  return api;
}

module.exports = storage;
