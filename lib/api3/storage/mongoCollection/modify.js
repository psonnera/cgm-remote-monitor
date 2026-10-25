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
 * Filter that writes to the document a read by this identifier returns.
 * filterForOne can match two documents: a v1 record with no identifier whose
 * _id is the identifier, and a v3 document with that identifier (the copy a
 * v3 PUT left beside a string-_id record before either form was matched).
 * Reads sort the v3 document first; replaceOne, updateOne and deleteOne take
 * no sort, so without this they could write the v1 record instead. Of two v1
 * copies stored by _id (the string and the ObjectId it names), reads and
 * writes take the ObjectId one: BSON orders ObjectId above String, and on
 * 15.0.8 and earlier the ObjectId copy is the one an edit wrote.
 * @param {Object} col
 * @param {string} identifier
 */
function writeFilter (col, identifier) {

  const filter = utils.filterForOne(identifier);

  return col.findOne(filter, { sort: { identifier: -1, _id: -1 }, projection: { _id: 1 } })
    .then(function mongoDone (target) {
      return target ? { _id: target._id } : filter;
    });
}


/**
 * Replace single document
 * @param {Object} col
 * @param {string} identifier
 * @param {Object} doc
 */
function replaceOne (col, identifier, doc) {

  return writeFilter(col, identifier).then(function (filter) {
    return col.replaceOne(filter, doc, { upsert: true });
  }).then(function mongoDone (result) {
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

  return writeFilter(col, identifier).then(function (filter) {
    return col.updateOne(filter, { $set: setFields });
  }).then(function mongoDone (result) {
    return { updated: result.modifiedCount };
  });
}


/**
 * Permanently remove single document by identifier
 * @param {Object} col
 * @param {string} identifier
 */
function deleteOne (col, identifier) {

  return writeFilter(col, identifier).then(function (filter) {
    return col.deleteOne(filter);
  }).then(function mongoDone (result) {
    return { deleted: result.deletedCount };
  });
}


/**
 * Update every stored form of the document addressed by identifier: the v3
 * document with that identifier, a v1 record without an identifier whose _id
 * is the identifier, and both halves of such a record stored twice by _id (as
 * a string and as the ObjectId it names); see utils.filterForEveryForm. A
 * delete by identifier uses this, so it removes the record the way v1 DELETE
 * and the websocket dbRemove do, instead of leaving one form valid beside the
 * one it marked.
 * @param {Object} col
 * @param {string} identifier
 * @param {object} setFields
 */
function updateEveryForm (col, identifier, setFields) {

  return col.updateMany(utils.filterForEveryForm(identifier), { $set: setFields })
    .then(function mongoDone (result) {
      return { updated: result.modifiedCount };
    });
}


/**
 * Permanently remove every stored form of the document addressed by
 * identifier (see updateEveryForm)
 * @param {Object} col
 * @param {string} identifier
 */
function deleteEveryForm (col, identifier) {

  return col.deleteMany(utils.filterForEveryForm(identifier))
    .then(function mongoDone (result) {
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
  updateEveryForm,
  deleteEveryForm,
  deleteManyOr
};
