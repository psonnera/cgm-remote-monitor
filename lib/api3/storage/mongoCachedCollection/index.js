'use strict';

const _ = require('lodash')

/**
 * Storage implementation which wraps mongo baseStorage with caching
 * @param {Object} ctx
 * @param {Object} env
 * @param {string} colName - name of the collection in mongo database
 * @param {Object} baseStorage - wrapped mongo storage implementation
 */
function MongoCachedCollection (ctx, env, colName, baseStorage) {

  const self = this;

  self.colName = colName;

  self.identifyingFilter = baseStorage.identifyingFilter;

  self.findOne = (...args) => baseStorage.findOne(...args);

  self.findOneFilter = (...args) => baseStorage.findOneFilter(...args);

  self.findMany = (...args) => baseStorage.findMany(...args);


  self.insertOne = async (doc) => {
    const result = await baseStorage.insertOne(doc, { normalize: false });

    if (cacheSupported()) {
      updateInCache([doc]);
    }

    if (doc._id) {
      delete doc._id;
    }
    return result;
  }


  self.replaceOne = async (identifier, doc) => {
    const result = await baseStorage.replaceOne(identifier, doc);

    if (cacheSupported()) {
      const rawDocs = await baseStorage.findOne(identifier, null, { normalize: false })
      updateInCache([rawDocs[0]])
    }

    return result;
  }


  self.updateOne = async (identifier, setFields) => {
    const result = await baseStorage.updateOne(identifier, setFields);

    if (cacheSupported()) {
      const rawDocs = await baseStorage.findOne(identifier, null, { normalize: false })

      if (rawDocs[0].isValid === false) {
        deleteInCache(rawDocs)
      }
      else {
        updateInCache([rawDocs[0]])
      }
    }

    return result;
  }

  self.deleteOne = async (identifier) => {
    let invalidateDocs
    if (cacheSupported()) {
      invalidateDocs = await baseStorage.findOne(identifier, { _id: 1 }, { normalize: false })
    }

    const result = await baseStorage.deleteOne(identifier);

    if (cacheSupported()) {
      deleteInCache(invalidateDocs)
    }

    return result;
  }

  self.deleteManyOr = async (filter) => {
    let invalidateDocs
    if (cacheSupported()) {
      invalidateDocs = await baseStorage.findMany({ filter,
        limit: 1000,
        skip: 0,
        projection: { _id: 1 },
        options: { normalize: false } });
    }

    const result = await baseStorage.deleteManyOr(filter);

    if (cacheSupported()) {
      deleteInCache(invalidateDocs)
    }

    return result;
  }

  self.version = (...args) => baseStorage.version(...args);

  self.getLastModified = (...args) => baseStorage.getLastModified(...args);

  function cacheSupported () {
    return ctx.cache
      && ctx.cache[colName]
      && _.isArray(ctx.cache[colName]);
  }

  function updateInCache (doc) {
    if (doc && doc.isValid === false) {
      deleteInCache([doc._id])
    }
    else {
      // Normalize (mills/endmills/duration, stringified _id) before the doc
      // enters the runtime cache, matching what every API v1 producer and the
      // dataloader do. processRawDataForRuntime deep-clones, so the cache gets
      // its own copy, decoupled from the raw doc that insertOne mutates.
      const changes = (ctx.ddata && typeof ctx.ddata.processRawDataForRuntime === 'function')
        ? ctx.ddata.processRawDataForRuntime(doc)
        : doc;
      ctx.bus.emit('data-update', {
        type: colName
        , op: 'update'
        , changes
      });
    }
  }

  function deleteInCache (docs) {
    let changes
    if (_.isArray(docs)) {
      if (docs.length === 0) {
        return
      }
      else if (docs.length === 1 && docs[0]._id) {
        const _id = docs[0]._id.toString()
        changes = [ _id ]
      }
    }

    ctx.bus.emit('data-update', {
      type: colName
      , op: 'remove'
      , changes
    });
  }
}

module.exports = MongoCachedCollection;
