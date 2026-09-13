'use strict';

const PURIFIED_COLLECTIONS = [
  'devicestatus',
  'entries',
  'food',
  'profile',
  'treatments'
];

function shouldPurifyCollection (colName) {
  return PURIFIED_COLLECTIONS.indexOf(colName) !== -1;
}

/**
 * Apply the server-side purifier to an API v3 write body before persistence,
 * so create / replace / upsert / patch match the v1 REST and WebSocket paths.
 */
function purifyWritableDocument (opCtx, doc) {
  const { ctx, col } = opCtx;

  if (!doc || typeof doc !== 'object' || !shouldPurifyCollection(col.colName)) {
    return doc;
  }

  if (!ctx.purifier || typeof ctx.purifier.purifyObject !== 'function') {
    throw new Error('APIv3 write purifier is not configured');
  }

  return ctx.purifier.purifyObject(doc);
}

module.exports = {
  purifyWritableDocument,
  shouldPurifyCollection
};
