'use strict;'

const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');

// this is a class for holding potentially sensitive data in the app
// the class also implement functions to use the data, so the data is not shared outside the class

const init = function init () {

  const enclave = {};
  const secrets = {};
  const apiKey = Symbol('api-secret');
  const apiKeySHA1 = Symbol('api-secretSHA1');
  const apiKeySHA512 = Symbol('api-secretSHA512');
  const jwtKey = Symbol('jwtkey');
  let apiKeySet = false;

  function readKey (filename) {
    let filePath = path.resolve(__dirname + '/../../node_modules/.cache/_ns_cache/' + filename);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath).toString().trim();
    }
    console.error('Key file ', filePath, 'not found');
    return null;
  }

  secrets[jwtKey] = readKey('randomString');

  function genHash(data, algorihtm) {
    const hash = crypto.createHash(algorihtm);
    data = hash.update(data, 'utf-8');
    return data.digest('hex').toLowerCase();
  }

  enclave.setApiKey = function setApiKey (keyValue) {
    if (keyValue.length < 12) return;
    apiKeySet = true;
    secrets[apiKey] = keyValue;
    secrets[apiKeySHA1] = genHash(keyValue,'sha1');
    secrets[apiKeySHA512] = genHash(keyValue,'sha512');
  }

  enclave.isApiKeySet = function isApiKeySet () {
    return apiKeySet;
  }

  // constant-time comparison of two hex-string hashes of equal length
  function hashEquals (candidate, expected) {
    if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
    if (candidate.length !== expected.length) return false;
    const a = Buffer.from(candidate, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  enclave.isApiKey = function isApiKey (keyValue) {
    if (typeof keyValue !== 'string') return false;
    return hashEquals(keyValue.toLowerCase(), secrets[apiKeySHA1]) || hashEquals(keyValue, secrets[apiKeySHA512]);
  }

  enclave.setJWTKey = function setJWTKey (keyValue) {
    secrets[jwtKey] = keyValue;
  }

  enclave.signJWT = function signJWT(token, lifetime) {
    const lt = lifetime ? lifetime : '8h';
    return jwt.sign(token, secrets[jwtKey], { expiresIn: lt });
  }

  enclave.verifyJWT = function verifyJWT(tokenString) {
    try {
      return jwt.verify(tokenString, secrets[jwtKey]);
    } catch(err) {
      return null;
    }    
  }

  enclave.getSubjectHash = function getSubjectHash(id) {
    var shasum = crypto.createHash('sha1');
    shasum.update(secrets[apiKeySHA1]);
    shasum.update(id);
    return shasum.digest('hex').toLowerCase();
  }

  return enclave;
}

module.exports = init;
