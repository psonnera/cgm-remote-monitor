'use strict';

var _ = require('lodash');
var NodeCache = require('node-cache');
var times = require('./times');

var cacheTTL = 5; // seconds (node-cache uses seconds, not milliseconds)

function init (profileData, ctx) {

var moment = ctx.moment;

  // useClones:false keeps memory-cache's by-reference get/put semantics.
  // checkperiod:0 disables node-cache's self-re-arming cleanup timer, which
  // would otherwise pin every instance in memory forever — a new instance is
  // created per server data-load (sandbox.serverInit), so entries must expire
  // lazily via the per-key stdTTL check on get() instead.
  var cache = new NodeCache({ stdTTL: cacheTTL, checkperiod: 0, useClones: false });
  var profile = {};
  // The temp basal tempBasalTreatment() found last. It belongs to this instance and to the
  // current treatment list: updateTreatments() resets it along with the cache, because the
  // list it came from has been replaced (AAPS PATCH / Trio re-upload replace the object and
  // the remembered one kept its original end time) (BF-94).
  var prevBasalTreatment = null;

  profile.clear = function clear() {
    cache.flushAll();
    profile.data = null;
    prevBasalTreatment = null;
  }

  profile.clear();

  profile.loadData = function loadData (profileData) {
    if (profileData && profileData.length) {
      // Clear cache to ensure fresh values when new profile data is loaded
      cache.flushAll();
      prevBasalTreatment = null;
      
      profile.data = profile.convertToProfileStore(profileData);
      _.each(profile.data, function eachProfileRecord (record) {
        _.each(record.store, profile.preprocessProfileOnLoad);
        record.mills = new Date(record.startDate).getTime();
      });
    }
  };

  profile.convertToProfileStore = function convertToProfileStore (dataArray) {
    var convertedProfiles = [];
    _.each(dataArray, function(profile) {
      if (!profile || !profile.store || typeof profile.store !== 'object' || Array.isArray(profile.store)) {
        var newObject = {};
        newObject.defaultProfile = 'Default';
        newObject.store = {};
        newObject.startDate = profile.startDate ? profile.startDate : '1980-01-01';
        newObject._id = profile._id;
        newObject.convertedOnTheFly = true;
        delete profile.startDate;
        delete profile._id;
        delete profile.created_at;
        newObject.store['Default'] = profile;
        convertedProfiles.push(newObject);
        console.log('Profile not updated yet. Converted profile:', newObject);
      } else {
        delete profile.convertedOnTheFly;
        convertedProfiles.push(profile);
      }
    });
    return convertedProfiles;
  };

  profile.timeStringToSeconds = function timeStringToSeconds (time) {
    var split = time.split(':');
    return parseInt(split[0]) * 3600 + parseInt(split[1]) * 60;
  };

  // preprocess the timestamps to seconds for a couple orders of magnitude faster operation
  profile.preprocessProfileOnLoad = function preprocessProfileOnLoad (container) {
    _.each(container, function eachValue (value) {

      if (value === null) return;

      if (Object.prototype.toString.call(value) === '[object Array]') {
        profile.preprocessProfileOnLoad(value);
      }

      if (value.time) {
        var sec = profile.timeStringToSeconds(value.time);
        if (!isNaN(sec)) { value.timeAsSeconds = sec; }
      }
    });
  };

  profile.getValueByTime = function getValueByTime (time, valueType, spec_profile) {
    if (!time) { time = Date.now(); }

    //round to the minute for better caching
    var minuteTime = Math.round(time / 60000) * 60000;
    var cacheKey = (minuteTime + valueType + spec_profile);
    var returnValue = cache.get(cacheKey);

    if (returnValue) {
      return returnValue;
    }

    // CircadianPercentageProfile support
    var timeshift = 0;
    var percentage = 100;
    var activeTreatment = profile.activeProfileTreatmentToTime(time);
    var isCcpProfile = !spec_profile && activeTreatment && activeTreatment.CircadianPercentageProfile;
    if (isCcpProfile) {
      percentage = activeTreatment.percentage;
      timeshift = activeTreatment.timeshift; // in hours
    }
    var offset = timeshift % 24;
    time = time + offset * times.hours(offset).msecs;

    // AndroidAPS 3.x Profile Switch: percentage and timeshift apply to the embedded profileJson,
    // which AAPS uploads unscaled (see profile.aapsSwitchAdjustment).
    var aapsAdjustment = !spec_profile && !isCcpProfile ? profile.aapsSwitchAdjustment(activeTreatment) : null;

    var valueContainer = profile.getCurrentProfile(time, spec_profile)[valueType];

    // Assumes the timestamps are in UTC
    // Use local time zone if profile doesn't contain a time zone
    // This WILL break on the server; added warnings elsewhere that this is missing
    // TODO: Better warnings to user for missing configuration

    var t = profile.getTimezone(spec_profile) ? moment(minuteTime).tz(profile.getTimezone(spec_profile)) : moment(minuteTime);

    // Convert to seconds from midnight
    var mmtMidnight = t.clone().startOf('day');
    var timeAsSecondsFromMidnight = t.clone().diff(mmtMidnight, 'seconds');
    if (aapsAdjustment && aapsAdjustment.timeshiftHours) {
      // AAPS reads the schedule at (seconds from midnight - timeshift), wrapped to one day
      timeAsSecondsFromMidnight = ((timeAsSecondsFromMidnight - aapsAdjustment.timeshiftHours * 3600) % 86400 + 86400) % 86400;
    }

    // If the container is an Array, assume it's a valid timestamped value container

    returnValue = valueContainer;

    if (Object.prototype.toString.call(valueContainer) === '[object Array]') {
      _.each(valueContainer, function eachValue (value) {
        if (timeAsSecondsFromMidnight >= value.timeAsSeconds) {
          returnValue = value.value;
        }
      });
    }

    if (returnValue) {
      returnValue = parseFloat(returnValue);
      if (isCcpProfile) {
        switch (valueType) {
          case "sens":
          case "carbratio":
            returnValue = returnValue * 100 / percentage;
            break;
          case "basal":
            returnValue = returnValue * percentage / 100;
            break;
        }
      } else if (aapsAdjustment && aapsAdjustment.percentage !== 100) {
        switch (valueType) {
          case "sens":
          case "carbratio":
            returnValue = returnValue * 100 / aapsAdjustment.percentage;
            break;
          case "basal":
            returnValue = returnValue * aapsAdjustment.percentage / 100;
            break;
        }
      }
    }

    cache.set(cacheKey, returnValue, cacheTTL);

    return returnValue;
  };

  profile.getCurrentProfile = function getCurrentProfile (time, spec_profile) {

    time = time || Date.now();
    var minuteTime = Math.round(time / 60000) * 60000;
    var cacheKey = ("profile" + minuteTime + spec_profile);
    var returnValue = cache.get(cacheKey);

    if (returnValue) {
      return returnValue;
    }

    var pdataActive = profile.profileFromTime(time);
    var data = profile.hasData() ? pdataActive : null;
    var timeprofile = profile.activeProfileToTime(time);
    returnValue = data && timeprofile !== null && Object.prototype.hasOwnProperty.call(data.store, timeprofile)
      ? data.store[timeprofile] : {};

    cache.set(cacheKey, returnValue, cacheTTL);
    return returnValue;

  };

  profile.getUnits = function getUnits (spec_profile) {
    var pu = profile.getCurrentProfile(null, spec_profile)['units'] + ' ';
    if (pu.toLowerCase().includes('mmol')) return 'mmol';
    return 'mg/dl';
  };

  profile.getTimezone = function getTimezone (spec_profile) {
    let rVal =  profile.getCurrentProfile(null, spec_profile)['timezone'];
    // Work around Loop uploading non-ISO compliant time zone string
    if (rVal) rVal.replace('ETC','Etc');
    return rVal;
  };

  profile.hasData = function hasData () {
    return profile.data ? true : false;
  };

  profile.getDIA = function getDIA (time, spec_profile) {
    return profile.getValueByTime(Number(time), 'dia', spec_profile);
  };

  profile.getSensitivity = function getSensitivity (time, spec_profile) {
    return profile.getValueByTime(Number(time), 'sens', spec_profile);
  };

  profile.getCarbRatio = function getCarbRatio (time, spec_profile) {
    return profile.getValueByTime(Number(time), 'carbratio', spec_profile);
  };

  profile.getCarbAbsorptionRate = function getCarbAbsorptionRate (time, spec_profile) {
    return profile.getValueByTime(Number(time), 'carbs_hr', spec_profile);
  };

  profile.getLowBGTarget = function getLowBGTarget (time, spec_profile) {
    return profile.getValueByTime(Number(time), 'target_low', spec_profile);
  };

  profile.getHighBGTarget = function getHighBGTarget (time, spec_profile) {
    return profile.getValueByTime(Number(time), 'target_high', spec_profile);
  };

  profile.getBasal = function getBasal (time, spec_profile) {
    return profile.getValueByTime(Number(time), 'basal', spec_profile);
  };

  profile.updateTreatments = function updateTreatments (profiletreatments, tempbasaltreatments, combobolustreatments) {

    prevBasalTreatment = null;

    profile.profiletreatments = profiletreatments || [];
    profile.profiletreatments.sort(function compareProfileTreatmentMills (a, b) {
      return Number(a.mills || 0) - Number(b.mills || 0);
    });
    profile.tempbasaltreatments = tempbasaltreatments || [];

    // dedupe temp basal events    
    profile.tempbasaltreatments = _.uniqBy(profile.tempbasaltreatments, 'mills');

    _.each(profile.tempbasaltreatments, function addDuration (t) {
      t.endmills = t.mills + times.mins(t.duration || 0).msecs;
    });

    profile.tempbasaltreatments.sort(function compareTreatmentMills (a, b) {
      return a.mills - b.mills;
    });

    profile.combobolustreatments = combobolustreatments || [];

    cache.flushAll();
  };

  function parseAutoSwitchBackFromNotes (treatment) {
    if (!treatment || !treatment.notes) {
      return null;
    }

    var match = String(treatment.notes).match(/\[auto-switch-back\s+from:(\d+)\]/i);
    return match && match[1] ? Number(match[1]) : null;
  }

  profile.isAutoSwitchBackTreatment = function isAutoSwitchBackTreatment (treatment) {
    if (!treatment) {
      return false;
    }

    return !!(treatment.autoSwitchBack || parseAutoSwitchBackFromNotes(treatment));
  };

  profile.isSuppressedProfileTreatment = function isSuppressedProfileTreatment (treatment) {
    if (!profile.isAutoSwitchBackTreatment(treatment)) {
      return false;
    }

    var sourceStartMills = Number(treatment.autoSwitchBackFromMills || parseAutoSwitchBackFromNotes(treatment));
    var switchBackMills = Number(treatment.mills || 0);

    if (!sourceStartMills || !switchBackMills || switchBackMills <= sourceStartMills) {
      return false;
    }

    // If user changed/cancelled/modified profile before expiry, suppress this auto switch-back.
    return profile.profiletreatments.some(function hasInterveningProfileSwitch (other) {
      if (!other || other === treatment || profile.isAutoSwitchBackTreatment(other)) {
        return false;
      }

      var otherMills = Number(other.mills || 0);
      return otherMills > sourceStartMills && otherMills < switchBackMills;
    });
  };

  profile.activeProfileToTime = function activeProfileToTime (time) {
    if (profile.hasData()) {
      time = Number(time) || new Date().getTime();
      
      var pdataActive = profile.profileFromTime(time);
      var timeprofile = pdataActive.defaultProfile;
      var treatment = profile.activeProfileTreatmentToTime(time);

      if (treatment && typeof treatment.profile === 'string' && pdataActive.store
          && Object.prototype.hasOwnProperty.call(pdataActive.store, treatment.profile)) {
        timeprofile = treatment.profile;
      }
      return typeof timeprofile === 'string' && pdataActive.store
        && Object.prototype.hasOwnProperty.call(pdataActive.store, timeprofile) ? timeprofile : null;
    }
    return null;
  };

  profile.activeProfileTreatmentToTime = function activeProfileTreatmentToTime (time) {
    
    var minuteTime = Math.round(time / 60000) * 60000;
    var cacheKey = 'profileCache' + minuteTime;
    var returnValue = cache.get(cacheKey);

    if (returnValue) {
      return returnValue;
    }

    var treatment = null;
    if (profile.hasData()) {
      var pdataActive = profile.profileFromTime(time);
        profile.profiletreatments.forEach(function eachTreatment(t) {
          if (profile.isSuppressedProfileTreatment(t)) {
            return;
          }

          if (time >= t.mills && t.mills >= pdataActive.mills) {
              var duration = times.mins(t.duration || 0).msecs;
              if (duration != 0 && time < t.mills + duration) {
                  treatment = t;
                  // if profile switch contains json of profile inject it in to store to be findable by profile name
                  if (treatment.profileJson && !pdataActive.store[treatment.profile]) {
                    if (treatment.profile.indexOf("@@@@@") < 0)
                      treatment.profile += "@@@@@" + treatment.mills;
                    let json = JSON.parse(treatment.profileJson);
                    profile.preprocessProfileOnLoad(json);
                    pdataActive.store[treatment.profile] = json;
                  }
              }
              if (duration == 0) {
                treatment = t;
                // if profile switch contains json of profile inject it in to store to be findable by profile name
                if (treatment.profileJson && !pdataActive.store[treatment.profile]) {
                    if (treatment.profile.indexOf("@@@@@") < 0)
                      treatment.profile += "@@@@@" + treatment.mills;
                  let json = JSON.parse(treatment.profileJson);
                  profile.preprocessProfileOnLoad(json);
                  pdataActive.store[treatment.profile] = json;
                }
              }
          }
      });
    }

    returnValue = treatment;
    cache.set(cacheKey, returnValue, cacheTTL);
    return returnValue;
  };

  /**
   * The percentage and timeshift of an AndroidAPS 3.x Profile Switch, or null when the treatment
   * does not have that shape.
   *
   * AAPS 3.x uploads a Profile Switch with a numeric `percentage`, a `timeshift` in milliseconds,
   * and a `profileJson` it serialises with percentage 100 and timeshift 0, so the embedded
   * profile is unscaled (AndroidAPS nsclientV3/extensions/ProfileSwitchExtension.kt
   * toNSProfileSwitch). AAPS then reads basal x percentage/100, ISF and carb ratio x 100/percentage,
   * targets unscaled, and every schedule at (time - timeshift), with the timeshift truncated to
   * whole hours (core/objects ProfileSealed.kt, extensions/BlockExtension.kt).
   *
   * Switches flagged CircadianPercentageProfile (AAPS 2.x, timeshift in hours) keep their own path.
   * A switch without an embedded profileJson, or without a numeric percentage, is not this shape.
   * @param {Object|null} treatment - the active Profile Switch treatment
   * @returns {{percentage: number, timeshiftHours: number}|null}
   */
  profile.aapsSwitchAdjustment = function aapsSwitchAdjustment (treatment) {
    if (!treatment || treatment.CircadianPercentageProfile || !treatment.profileJson) return null;
    var percentage = treatment.percentage;
    if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage <= 0) return null;
    var timeshiftHours = 0;
    if (typeof treatment.timeshift === 'number' && Number.isFinite(treatment.timeshift)) {
      timeshiftHours = Math.trunc(treatment.timeshift / times.hour().msecs) % 24;
    }
    if (percentage === 100 && timeshiftHours === 0) return null;
    return { percentage: percentage, timeshiftHours: timeshiftHours };
  };

  profile.profileSwitchName = function profileSwitchName (name) {
    if (!name) return '';
    var index = name.indexOf("@@@@@");
    if (index < 0) return name;
    else return name.substring(0, index);
  }

  profile.profileSwitchStateKey = function profileSwitchStateKey (treatment) {
    if (!treatment) {
      return '';
    }

    var profileName = treatment.profile ? profile.profileSwitchName(treatment.profile) : '';
    var percentage = Number(treatment.percentage);
    var hasPercentage = treatment.CircadianPercentageProfile || (!isNaN(percentage) && percentage !== 100);
    var timeshift = Number(treatment.timeshift);
    var hasTimeshift = !isNaN(timeshift) && timeshift !== 0;

    return [
      profileName,
      hasPercentage ? percentage : 100,
      hasTimeshift ? timeshift : 0
    ].join('|');
  };

  profile.profileSwitchDisplay = function profileSwitchDisplay (treatment) {
    if (!treatment) {
      return '';
    }

    var profileName = treatment.profile ? profile.profileSwitchName(treatment.profile) : '';
    var percentage = Number(treatment.percentage);
    var hasPercentage = treatment.CircadianPercentageProfile || (!isNaN(percentage) && percentage !== 100);
    var timeshift = Number(treatment.timeshift);
    var hasTimeshift = !isNaN(timeshift) && timeshift !== 0;
    var details = [];

    if (hasPercentage) {
      details.push(percentage + '%');
    }

    if (hasTimeshift) {
      details.push((timeshift > 0 ? '+' : '') + timeshift + 'h');
    }

    if (!details.length) {
      return profileName;
    }

    return profileName + ' (' + details.join(', ') + ')';
  };

  profile.profileSwitchStateAtTime = function profileSwitchStateAtTime (time) {
    var activeTreatment = profile.activeProfileTreatmentToTime(time);

    if (activeTreatment) {
      return {
        profile: activeTreatment.profile,
        percentage: activeTreatment.percentage,
        timeshift: activeTreatment.timeshift,
        CircadianPercentageProfile: activeTreatment.CircadianPercentageProfile
      };
    }

    return {
      profile: profile.activeProfileToTime(time)
    };
  }

  profile.profileFromTime = function profileFromTime (time) {
      var profileData = null;

      if (profile.hasData()) {
          profileData = profile.data[0];
          for (var i = 0; i < profile.data.length; i++)
          {
              if (Number(time) >= Number(profile.data[i].mills)) {
                  profileData = profile.data[i];
                  break;
              }
          }
      }

      return profileData;
  }

  profile.tempBasalTreatment = function tempBasalTreatment (time) {

    // Most queries for the data in reporting will match the latest found value, caching that hugely improves performance
    if (prevBasalTreatment && time >= prevBasalTreatment.mills && time <= prevBasalTreatment.endmills) {
      return prevBasalTreatment;
    }

    // Binary search for events for O(log n) performance
    var first = 0
      , last = profile.tempbasaltreatments.length - 1;

    while (first <= last) {
      var i = first + Math.floor((last - first) / 2);
      var t = profile.tempbasaltreatments[i];
      if (time >= t.mills && time <= t.endmills) {
        prevBasalTreatment = t;
        return t;
      }
      if (time < t.mills) {
        last = i - 1;
      } else {
        first = i + 1;
      }
    }

    return null;
  };

  profile.comboBolusTreatment = function comboBolusTreatment (time) {
    var treatment = null;
    profile.combobolustreatments.forEach(function eachTreatment (t) {
      var duration = times.mins(t.duration || 0).msecs;
      if (time < t.mills + duration && time > t.mills) {
        treatment = t;
      }
    });
    return treatment;
  };

  // Times at which the basal line can change between `from` and `to`: a
  // regular grid of `stepMsecs` plus the exact start/end of every profile
  // switch, temp basal and combo bolus. Lets renderers sample coarsely while
  // still drawing AAPS temp basals that start mid-minute at their true edge.
  profile.getBasalRenderTimes = function getBasalRenderTimes (from, to, stepMsecs) {
    from = Number(from);
    to = Number(to);
    stepMsecs = Number(stepMsecs) || times.min().msecs;

    var renderTimes = {};

    function addTime (time) {
      time = Number(time);
      if (Number.isFinite(time) && time >= from && time <= to) {
        renderTimes[time] = true;
      }
    }

    function treatmentEndMills (treatment) {
      if (Number.isFinite(Number(treatment.endmills))) {
        return Number(treatment.endmills);
      }
      return Number(treatment.mills) + times.mins(Number(treatment.duration) || 0).msecs;
    }

    function addTreatmentBoundaries (treatment) {
      var start = Number(treatment.mills);
      var end = treatmentEndMills(treatment);

      if (!Number.isFinite(start)) {
        return;
      }

      addTime(start);
      if (Number.isFinite(end)) {
        addTime(end + 1);
      }
    }

    addTime(from);
    addTime(to);

    for (var time = from; time <= to; time += stepMsecs) {
      addTime(time);
    }

    (profile.profiletreatments || []).forEach(addTreatmentBoundaries);
    (profile.tempbasaltreatments || []).forEach(addTreatmentBoundaries);
    (profile.combobolustreatments || []).forEach(addTreatmentBoundaries);

    return Object.keys(renderTimes).map(Number).sort(function sortNumbers (a, b) {
      return a - b;
    });
  };

  profile.getTempBasal = function getTempBasal (time, spec_profile) {

    // Exact-time cache key (no minute rounding) so treatment boundaries
    // returned by getBasalRenderTimes resolve to their true value.
    time = Number(time);
    var cacheKey = 'basalCache' + time + spec_profile;
    var returnValue = cache.get(cacheKey);

    if (returnValue) {
      return returnValue;
    }

    var basal = profile.getBasal(time, spec_profile);
    var tempbasal = basal;
    var combobolusbasal = 0;
    var treatment = profile.tempBasalTreatment(time);
    var combobolustreatment = profile.comboBolusTreatment(time);

    //special handling for absolute to support temp to 0
    if (treatment && !isNaN(treatment.absolute) && treatment.duration > 0) {
      tempbasal = Number(treatment.absolute);
    } else if (treatment && treatment.percent) {
      tempbasal = basal * (100 + treatment.percent) / 100;
    }
    if (combobolustreatment && combobolustreatment.relative) {
      combobolusbasal = combobolustreatment.relative;
    }
    returnValue = {
      basal: basal
      , treatment: treatment
      , combobolustreatment: combobolustreatment
      , tempbasal: tempbasal
      , combobolusbasal: combobolusbasal
      , totalbasal: tempbasal + combobolusbasal
    };
    cache.set(cacheKey, returnValue, cacheTTL);
    return returnValue;
  };

  profile.listBasalProfiles = function listBasalProfiles () {
    var profiles = [];
    if (profile.hasData()) {
      var current = profile.activeProfileToTime();
      profiles.push(current);

      Object.keys(profile.data[0].store).forEach(key => {
        if (key !== current && key.indexOf('@@@@@') < 0) profiles.push(key);
      })
    }
    return profiles;
  };

  if (profileData) { profile.loadData(profileData); }
  // init treatments array
  profile.updateTreatments([], []);

  return profile;
}

module.exports = init;
