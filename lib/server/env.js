'use strict';

const _each = require('lodash/each');
const _trim = require('lodash/trim');
const _forIn = require('lodash/forIn');
const _startsWith = require('lodash/startsWith');
const _camelCase = require('lodash/camelCase');
const enclave = require('./enclave');

const mongoParser = require('mongo-url-parser');

const stringEntropy = require('fast-password-entropy')

const fs = require('fs');
const crypto = require('crypto');
const consts = require('../constants');

const env = {
  settings: require('../settings')()
};

var shadowEnv;

// Module to constrain all config and environment parsing to one spot.
// See README.md for info about all the supported ENV VARs
function config () {

  // Assume users will typo whitespaces into keys and values

  shadowEnv = {};

  Object.keys(process.env).forEach((key, index) => {
    shadowEnv[_trim(key)] = _trim(process.env[key]);
  });

  env.PORT = readENV('PORT', 1337);
  // TRUST_PROXY: unset keeps the pre-15.0.9 behaviour (forwarded headers
  // believed from any peer); see lib/server/client-ip.js for the other modes.
  env.trustProxy = readENV('TRUST_PROXY', '');
  env.HOSTNAME = readENV('HOSTNAME', null);
  env.IMPORT_CONFIG = readENV('IMPORT_CONFIG', null);
  env.static_files = readENV('NIGHTSCOUT_STATIC_FILES', '/static');
  env.debug = {
    minify: readENVTruthy('DEBUG_MINIFY', true),
    logging: readENVTruthy('DEBUG_LOGGING', false)
  };

  env.err = [];
  env.notifies = [];
  env.enclave = enclave();

  setSSL();
  setStorage();
  setAPISecret();
  setVersion();
  updateSettings();

  // BRIDGE_* compatibility can enable Connect after extended settings parsing.
  // Honor its debug override even when ENABLE only contains "bridge".
  if (readENV('CONNECT_DEBUG') !== undefined) {
    env.extendedSettings.connect = env.extendedSettings.connect || {};
    env.extendedSettings.connect.debug = readENVTruthy('CONNECT_DEBUG', false);
  }

  return env;
}

function setSSL () {
  env.SSL_KEY = readENV('SSL_KEY');
  env.SSL_CERT = readENV('SSL_CERT');
  env.SSL_CA = readENV('SSL_CA');
  env.ssl = false;
  if (env.SSL_KEY && env.SSL_CERT) {
    env.ssl = {
      key: fs.readFileSync(env.SSL_KEY)
      , cert: fs.readFileSync(env.SSL_CERT)
    };
    if (env.SSL_CA) {
      env.ca = fs.readFileSync(env.SSL_CA);
    }
  }

  env.insecureUseHttp = readENVTruthy("INSECURE_USE_HTTP", false);
  env.secureHstsHeader = readENVTruthy("SECURE_HSTS_HEADER", true);
  env.secureHstsHeaderIncludeSubdomains = readENVTruthy("SECURE_HSTS_HEADER_INCLUDESUBDOMAINS", false);
  env.secureHstsHeaderPreload = readENVTruthy("SECURE_HSTS_HEADER_PRELOAD", false);
  env.secureCsp = readENVTruthy("SECURE_CSP", false);
  env.secureCspReportOnly = readENVTruthy("SECURE_CSP_REPORT_ONLY", false);

  // Two `?count=` shapes real clients send, which API v1 reads as 15.0.8 did
  // (lib/api/index.js). Transitional compatibility defaults; switch to false
  // in a future release, when a read with either shape is refused as the
  // rest of the count rule refuses it.
  // - API_V1_COUNT_LEADING_NUMBER: `1?<text>` reads as 1 (oref0).
  // - API_V1_COUNT_ZERO_WINDOW: `count=0` reads everything in a two-sided
  //   date window, and the endpoint default without one (GluPredKit).
  env.apiV1CountLeadingNumber = readENVTruthy("API_V1_COUNT_LEADING_NUMBER", true);
  env.apiV1CountZeroWindow = readENVTruthy("API_V1_COUNT_ZERO_WINDOW", true);
}

