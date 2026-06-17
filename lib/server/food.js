'use strict';

function storage (env, ctx) {
   var ObjectId = require('mongodb').ObjectId;
   var toObjectId = require('./objectid');

  function create (obj, fn) {
    obj.created_at = (new Date( )).toISOString( );
    api().insertOne(obj).then(function (result) {
      fn(null, [obj]);
    }).catch(function (err) {
      console.log('Data insertion error', err.message);
      fn(err.message, null);
    });
  }

  function save (obj, fn) {
    try {
      obj._id = new ObjectId(obj._id);
    } catch (err){
      console.error(err);
      obj._id = new ObjectId();
    }
    obj.created_at = (new Date( )).toISOString( );
    api().replaceOne({ _id: obj._id }, obj, { upsert: true })
      .then(function (result) { fn(null, obj); })
      .catch(function (err) { fn(err, obj); });
  }

  function list (fn) {
    return api( ).find({ }).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function listquickpicks (fn) {
    return api( ).find({ $and: [ { 'type': 'quickpick'} , { 'hidden' : 'false' } ] }).sort({'position': 1}).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function listregular (fn) {
    return api( ).find( { 'type': 'food'} ).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function remove (_id, fn) {
    var objId = toObjectId(_id);
    if (!objId) { return fn('Invalid id'); }
    return api( ).deleteOne({ '_id': objId }).then(function (result) { fn(null, result); }).catch(fn);
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
