'use strict';

const { MongoClient, MongoCompatibilityError } = require('mongodb');
const DRIVER_VERSION = 'mongodb ' + require('mongodb/package.json').version;

// Wire protocol versions of releases older than the driver's minimum, to name
// the release in the message.
const WIRE_VERSION_RELEASES = { 6: '3.6', 7: '4.0', 8: '4.2' };

// A server the driver will not talk to fails server selection like an
// unreachable one, but waiting will not fix it. The driver records the cause
// on the server's description as a MongoCompatibilityError (BF-182).
function incompatibleServer (err) {
  if (!err || err.name !== 'MongoServerSelectionError' || !err.reason || !err.reason.servers) {
    return null;
  }
  for (const server of err.reason.servers.values()) {
    if (server && server.error instanceof MongoCompatibilityError) {
      return server;
    }
  }
  return null;
}

function incompatibleServerMessage (server) {
  const detail = server.error.message || '';
  const match = /maximum wire version (\d+)/.exec(detail);
  const release = match && WIRE_VERSION_RELEASES[match[1]];
  const reports = match
    ? 'reports wire version ' + match[1] + (release ? ' (MongoDB ' + release + ')' : '')
    : 'was refused by the MongoDB driver';
  return 'The MongoDB server at ' + server.address + ' ' + reports +
    '. The MongoDB driver (' + DRIVER_VERSION + ') refuses it: ' + detail;
}

const mongo = {
  client: null,
  db: null,
};

function init(env, cb, forceNewConnection) {

  function maybe_connect(cb) {

    if (mongo.db != null && !forceNewConnection) {
      console.log('Reusing MongoDB connection handler');
      // If there is a valid callback, then return the Mongo-object

      if (cb && cb.call) {
        cb(null, mongo);
      }
    } else {
      if (!env.storageURI) {
        throw new Error('MongoDB connection string is missing. Please set MONGODB_URI environment variable');
      }

      console.log('Setting up new connection to MongoDB');
      const options = {
        // Connection options - useNewUrlParser and useUnifiedTopology removed (default in v4+)
      };

      const connect_with_retry = async function (i) {

        // Close the client from a previous failed attempt so its topology and
        // server-monitoring timers don't accumulate across retries.
        if (mongo.client) {
          try { await mongo.client.close(true); } catch (e) { /* ignore */ }
        }
        mongo.client = new MongoClient(env.storageURI, options);
        try {
          await mongo.client.connect();

          console.log('Successfully established connection to MongoDB');

          // db() with no name resolves the database from the connection string,
          // avoiding the private mongo.client.s internal API.
          mongo.db = mongo.client.db();

          const result = await mongo.db.command({ connectionStatus: 1 });
          const roles = result.authInfo.authenticatedUserRoles;
          if (roles && roles.length > 0 && roles[0].role == 'readAnyDatabase') {
            console.error('Mongo user is read only');
            cb(new Error('MongoDB connection is in read only mode! Go back to MongoDB configuration and check your database user has read and write access.'), null);
          }

          console.log('Mongo user role seems ok:', roles);

          // If there is a valid callback, then invoke the function to perform the callback
          if (cb && cb.call) {
            cb(null, mongo);
          }
        } catch (err) {
          if (err.message && err.message.includes('AuthenticationFailed')) {
            console.log('Authentication to Mongo failed');
            cb(new Error('MongoDB authentication failed! Double check the URL has the right username and password in MONGODB_URI.'), null);
            return;
          }

          const incompatible = incompatibleServer(err);
          if (incompatible) {
            const message = incompatibleServerMessage(incompatible);
            console.error('Unable to use MongoDB: ' + message);
            cb(new Error(message), null);
            return;
          }

          if (err.name && err.name === "MongoServerSelectionError") {
            const timeout = (i > 15) ? 60000 : i * 3000;
            console.log('Error connecting to MongoDB: %j - retrying in ' + timeout / 1000 + ' sec', err);
            setTimeout(connect_with_retry, timeout, i + 1);
            if (i == 1) cb(new Error('MongoDB connection failed! Double check the MONGODB_URI setting in Heroku.'), null);
          } else {
            cb(new Error('MONGODB_URI seems invalid: ' + err.message));
          }
        }
      };

      return connect_with_retry(1);

    }
  }

  mongo.collection = function get_collection(name) {
    return mongo.db.collection(name);
  };

  mongo.ensureIndexes = function ensureIndexes(collection, fields) {
    fields.forEach(function (field) {
      var label = (field !== null && typeof field === 'object') ? JSON.stringify(field) : field;
      console.info('ensuring index for: ' + collection.collectionName + '.' + label);
      collection.createIndex(field).catch(function (err) {
        console.error('unable to ensureIndex for: ' + collection.collectionName + '.' + label + ' - ' + err);
      });
    });
  };

  return maybe_connect(cb);
}

module.exports = init;
