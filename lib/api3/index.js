'use strict';

const express = require('express')
  , bodyParser = require('body-parser')
  , renderer = require('./shared/renderer')
  , storageSocket = require('./storageSocket')
  , alarmSocket = require('./alarmSocket')
  , apiConst = require('./const.json')
  , security = require('./security')
  , genericSetup = require('./generic/setup')
  , opTools = require('./shared/operationTools')
  ;

function configure (env, ctx) {

  const self = { }
    , app = express()
    ;

  self.setENVTruthy = function setENVTruthy (varName, defaultValue) {
    ...existing code...
    let value = process.env['CUSTOMCONNSTR_' + varName]
      || process.env['CUSTOMCONNSTR_' + varName.toLowerCase()]
      || process.env[varName]
      || process.env[varName.toLowerCase()];

    value = value != null ? value : defaultValue;

    if (typeof value === 'string' && (value.toLowerCase() === 'on' || value.toLowerCase() === 'true')) { value = true; }
    if (typeof value === 'string' && (value.toLowerCase() === 'off' || value.toLowerCase() === 'false')) { value = false; }

    app.set(varName, value);
    return value;
  };
  app.setENVTruthy = self.setENVTruthy;


  self.setupApiEnvironment = function setupApiEnvironment () {

    app.use(bodyParser.json({
      limit: 1048576 * 50
    }), function errorHandler (err, req, res, next) {
      console.error(err);
      res.status(apiConst.HTTP.INTERNAL_ERROR).json({
        status: apiConst.HTTP.INTERNAL_ERROR,
        message: apiConst.MSG.HTTP_500_INTERNAL_ERROR
      });
      if (next) { // we need 4th parameter next to behave like error handler, but we have to use it to prevent "unused variable" message
      }
    });

    // V3 logging middleware (DB only) - placed after bodyParser
    app.use((req, res, next) => {
      if (!app.get('DEBUG_V3')) {
        return next();
      }
      const v3Collections = ['entries', 'treatments', 'devicestatus', 'food', 'profile', 'settings'];
      const match = req.path.match(/^\/(entries|treatments|devicestatus|food|profile|settings)(?:\/|$)/);
      if (!match) return next();
      const collection = match[1];
      const eventType = req.body && req.body.eventType ? req.body.eventType : '(no eventType)';

      // Extract fields
      const method = req.method;
      const path = req.originalUrl;
      const query_params = req.query;
      const headers = Object.assign({}, req.headers);
      if (headers.authorization) headers.authorization = '[REDACTED]';
      const client_agent = headers['user-agent'] || headers['User-Agent'] || '';
      const raw_body = req.body;
      const received_at = new Date();

      // Try to extract JWT subject (if available)
      let auth_subject = '';
      if (headers.authorization && headers.authorization.startsWith('Bearer ')) {
        try {
          const jwt = headers.authorization.split(' ')[1];
          const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
          auth_subject = payload.sub || payload.user || '';
        } catch (e) {
          auth_subject = '';
        }
      }

      // Capture outgoing response
      let response_body;
      let response_status;
      const oldJson = res.json;
      res.json = function (data) {
        response_body = data;
        response_status = res.statusCode;
        return oldJson.call(this, data);
      };

      // Attach a hook to capture processing status and identifier
      let processing_status = 'unknown';
      let processed_identifier = '';
      res.on('finish', async () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          processing_status = 'accepted';
        } else if (res.statusCode === 409) {
          processing_status = 'deduplicated';
        } else if (res.statusCode >= 400) {
          processing_status = 'error';
        }
        if (res.locals && res.locals.identifier) {
          processed_identifier = res.locals.identifier;
        }
        try {
          if (ctx && ctx.store && ctx.store.db) {
            await ctx.store.db.collection('v3_raw').insertOne({
              received_at,
              collection,
              method,
              path,
              query_params,
              headers,
              auth_subject,
              client_agent,
              raw_body,
              processing_status,
              processed_identifier,
              response_status: response_status || res.statusCode,
              response_body: response_body
            });
          } else {
            console.warn('[V3_RAW] ctx.store.db not available, cannot log V3 traffic');
          }
        } catch (err) {
          console.error('Failed to log v3_raw traffic:', err);
        }
      });
      next();
    });

    app.use(renderer.extension2accept);

    // we don't need these here
    app.set('etag', false);
    app.set('x-powered-by', false); // this seems to be unreliable
    app.use(function (req, res, next) {
      res.removeHeader('x-powered-by');
      next();
    });

    app.set('name', env.name);
    app.set('version', env.version);
    app.set('apiVersion', apiConst.API3_VERSION);
    app.set('units', env.DISPLAY_UNITS);
    app.set('ci', process.env['CI'] ? true: false);
    app.set('enabledCollections', ['devicestatus', 'entries', 'food', 'profile', 'settings', 'treatments']);

    self.setENVTruthy('API3_SECURITY_ENABLE', apiConst.API3_SECURITY_ENABLE);
    self.setENVTruthy('API3_DEDUP_FALLBACK_ENABLED', apiConst.API3_DEDUP_FALLBACK_ENABLED);
    self.setENVTruthy('API3_CREATED_AT_FALLBACK_ENABLED', apiConst.API3_CREATED_AT_FALLBACK_ENABLED);
    self.setENVTruthy('API3_MAX_LIMIT', apiConst.API3_MAX_LIMIT);
    self.setENVTruthy('DEBUG_V3', false);
  };


  self.setupApiRoutes = function setupApiRoutes () {

    app.get('/version', require('./specific/version')(app, ctx, env));

    if (app.get('env') === 'development' || app.get('ci')) { // for development and testing purposes only
      app.get('/test', async function test (req, res) {

        try {
          const opCtx = {app, ctx, env, req, res};
          opCtx.auth = await security.authenticate(opCtx);
          await security.demandPermission(opCtx, 'api:entries:read');
          res.status(apiConst.HTTP.OK).end();
        } catch (error) {
          console.error(error);
        }
      });
    }

    app.get('/lastModified', require('./specific/lastModified')(app, ctx, env));

    app.get('/status', require('./specific/status')(app, ctx, env));
  };


  self.setupApiEnvironment();
  genericSetup(ctx, env, app);
  self.setupApiRoutes();

  app.use('/swagger-ui-dist', (req, res) => {
    res.redirect(307, '../../../api3-docs');
  });

  app.use((req, res) => {
    opTools.sendJSONStatus(res, apiConst.HTTP.NOT_FOUND, apiConst.MSG.HTTP_404_BAD_OPERATION);
  })

  ctx.storageSocket = new storageSocket(app, env, ctx);
  ctx.alarmSocket = new alarmSocket(app, env, ctx);

  return app;
}

module.exports = configure;
