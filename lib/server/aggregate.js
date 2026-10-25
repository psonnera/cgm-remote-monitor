var assertNoQueryJavascript = require('../storage/assert-no-query-javascript');

// BF-70. `opts` here is the caller's parsed query string -- count_records in
// lib/api/entries/index.js passes req.query straight through -- so
// `opts.pipeline` let a caller of GET /api/v1/count/:storage/where splice
// arbitrary AGGREGATION stages into the pipeline this module runs. That is a
// wider surface than the `find` filter by a long way: aggregation carries
// $lookup, which reads a collection the endpoint is not about.
//
// No caller in this tree supplies one. `conf.pipeline` is `{}` at all three
// construction sites (entries, treatments, devicestatus), `opts.pipeline` is
// documented nowhere and is named in neither swagger file. It is refused
// rather than dropped silently so that anyone who was relying on it is told,
// instead of quietly getting a different answer.
function refusePipeline ( ) {
  var error = new Error('The pipeline parameter is not supported by the Nightscout API v1. '
    + 'Use find[...] to filter the records a count is taken over.');
  error.name = 'MongoQueryValidationError';
  error.status = error.statusCode = 400;
  throw error;
}

function create (conf, api) {

  var template = function ( ) {
    return [
        {
          $group: {
            _id: null
          , count: { $sum: 1 }
          }
        }
      ];
  };

  // var collection = api( );
  function aggregate (opts, done) {
    var query;
    try {
      if (opts && opts.pipeline !== undefined) { refusePipeline(); }

      // Build the filter with the collection's own `query_for`, so that counting
      // and listing can never disagree about the date field or the value types.
      query = api.query_for(opts);
    } catch (err) {
      return done(err);
    }

    var pipeline = (conf.pipeline || [ ]);
    var groupBy = [ {$match: query } ].concat(pipeline).concat(template( ));
    // conf.pipeline is set by whoever constructs this module rather than by a
    // request, so this is a backstop rather than the guard; it costs one walk
    // of a three-stage array.
    try {
      assertNoQueryJavascript(groupBy);
    } catch (err) {
      return done(err);
    }
    api( ).aggregate(groupBy).toArray().then(function (result) {
      done(null, result);
    }).catch(done);
  }

  return aggregate;

}

module.exports = create;

