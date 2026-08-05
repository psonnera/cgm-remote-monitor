'use strict';

const apiConst = require('../../const.json')
  , security = require('../../security')
  , validate = require('./validate.js')
  , path = require('path')
  , opTools = require('../../shared/operationTools')
  ;
const times = require('../../../times');

/**
 * Insert new document into the collection
 * @param {Object} opCtx
 * @param {Object} doc
 */
async function insert (opCtx, doc) {

  const { ctx, auth, col, req, res } = opCtx;

  await security.demandPermission(opCtx, `api:${col.colName}:create`);

  if (validate(opCtx, doc) !== true)
    return;

  const now = new Date;
  doc.srvModified = now.getTime();
  doc.srvCreated = doc.srvModified;

  if (auth && auth.subject && auth.subject.name) {
    doc.subject = auth.subject.name;
  }

  // Ensure time/duration fields exist so a freshly created document carries
  // `mills` and related derived fields from the start. This mirrors
  // runtime normalization in `lib/data/ddata.js` but persists the values
  // on create operations handled by the API v3 create endpoint.
  try {
    if (!Object.prototype.hasOwnProperty.call(doc, 'mills')) {
      if (Object.prototype.hasOwnProperty.call(doc, 'created_at')) {
        doc.mills = new Date(doc.created_at).getTime();
      } else if (Object.prototype.hasOwnProperty.call(doc, 'date')) {
        if (typeof doc.date === 'number') doc.mills = doc.date; else doc.mills = new Date(doc.date).getTime();
      }
    }

    if ((!Object.prototype.hasOwnProperty.call(doc, 'endmills') || doc.endmills == null) && Object.prototype.hasOwnProperty.call(doc, 'mills')) {
      if (Object.prototype.hasOwnProperty.call(doc, 'durationInMilliseconds')) {
        const dim = Number(doc.durationInMilliseconds) || 0;
        if (dim > 0) doc.endmills = Number(doc.mills) + dim;
      } else if (Object.prototype.hasOwnProperty.call(doc, 'duration')) {
        doc.endmills = Number(doc.mills) + times.mins(Number(doc.duration) || 0).msecs;
      }
    }

    if (Object.prototype.hasOwnProperty.call(doc, 'mills') && Object.prototype.hasOwnProperty.call(doc, 'endmills')) {
      const mills = Number(doc.mills) || 0;
      const endmills = Number(doc.endmills) || 0;
      if (endmills >= mills) {
        doc.durationInMilliseconds = endmills - mills;
        doc.duration = Math.round((doc.durationInMilliseconds || 0) / 60000);
      }
    }
  } catch (e) {
    // tolerate normalization errors and proceed with insert
  }

  const identifier = await col.storage.insertOne(doc);

  if (!identifier)
    throw new Error('empty identifier');

  res.setHeader('Last-Modified', now.toUTCString());
  res.setHeader('Location', path.posix.join(req.baseUrl, req.path, identifier));


  const fields = {
    identifier: identifier,
    lastModified: now.getTime()
  };
  opTools.sendJSON({ res, status: apiConst.HTTP.CREATED, fields: fields });

  ctx.bus.emit('storage-socket-create', { colName: col.colName, doc });
  col.autoPrune();
  ctx.bus.emit('data-received');
}


module.exports = insert;
