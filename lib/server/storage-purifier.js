'use strict';

// Storage adapters are called by more than the HTTP APIs: nightscout-connect
// and other importers write through them directly, so this is the final
// in-process boundary before a document reaches MongoDB.
function purifyForStorage (ctx, objOrArray) {
  if (!ctx.purifier || typeof ctx.purifier.purifyObject !== 'function') {
    throw new Error('Storage write purifier is not configured');
  }

  var documents = Array.isArray(objOrArray) ? objOrArray : [objOrArray];
  documents.forEach(function (document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new TypeError('Storage writes require document objects');
    }
    // Complexity / parser budgets are per document.
    ctx.purifier.purifyObject(document);
  });

  return objOrArray;
}

module.exports = purifyForStorage;
