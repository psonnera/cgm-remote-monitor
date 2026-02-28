'use strict';

function storage (env, ctx) {
   var ObjectId = require('mongodb').ObjectId;

  function create (obj, fn) {
    obj.created_at = (new Date( )).toISOString( );
    api().insertOne(obj, function (err, result) {
      if (err) {
        console.log('Data insertion error', err.message);
        fn(err.message, null);
        return;
      }
      fn(null, [obj]);
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
    api().replaceOne({ _id: obj._id }, obj, { upsert: true }, function (err, result) {
      fn(err, obj);
    });
  }

  function list (fn) {
    return api( ).find({ }).toArray(fn);
  }
  
  function listquickpicks (fn) {
    return api( ).find({ $and: [ { 'type': 'quickpick'} , { 'hidden' : 'false' } ] }).sort({'position': 1}).toArray(fn);
  }
  
  function listregular (fn) {
    return api( ).find( { 'type': 'food'} ).toArray(fn);
  }
  
  function remove (_id, fn) {
    var objId = new ObjectId(_id);
    return api( ).deleteOne({ '_id': objId }, fn);
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
