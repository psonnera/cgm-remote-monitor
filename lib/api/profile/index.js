'use strict';

var consts = require('../../constants');
var sendQueryValidationError = require('../shared/query-error');

function configure (app, wares, ctx) {
    var express = require('express'),
        api = express.Router( );

    // invoke common middleware
    api.use(wares.sendJSONStatus);
    // text body types get handled as raw buffer stream
    api.use(wares.rawParser);
    // json body types get handled as parsed json
    api.use(wares.jsonParser);
    // also support url-encoded content-type
    api.use(wares.urlencodedParser);
    // text body types get handled as raw buffer stream

    api.use(ctx.authorization.isPermitted('api:profile:read'));


   /**
   * @function query_models
   * Perform the standard query logic, translating API parameters into mongo
   * db queries in a fairly regimented manner.
   * This middleware executes the query, returning the results as JSON
   */
    function query_models (req, res, next) {
        var query = req.query;

        // If "?count=" is present, use that number to decide how many to return.
        if (!query.count) {
            query.count = consts.PROFILES_DEFAULT_COUNT;
        }

        // perform the query
        ctx.profile.list_query(query, function payload(err, profiles) {
            // `err` was ignored here entirely, so a failed read answered 200
            // with an undefined body. A refused filter now says which operator
            // was refused; every other failure keeps the shape the profile
            // endpoints already use for an unreadable collection.
            if (err) {
                if (sendQueryValidationError(res, err)) return;
                return res.status(consts.HTTP_INTERNAL_ERROR)
                    .json({status: consts.HTTP_INTERNAL_ERROR, message: 'Unable to read profiles'});
            }
            return res.json(profiles);
        });
    }

    // List profiles available
    api.get('/profiles/', query_models);

    // List profiles available
    api.get('/profile/', function(req, res) {
        const limit = req.query && req.query.count ? Number(req.query.count) : consts.PROFILES_DEFAULT_COUNT;
        ctx.profile.list(function (err, attribute) {
            return res.json(attribute);
        }, limit);
    });

    // List current active record (in current state LAST record is current active)
    api.get('/profile/current', function(req, res) {
        ctx.profile.last( function(err, records) {
            // Runs inside a promise handler: reading a null `records` here would
            // end the process, so a failed read answers an error instead.
            if (err) {
                if (sendQueryValidationError(res, err)) return;
                console.error('Error reading the current profile', err);
                return res.sendJSONStatus(res, consts.HTTP_INTERNAL_ERROR, 'Internal Server Error');
            }
            return res.json(records && records.length > 0 ? records[0] : null);
        });
    });

    function config_authed (app, api, wares, ctx) {

        // create new record
        api.post('/profile/', ctx.authorization.isPermitted('api:profile:create'), function(req, res) {
            var data = req.body;
            ctx.purifier.purifyObject(data);
            ctx.profile.create(data, function (err, created) {
                if (err) {
                    res.sendJSONStatus(res, consts.HTTP_INTERNAL_ERROR, 'Mongo Error', err);
                    console.log('Error creating profile');
                    console.log(err);
                } else {
                    // MongoDB driver v4+ removed the .ops property; created is the inserted document
                    res.json(Array.isArray(created) ? created : [created]);
                    console.log('Profile created', created);
                }
            });
        });

        // update record
        api.put('/profile/', ctx.authorization.isPermitted('api:profile:update'), function(req, res) {
            var data = req.body;
            ctx.profile.save(data, function (err, created) {
                if (err) {
                    res.sendJSONStatus(res, consts.HTTP_INTERNAL_ERROR, 'Mongo Error', err);
                    console.log('Error saving profile');
                    console.log(err);
                } else {
                    res.json(created);
                    console.log('Profile saved', created);
                }

            });
        });

        api.delete('/profile/:_id', ctx.authorization.isPermitted('api:profile:delete'), function(req, res) {
          ctx.profile.remove(req.params._id, function ( ) {
            res.json({ });
          });
        });
    }

    if (app.enabled('api')) {
        config_authed(app, api, wares, ctx);
    }

    return api;
}

module.exports = configure;

