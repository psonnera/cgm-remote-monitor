'use strict';

var find_options = require('./query');
var consts = require('../constants');

function storage (collection, ctx) {
   var ObjectId = require('mongodb').ObjectId;
   var toObjectId = require('./objectid');

  function create (obj, fn) {
    obj.created_at = (new Date( )).toISOString( );
    api().insertOne(obj)
      .then(function (result) { fn(null, obj); })
      .catch(function (err) { fn(null, obj); });
    ctx.bus.emit('data-received');
  }

  function save (obj, fn) {
    if (obj._id == null) {
      obj._id = new ObjectId();
    } else {
      var objId = toObjectId(obj._id);
      if (!objId) { return fn('Invalid id'); }
      obj._id = objId;
    }
    if (!obj.created_at) {
      obj.created_at = (new Date( )).toISOString( );
    }
    api().replaceOne({ _id: obj._id }, obj, { upsert: true })
      //id should be added for new docs
      .then(function (result) { fn(null, obj); })
      .catch(function (err) { fn(err, obj); });
    ctx.bus.emit('data-received');
  }

  function list (fn, count) {
    const limit = count !== null ? count : Number(consts.PROFILES_DEFAULT_COUNT);
    return api( ).find({ }).limit(limit).sort({startDate: -1}).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function list_query (opts, fn) {

    storage.queryOpts = {
      walker: {}
      , dateField: 'startDate'
    };

    function limit () {
        if (opts && opts.count) {
            return this.limit(parseInt(opts.count));
        }
        return this;
    }

    return limit.call(api()
      .find(query_for(opts))
      .sort(opts && opts.sort && query_sort(opts) || { startDate: -1 }), opts)
      .toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function query_for (opts) {
      var retVal = find_options(opts, storage.queryOpts);
      return retVal;
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
    return api().find().sort({startDate: -1}).limit(1).toArray().then(function (docs) { fn(null, docs); }).catch(fn);
  }

  function remove (_id, fn) {
    var objId = toObjectId(_id);
    if (!objId) { return fn('Invalid id'); }
    api( ).deleteOne({ '_id': objId }).then(function (result) { fn(null, result); }).catch(fn);

    ctx.bus.emit('data-received');
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
