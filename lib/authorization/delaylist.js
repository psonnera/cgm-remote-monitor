'use strict';

const _ = require('lodash');

function init (env) {

  const ipDelayList = {};

  const DELAY_ON_FAIL = _.get(env, 'settings.authFailDelay') || 5000;
  const FAIL_AGE = 60000;
  const MAX_ENTRIES = 1000;

  function sweepExpired () {
    const now = Date.now();
    for (var key in ipDelayList) {
      if (ipDelayList.hasOwnProperty(key) && typeof ipDelayList[key] === 'number') {
        if (now > ipDelayList[key] + FAIL_AGE) {
          delete ipDelayList[key];
        }
      }
    }
  }

  function entryCount () {
    let count = 0;
    for (var key in ipDelayList) {
      if (ipDelayList.hasOwnProperty(key) && typeof ipDelayList[key] === 'number') count++;
    }
    return count;
  }

  ipDelayList.addFailedRequest = function addFailedRequest (ip) {
    const ipString = String(ip);
    let entry = ipDelayList[ipString];
    const now = Date.now();

    // Hard cap so a distributed scan of a public site can't grow the map
    // without bound: evict expired entries first, then the oldest one.
    if (!entry && entryCount() >= MAX_ENTRIES) {
      sweepExpired();
      if (entryCount() >= MAX_ENTRIES) {
        let oldestKey = null;
        for (var key in ipDelayList) {
          if (ipDelayList.hasOwnProperty(key) && typeof ipDelayList[key] === 'number') {
            if (oldestKey === null || ipDelayList[key] < ipDelayList[oldestKey]) {
              oldestKey = key;
            }
          }
        }
        if (oldestKey !== null) delete ipDelayList[oldestKey];
      }
    }

    if (!entry) {
      ipDelayList[ipString] = now + DELAY_ON_FAIL;
      return;
    }
    if (now >= entry) { entry = now; }
    ipDelayList[ipString] = entry + DELAY_ON_FAIL;
  };

  ipDelayList.shouldDelayRequest = function shouldDelayRequest (ip) {
    const ipString = String(ip);
    const entry = ipDelayList[ipString];
    let now = Date.now();
    if (entry) {
      if (now < entry) {
        return entry - now;
      }
    }
    return false;
  };

  ipDelayList.requestSucceeded = function requestSucceeded (ip) {
    const ipString = String(ip);
    if (ipDelayList[ipString]) {
      delete ipDelayList[ipString];
    }
  };

  // Clear items older than a minute. This must be recurring: a one-shot
  // timeout would leave the list growing for the whole process lifetime.
  const sweepTimer = setInterval(sweepExpired, 30000);
  if (sweepTimer.unref) sweepTimer.unref();

  return ipDelayList;
}

module.exports = init;
