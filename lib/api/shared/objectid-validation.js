'use strict';

// The 24-hex rule, in either case, from the one helper storage uses.
var isHexId = require('../../server/object-id-forms').isHexId;

function isValidObjectId(id) {
  if (id === undefined || id === null) {
    return true;
  }

  return isHexId(id);
}

function findInvalidId(docs) {
  for (var i = 0; i < docs.length; i++) {
    if (!isValidObjectId(docs[i]._id)) {
      return { index: i, id: docs[i]._id };
    }
  }

  return null;
}

module.exports = {
  findInvalidId: findInvalidId,
  isValidObjectId: isValidObjectId
};