// A little ugly, but we don't want to read the secret into a var
function setAPISecret () {
  var useSecret = (readENV('API_SECRET') && readENV('API_SECRET').length > 0);
  //TODO: should we clear API_SECRET from process env?
  env.api_secret = null;
  // if a passphrase was provided, get the hex digest to mint a single token
  if (useSecret) {
    if (readENV('API_SECRET').length < consts.MIN_PASSPHRASE_LENGTH) {
      var msg = ['API_SECRET should be at least', consts.MIN_PASSPHRASE_LENGTH, 'characters'].join(' ');
      console.error(msg);
      env.err.push({ desc: msg });
    } else {

      const apiSecret = readENV('API_SECRET');
      delete process.env.API_SECRET;

      env.enclave.setApiKey(apiSecret);
      var testresult = stringEntropy(apiSecret);

      console.log('API_SECRET has', testresult, 'bits of entropy');

      if (testresult < 60) {
        env.notifies.push({ persistent: true, title: 'Security issue', message: 'Weak API_SECRET detected. Please use a mix of small and CAPITAL letters, numbers and non-alphanumeric characters such as !#%&/ to reduce the risk of unauthorized access. The minimum length of the API_SECRET is 12 characters.' });
      }

      if (env.storageURI) {
        const parsedURL = mongoParser(env.storageURI);
        if (parsedURL.auth && parsedURL.auth.password == apiSecret) {
          env.notifies.push({ persistent: true, title: 'Security issue', message: 'MongoDB password and API_SECRET match. This is a really bad idea. Please change both and do not reuse passwords across the system.' });
        }
      }

    }
  }
}

function setVersion () {
  var software = require('../../package.json');
  env.version = software.version;
  env.name = software.name;
  
  // Set git HEAD commit hash from environment variable or saved file
  env.head = readENV('HEAD');
  if (!env.head) {
    try {
      const path = require('path');
      const commitFile = path.join(__dirname, '..', '..', 'node_modules', '.cache', '_ns_cache', 'gitCommit');
      env.head = fs.readFileSync(commitFile, 'utf8').trim();
    } catch (err) {
      env.head = 'unknown';
    }
  }
  
  // Truncate to first 7 characters (GitHub short commit format)
  if (env.head && env.head !== 'unknown' && env.head.length > 7) {
    env.head = env.head.substring(0, 7);
  }
}

function setStorage () {
  env.storageURI = readENV('STORAGE_URI') || readENV('MONGO_CONNECTION') || readENV('MONGO') || readENV('MONGOLAB_URI') || readENV('MONGODB_URI');
  env.entries_collection = readENV('ENTRIES_COLLECTION') || readENV('MONGO_COLLECTION', 'entries');
  env.authentication_collections_prefix = readENV('MONGO_AUTHENTICATION_COLLECTIONS_PREFIX', 'auth_');
  env.treatments_collection = readENV('MONGO_TREATMENTS_COLLECTION', 'treatments');
  env.profile_collection = readENV('MONGO_PROFILE_COLLECTION', 'profile');
  env.settings_collection = readENV('MONGO_SETTINGS_COLLECTION', 'settings');
  env.devicestatus_collection = readENV('MONGO_DEVICESTATUS_COLLECTION', 'devicestatus');
  // Lean precomputed IOB/COB time-series derived from devicestatus (myscout chart perf)
  env.iobcob_collection = readENV('MONGO_IOBCOB_COLLECTION', 'iobcob');
  // On first boot after this collection was introduced, the server auto-backfills
  // it from existing devicestatus docs (so no manual `node bin/backfill-iobcob.js`
  // is needed in container deploys). Set to 'false' to opt out.
  env.iobcob_autobackfill = String(readENV('MONGO_IOBCOB_AUTO_BACKFILL', 'true')).toLowerCase() !== 'false';
  env.food_collection = readENV('MONGO_FOOD_COLLECTION', 'food');
  env.activity_collection = readENV('MONGO_ACTIVITY_COLLECTION', 'activity');

  var DB = { url: null, collection: null }
    , DB_URL = DB.url ? DB.url : env.storageURI
    , DB_COLLECTION = DB.collection ? DB.collection : env.entries_collection;
  env.storageURI = DB_URL;
  env.entries_collection = DB_COLLECTION;
}

