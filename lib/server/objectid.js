'use strict';

const ObjectId = require('mongodb').ObjectId;

const HEX_24 = /^[0-9a-fA-F]{24}$/;

/**
 * Safely build a Mongo ObjectId from (potentially user-supplied) input.
 * Returns a valid ObjectId, or null when the input is not a 24-char hex string.
 * Use this instead of `new ObjectId(input)` on request-facing paths so a
 * malformed id yields a clean 400 instead of a thrown BSONError / 500.
 *
 * @param {string} id
 * @returns {ObjectId|null}
 */
function toObjectId (id) {
  if (typeof id !== 'string' || !HEX_24.test(id)) {
    return null;
  }
  return new ObjectId(id);
}

module.exports = toObjectId;
module.exports.toObjectId = toObjectId;
module.exports.isValidObjectId = function isValidObjectId (id) {
  return typeof id === 'string' && HEX_24.test(id);
};
