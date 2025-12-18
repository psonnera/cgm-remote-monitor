'use strict';

const _ = require('lodash')
  , apiConst = require('../../const.json')
  , security = require('../../security')
  , insert = require('./insert')
  , replace = require('../update/replace')
  , opTools = require('../../shared/operationTools')
  ;


/**
 * CREATE: Inserts a new document into the collection
 */
async function create (opCtx) {

  const { col, req, res, ctx } = opCtx;
  const doc = req.body;

  if (_.isEmpty(doc)) {
    return opTools.sendJSONStatus(res, apiConst.HTTP.BAD_REQUEST, apiConst.MSG.HTTP_400_BAD_REQUEST_BODY);
  }

  col.parseDate(doc);
  opTools.resolveIdentifier(doc);
  
  // For CGM Sensor events in treatments collection, check for duplicates within 10 seconds
  const sensorEventTypes = ['Sensor Start', 'Sensor Change', 'Sensor Stop'];
  const isSensorEvent = col.colName === 'treatments' && sensorEventTypes.indexOf(doc.eventType) > -1;
  
  if (isSensorEvent && doc.date) {
    const tenSecondsInMs = 10000;
    const startTime = doc.date - tenSecondsInMs;
    const endTime = doc.date + tenSecondsInMs;
    
    const duplicateFilter = {
      eventType: doc.eventType,
      date: {
        $gte: startTime,
        $lte: endTime
      }
    };
    
    const duplicateResult = await col.storage.findOneFilter(duplicateFilter, { });
    
    if (duplicateResult && duplicateResult.length > 0) {
      const existingDoc = duplicateResult[0];
      console.log('APIv3: Skipping duplicate CGM Sensor event within 10 seconds', {
        eventType: doc.eventType,
        existing: new Date(existingDoc.date).toISOString(),
        new: new Date(doc.date).toISOString()
      });
      // Return the existing document as if it was just created (deduplication)
      await replace(opCtx, doc, existingDoc, { isDeduplication: true });
      return;
    }
  }
  
  const identifyingFilter = col.storage.identifyingFilter(doc.identifier, doc, col.dedupFallbackFields);

  const result = await col.storage.findOneFilter(identifyingFilter, { });

  if (!result)
    throw new Error('empty result');

  if (result.length > 0) {
    const storageDoc = result[0];
    await replace(opCtx, doc, storageDoc, { isDeduplication: true });
  }
  else {
    await insert(opCtx, doc);
  }
}


function createOperation (ctx, env, app, col) {

  return async function operation (req, res) {

    const opCtx = { app, ctx, env, col, req, res };

    try {
      opCtx.auth = await security.authenticate(opCtx);

      await create(opCtx);

    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        return opTools.sendJSONStatus(res, apiConst.HTTP.INTERNAL_ERROR, apiConst.MSG.STORAGE_ERROR);
      }
    }
  };
}

module.exports = createOperation;