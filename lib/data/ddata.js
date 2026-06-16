'use strict';

var _ = require('lodash');
var times = require('../times');
var consts = require('../constants');

var DEVICE_TYPE_FIELDS = ['uploader', 'pump', 'openaps', 'loop', 'xdripjs'];

function init () {

  var ddata = {
    sgvs: []
    , treatments: []
    , mbgs: []
    , cals: []
    , profiles: []
    , devicestatus: []
    , food: []
    , activity: []
    , dbstats: {}
    , lastUpdated: 0
  };

  /**
   * Convert Mongo ids to strings and ensure all objects have the mills property for
   * significantly faster processing than constant date parsing, plus simplified
   * logic
   */
  ddata.processRawDataForRuntime = (data) => {

    let obj = _.cloneDeep(data);

    Object.keys(obj).forEach(key => {
      if (typeof obj[key] === 'object' && obj[key]) {
        if (Object.prototype.hasOwnProperty.call(obj[key], '_id')) {
          obj[key]._id = obj[key]._id.toString();
        }
        // Normalize timestamp fields to a numeric `mills` property so downstream
        // logic (sorting, dedupe) can rely on a single source of truth.
        if (!Object.prototype.hasOwnProperty.call(obj[key], 'mills')) {
          if (Object.prototype.hasOwnProperty.call(obj[key], 'created_at')) {
            obj[key].mills = new Date(obj[key].created_at).getTime();
          } else if (Object.prototype.hasOwnProperty.call(obj[key], 'sysTime')) {
            obj[key].mills = new Date(obj[key].sysTime).getTime();
          } else if (Object.prototype.hasOwnProperty.call(obj[key], 'date')) {
            // API v3 may supply `date` as a numeric epoch or string. Prefer numeric.
            if (typeof obj[key].date === 'number') {
              obj[key].mills = obj[key].date;
            } else {
              obj[key].mills = new Date(obj[key].date).getTime();
            }
          }
        }

        // Normalize duration fields: if durationInMilliseconds is provided but
        // duration (in minutes) is missing, derive it. Also compute endmills
        // when possible to make client-side code consistent.
        if (Object.prototype.hasOwnProperty.call(obj[key], 'durationInMilliseconds')
            && !Object.prototype.hasOwnProperty.call(obj[key], 'duration')) {
          const dim = Number(obj[key].durationInMilliseconds) || 0;
          if (dim > 0) {
            obj[key].duration = Math.round(dim / 60000);
          }
        }

        // If endmills is missing or explicitly null/undefined, try to compute it
        if (!Object.prototype.hasOwnProperty.call(obj[key], 'endmills') || obj[key].endmills == null) {
          if (Object.prototype.hasOwnProperty.call(obj[key], 'mills')) {
            if (Object.prototype.hasOwnProperty.call(obj[key], 'durationInMilliseconds')) {
              const dim = Number(obj[key].durationInMilliseconds) || 0;
              if (dim > 0) {
                obj[key].endmills = obj[key].mills + dim;
              }
            } else if (Object.prototype.hasOwnProperty.call(obj[key], 'duration')) {
              // reuse times helper to convert minutes to milliseconds
              obj[key].endmills = obj[key].mills + times.mins(Number(obj[key].duration) || 0).msecs;
            }
          }
        }

        // Force runtime durationInMilliseconds to be consistent with mills/endmills
        if (Object.prototype.hasOwnProperty.call(obj[key], 'mills') && Object.prototype.hasOwnProperty.call(obj[key], 'endmills')) {
          const mills = Number(obj[key].mills) || 0;
          const endmills = Number(obj[key].endmills) || 0;
          if (endmills >= mills) {
            obj[key].durationInMilliseconds = endmills - mills;
            // also ensure duration (in minutes) aligns with the computed milliseconds
            obj[key].duration = Math.round((obj[key].durationInMilliseconds || 0) / 60000);
          }
        }
      }
    });

    return obj;
  };

  /**
   * Merge two arrays based on _id string, preferring new objects when a collision is found
   * @param {array} oldData 
   * @param {array} newData 
   */
  ddata.idMergePreferNew = (oldData, newData) => {

    if (!newData && oldData) return oldData;
    if (!oldData && newData) return newData;

    const merged = _.cloneDeep(newData);

    // Index new _ids for O(1) membership tests (string-keyed so ObjectId and
    // string ids compare by value, matching the original == behaviour).
    const newIds = new Set();
    for (let j = 0; j < newData.length; j++) {
      newIds.add('' + newData[j]._id);
    }

    for (let i = 0; i < oldData.length; i++) {
      const oldElement = oldData[i];
      if (!newIds.has('' + oldElement._id)) {
        merged.push(oldElement); // Merge old object in, if it wasn't found in the new data
      }
    }

    return merged;
  };

  ddata.clone = function clone () {
    return _.clone(ddata, function(value) {
      //special handling of mongo ObjectId's
      //see https://github.com/lodash/lodash/issues/602#issuecomment-47414964

      //instead of requiring Mongo.ObjectId here and having it get pulled into the bundle
      //we'll look for the toHexString function and then assume it's an ObjectId
      if (value && value.toHexString && value.toHexString.call && value.toString && value.toString.call) {
        return value.toString();
      }
    });
  };

  ddata.dataWithRecentStatuses = function dataWithRecentStatuses () {
    var results = {};
    results.devicestatus = ddata.recentDeviceStatus(Date.now());
    results.sgvs = ddata.sgvs;
    results.cals = ddata.cals;

    var profiles = _.cloneDeep(ddata.profiles);
    if (profiles && profiles[0] && profiles[0].store) {
      Object.keys(profiles[0].store).forEach(k => {
        if (k.indexOf('@@@@@') > 0) {
          delete profiles[0].store[k];
        }
      })
    }
    results.profiles = profiles;
    results.mbgs = ddata.mbgs;
    results.food = ddata.food;
    results.treatments = ddata.treatments;
    results.dbstats = ddata.dbstats;

    return results;
  }

  ddata.recentDeviceStatus = function recentDeviceStatus (time) {

    // Return device-status records from the last 48 hours (or up to `time`).
    // IOB/COB typically update every 5 minutes, so 48h = 576 records max per device.
    // Cap at 600 to handle occasional extra entries without excessive payload.
    var cutoff = time - times.hours(48).msecs;
    var maxCount = 600;

    return _.chain(ddata.devicestatus)
      .filter(function inWindow(status) {
        return status && status.mills && status.mills <= time && status.mills >= cutoff;
      })
      .sortBy('mills')
      .takeRight(maxCount)
      .value();

  };

  ddata.processDurations = function processDurations (treatments, keepzeroduration) {

    treatments = _.uniqBy(treatments, 'mills');

    // cut temp basals by end events
    // better to do it only on data update
    var endevents = treatments.filter(function filterEnd (t) {
      return !t.duration;
    });

    function cutIfInInterval (base, end) {
      if (base.mills < end.mills && base.mills + times.mins(base.duration).msecs > end.mills) {
        try {
          const originalDuration = base.duration;
          const computedDuration = times.msecs(end.mills - base.mills).mins;
          const computedDurationMs = Number(end.mills) - Number(base.mills);
          // Update duration fields to remain consistent at runtime
          try {
            if (!isNaN(computedDurationMs) && computedDurationMs >= 0) {
              base.durationInMilliseconds = computedDurationMs;
              base.endmills = Number(base.mills) + computedDurationMs;
              base.duration = Math.round((base.durationInMilliseconds || 0) / 60000);
            } else {
              // fallback to minutes-based computed duration
              base.duration = computedDuration;
            }
          } catch (e) {
            base.duration = computedDuration;
          }
        } catch (e) {
          // keep processing even if duration computation fails
          base.duration = times.msecs(end.mills - base.mills).mins;
        }
        if (end.profile) {
          base.cuttedby = end.profile;
          end.cutting = base.profile;
        }
      }
    }

    // cut by end events
    treatments.forEach(function allTreatments (t) {
      if (t.duration) {
        endevents.forEach(function allEndevents (e) {
          cutIfInInterval(t, e);
        });
      }
    });

    // cut by overlaping events
    treatments.forEach(function allTreatments (t) {
      if (t.duration) {
        treatments.forEach(function allEndevents (e) {
          cutIfInInterval(t, e);
        });
      }
    });

    if (keepzeroduration) {
      return treatments;
    } else {
      return treatments.filter(function filterEnd (t) {
        return t.duration;
      });
    }
  };

  ddata.processTreatments = function processTreatments (preserveOrignalTreatments) {

    function synthesizeAapsProfileRestoreTreatment (treatment) {
      if (!treatment || treatment.eventType !== 'Note') {
        return null;
      }

      var originalDuration = Number(treatment.originalDuration);
      if (isNaN(originalDuration) || originalDuration !== 0) {
        return null;
      }

      var profileName = treatment.originalProfileName || treatment.notes || treatment.originalCustomizedName;
      if (!profileName) {
        return null;
      }

      var mills = Number(treatment.mills || 0) || new Date(treatment.created_at).getTime();

      return {
        _id: String(treatment._id || treatment.identifier || mills) + ':profile-restore'
        , eventType: 'Profile Switch'
        , profile: profileName
        , profileJson: treatment.profileJson
        , percentage: treatment.originalPercentage
        , timeshift: treatment.originalTimeshift
        , duration: 0
        , durationInMilliseconds: 0
        , created_at: treatment.created_at
        , mills: mills
        , syntheticAapsProfileRestore: true
        , notes: treatment.notes
        , enteredBy: treatment.enteredBy
        , subject: treatment.subject
        , utcOffset: treatment.utcOffset
      };
    }

    // Single pass: bucket treatments by category instead of scanning the full
    // treatments array once per category. Conditions mirror the original
    // independent filters, so a treatment may still land in more than one bucket.
    // (et = '' also avoids the original throw when eventType is missing.)
    var sitechangeTreatments = [];
    var insulinchangeTreatments = [];
    var batteryTreatments = [];
    var sensorTreatments = [];
    var profileTreatments = [];
    var combobolusTreatments = [];
    var tempbasalTreatments = [];
    var tempTargetTreatments = [];

    ddata.treatments.forEach(function bucketTreatment (t) {
      var et = t.eventType || '';
      if (et.indexOf('Site Change') > -1) sitechangeTreatments.push(t);
      if (et.indexOf('Insulin Change') > -1) insulinchangeTreatments.push(t);
      if (et.indexOf('Pump Battery Change') > -1) batteryTreatments.push(t);
      if (et.indexOf('Sensor') > -1) sensorTreatments.push(t);
      if (et === 'Profile Switch') profileTreatments.push(t);
      if (et === 'Combo Bolus') combobolusTreatments.push(t);
      if (et.indexOf('Temp Basal') > -1) tempbasalTreatments.push(t);
      if (et.indexOf('Temporary Target') > -1) tempTargetTreatments.push(t);
    });

    function byMills (a, b) {
      return Number(a.mills || 0) - Number(b.mills || 0);
    }

    ddata.sitechangeTreatments = sitechangeTreatments.sort(byMills);
    ddata.insulinchangeTreatments = insulinchangeTreatments.sort(byMills);
    ddata.batteryTreatments = batteryTreatments.sort(byMills);
    ddata.sensorTreatments = sensorTreatments.sort(byMills);

    ddata.treatments.forEach(function maybeAddAapsProfileRestore (treatment) {
      var syntheticTreatment = synthesizeAapsProfileRestoreTreatment(treatment);
      if (!syntheticTreatment) {
        return;
      }

      var alreadyPresent = profileTreatments.some(function hasMatchingProfileSwitch (existingTreatment) {
        return Number(existingTreatment.mills || 0) === Number(syntheticTreatment.mills || 0)
          && existingTreatment.profile === syntheticTreatment.profile;
      });

      if (!alreadyPresent) {
        profileTreatments.push(syntheticTreatment);
      }
    });

    profileTreatments.sort(byMills);
    if (preserveOrignalTreatments)
      profileTreatments = _.cloneDeep(profileTreatments);
    ddata.profileTreatments = ddata.processDurations(profileTreatments, true);

    // 'Combo Bolus' events
    ddata.combobolusTreatments = combobolusTreatments.sort(byMills);

    // temp basals
    if (preserveOrignalTreatments)
      tempbasalTreatments = _.cloneDeep(tempbasalTreatments);
    ddata.tempbasalTreatments = ddata.processDurations(tempbasalTreatments, false);

    // temp target

    function convertTempTargetTreatmentUnites (_treatments) {

      let treatments = _.cloneDeep(_treatments);

      for (let i = 0; i < treatments.length; i++) {

        let t = treatments[i];
        let converted = false;
        
        // if treatment is in mmol, convert to mg/dl
        if (Object.prototype.hasOwnProperty.call(t,'units')) {
          if (t.units == 'mmol') {
            //convert to mgdl
            t.targetTop = t.targetTop * consts.MMOL_TO_MGDL;
            t.targetBottom = t.targetBottom * consts.MMOL_TO_MGDL;
            t.units = 'mg/dl';
            converted = true;
          }
        }

        //if we have a temp target thats below 20, assume its mmol and convert to mgdl for safety.
        if (!converted && (t.targetTop < 20 || t.targetBottom < 20)) {
          t.targetTop = t.targetTop * consts.MMOL_TO_MGDL;
          t.targetBottom = t.targetBottom * consts.MMOL_TO_MGDL;
          t.units = 'mg/dl';
        }
      }
      return treatments;
    }

    if (preserveOrignalTreatments) tempTargetTreatments = _.cloneDeep(tempTargetTreatments);
    tempTargetTreatments = convertTempTargetTreatmentUnites(tempTargetTreatments);
    ddata.tempTargetTreatments = ddata.processDurations(tempTargetTreatments, false);

  };

  return ddata;

}

module.exports = init;
