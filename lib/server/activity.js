'use strict';

var find_options = require('./query');


function storage (env, ctx) {
   var ObjectId = require('mongodb').ObjectId;
   var toObjectId = require('./objectid');

  function create (obj, fn) {
    obj.created_at = (new Date( )).toISOString( );
    api().insertOne(obj).then(function (result) {
      fn(null, [obj]);
    }).catch(function (err) {
      console.log('Activity data insertion error', err.message);
      fn(err.message, null);
    });
  }

  function save (obj, fn) {
    if (obj._id == null) {
      obj._id = new ObjectId();
    } else {
      var objId = toObjectId(obj._id);
      if (!objId) { return fn('Invalid id'); }
      obj._id = objId;
    }
    obj.created_at = (new Date( )).toISOString( );
    api().replaceOne({ _id: obj._id }, obj, { upsert: true })
      .then(function (result) { fn(null, obj); })
      .catch(function (err) { fn(err, obj); });
  }

  function query_for (opts) {
    return find_options(opts, storage.queryOpts);
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
      if (opts && opts.count) {
        return this.limit(parseInt(opts.count));
      }
      return this;
    }

    // now just stitch them all together
    limit.call(api( )
        .find(query_for(opts))
        .sort(sort( ))
    ).toArray().then(function (entries) { fn(null, entries); }).catch(fn);
  }

  function remove (_id, fn) {
    var objId = toObjectId(_id);
    if (!objId) { return fn('Invalid id'); }
    return api( ).deleteOne({ '_id': objId }).then(function (result) { fn(null, result); }).catch(fn);
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
  dateField: 'created_at'
};
