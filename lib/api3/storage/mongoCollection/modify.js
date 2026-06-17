'use strict';

const utils = require('./utils')
  ;

/**
 * Insert single document
 * @param {Object} col
 * @param {Object} doc
 * @param {Object} options
 */
function insertOne (col, doc, options) {

  return col.insertOne(doc).then(function mongoDone (result) {
    const identifier = doc.identifier || result.insertedId.toString();

    if (!options || options.normalize !== false) {
      delete doc._id;
    }
    return identifier;
  });
}


/**
 * Replace single document
 * @param {Object} col
 * @param {string} identifier
 * @param {Object} doc
 */
function replaceOne (col, identifier, doc) {

  const filter = utils.filterForOne(identifier);

  return col.replaceOne(filter, doc, { upsert: true }).then(function mongoDone (result) {
    return result.matchedCount;
  });
}


/**
 * Update single document by identifier
 * @param {Object} col
 * @param {string} identifier
 * @param {object} setFields
 */
function updateOne (col, identifier, setFields) {

  const filter = utils.filterForOne(identifier);

  return col.updateOne(filter, { $set: setFields }).then(function mongoDone (result) {
    return { updated: result.modifiedCount };
  });
}


/**
 * Permanently remove single document by identifier
 * @param {Object} col
 * @param {string} identifier
 */
function deleteOne (col, identifier) {

  const filter = utils.filterForOne(identifier);

  return col.deleteOne(filter).then(function mongoDone (result) {
    return { deleted: result.deletedCount };
  });
}


/**
 * Permanently remove many documents matching any of filtering criteria
 */
function deleteManyOr (col, filterDef) {

  const filter = utils.parseFilter(filterDef, 'or');

  return col.deleteMany(filter).then(function mongoDone (result) {
    return { deleted: result.deletedCount };
  });
}


module.exports = {
  insertOne,
  replaceOne,
  updateOne,
  deleteOne,
  deleteManyOr
};
