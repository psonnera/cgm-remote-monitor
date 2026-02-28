'use strict';

var find_options = require('./query');


function storage (env, ctx) {
   var ObjectId = require('mongodb').ObjectId;

  function create (obj, fn) {
    obj.created_at = (new Date( )).toISOString( );
    api().insertOne(obj, function (err, result) {
      if (err) {
        console.log('Activity data insertion error', err.message);
        fn(err.message, null);
        return;
      }
      fn(null, [obj]);
    });
  }

  function save (obj, fn) {
    obj._id = new ObjectId(obj._id);
    obj.created_at = (new Date( )).toISOString( );
    api().replaceOne({ _id: obj._id }, obj, { upsert: true }, function (err, result) {
      fn(err, obj);
    });
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

    // handle all the results
    function toArray (err, entries) {
      fn(err, entries);
    }

    // now just stitch them all together
    limit.call(api( )
        .find(query_for(opts))
        .sort(sort( ))
    ).toArray(toArray);
  }
  
  function remove (_id, fn) {
    var objId = new ObjectId(_id);
    return api( ).deleteOne({ '_id': objId }, fn);
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
