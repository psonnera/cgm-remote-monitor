'use strict';

const consts = require('../constants');

function configure (ctx) {
  const express = require('express')
    , api = express.Router();

  function requireAdmin (req, res, callback) {
    ctx.authorization.resolveWithRequest(req, function resolved (err, result) {
      if (err || !ctx.authorization.checkMultiple('*:*:admin', result.shiros)) {
        return res.sendJSONStatus(res, consts.HTTP_UNAUTHORIZED, 'Unauthorized', 'admin permission required');
      }
      callback();
    });
  }

  api.get('/memory', function (req, res) {
    requireAdmin(req, res, function () {
      if (req.query.gc === 'true') {
        ctx.memmon.gc();
      }
      res.sendJSONStatus(res, consts.HTTP_OK, ctx.memmon.snapshot());
    });
  });

  api.post('/memory/heapsnapshot', function (req, res) {
    requireAdmin(req, res, function () {
      try {
        // Written to MEMORY_SNAPSHOT_DIR, not streamed: snapshots are tens of
        // MB and are meant to be pulled via a mounted volume or docker cp.
        res.sendJSONStatus(res, consts.HTTP_OK, ctx.memmon.writeHeapSnapshot());
      } catch (e) {
        res.sendJSONStatus(res, consts.HTTP_INTERNAL_ERROR, 'Error', e.message);
      }
    });
  });

  return api;
}

module.exports = configure;