function updateSettings () {

  var envNameOverrides = {
    UNITS: 'DISPLAY_UNITS'
  };

  var envDefaultOverrides = {
    DISPLAY_UNITS: 'mg/dl'
  };

  env.settings.eachSettingAsEnv(function settingFromEnv (name) {
    var envName = envNameOverrides[name] || name;
    return readENV(envName, envDefaultOverrides[envName]);
  });

  //should always find extended settings last
  env.extendedSettings = findExtendedSettings(shadowEnv);

  if (!readENVTruthy('TREATMENTS_AUTH', true)) {
    env.settings.authDefaultRoles = env.settings.authDefaultRoles || "";
    env.settings.authDefaultRoles += ' careportal';
  }
}

function readENV (varName, defaultValue) {
  var value = shadowEnv['CUSTOMCONNSTR_' + varName] ||
    shadowEnv['CUSTOMCONNSTR_' + varName.toLowerCase()] ||
    shadowEnv[varName] ||
    shadowEnv[varName.toLowerCase()];

  if (varName == 'DISPLAY_UNITS') {
    if (value && value.toLowerCase().includes('mmol')) {
      value = 'mmol';
    } else {
      value = defaultValue;
    }
  }

  return value != null ? value : defaultValue;
}

function readENVTruthy (varName, defaultValue) {
  var value = readENV(varName, defaultValue);
  if (typeof value === 'string' && (value.toLowerCase() === 'on' || value.toLowerCase() === 'true')) { value = true; } else if (typeof value === 'string' && (value.toLowerCase() === 'off' || value.toLowerCase() === 'false')) { value = false; } else { value = defaultValue }
  return value;
}

function findExtendedSettings (envs) {
  var extended = {};

  extended.devicestatus = {};
  extended.devicestatus.advanced = true;
  extended.devicestatus.days = 1;
  if (shadowEnv['DEVICESTATUS_DAYS'] && shadowEnv['DEVICESTATUS_DAYS'] == '2') extended.devicestatus.days = 1;

  function normalizeEnv (key) {
    return key.toUpperCase().replace('CUSTOMCONNSTR_', '');
  }

  // Settings listed here stay strings and are never converted to numbers.
  //
  // The conversion below turns any value that looks numeric into a Number,
  // which is wrong for credentials and identifiers. A Dexcom account name can
  // be a phone number, and Number('+15551234567') drops the leading plus; a
  // password of 007700 loses its leading zeros; a password of 0 becomes falsy
  // and reads as unset. Each reaches the service as a different value than the
  // operator typed, and the login fails.
  //
  // Add a setting here when its value has to reach the plugin as written.
  var stringSettings = {
    connect: ['shareAccountName', 'sharePassword', 'carelinkUsername', 'carelinkPassword'
             , 'carelinkPatientUsername', 'glookoPassword', 'glookoSerialNumber'
             , 'glookoDeviceId', 'linkUpPassword', 'sourceApiSecret']
  , loop: ['apnsKeyId', 'developerTeamId']
  , bridge: ['userName', 'password']
  , mmconnect: ['userName', 'password']
  };

  function isStringSetting (plugin, setting) {
    return !!stringSettings[plugin] && stringSettings[plugin].indexOf(setting) > -1;
  }

  _each(env.settings.enable, function eachEnable (enable) {
    if (_trim(enable)) {
      _forIn(envs, function eachEnvPair (value, key) {
        var env = normalizeEnv(key);
        if (_startsWith(env, enable.toUpperCase() + '_')) {
          var split = env.indexOf('_');
          if (split > -1 && split <= env.length) {
            var exts = extended[enable] || {};
            extended[enable] = exts;
            var ext = _camelCase(env.substring(split + 1).toLowerCase());
            if (!isNaN(value) && !isStringSetting(enable, ext)) { value = Number(value); }
            if (typeof value === 'string' && (value.toLowerCase() === 'on' || value.toLowerCase() === 'true')) { value = true; }
            if (typeof value === 'string' && (value.toLowerCase() === 'off' || value.toLowerCase() === 'false')) { value = false; }
            exts[ext] = value;
          }
        }
      });
    }
  });
  return extended;
}

module.exports = config;
