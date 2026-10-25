'use strict';

var _ = require('lodash')
  , times = require('../times');

/*
 * Pure extraction of controller-reported carbs-on-board from a single
 * devicestatus document (upstream keeps this in lib/client-core/devicestatus/cob.js,
 * which myscout does not have, so it lives here). Covers the OpenAPS family
 * (oref0 / oref1 / AndroidAPS / Trio) and Loop. The document is not mutated.
 *
 * A block (`openaps.enacted`, `openaps.suggested`, `loop.cob`) is a candidate
 * only when its COB is a finite number and it has a resolvable time. A block's
 * `timestamp` dates it, falling back to the enclosing record's `mills`.
 * AndroidAPS omits `timestamp` on `openaps.suggested` and sends `enacted` with
 * neither COB nor timestamp, so the record is what dates its COB; the old code
 * called moment(undefined) for both, which resolves to *now*.
 *
 * OpenAPS wins over Loop when both yield a candidate. Within OpenAPS the newer
 * block wins, ties going to `suggested`: Trio carries the previous cycle's
 * `enacted` alongside a fresher `suggested`.
 */
function toMills (value, moment) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  var m = moment(value);
  return m && m.isValid() ? m.valueOf() : null;
}

function blockMills (block, entry, moment) {
  var mills = toMills(block.timestamp, moment);
  return mills === null ? toMills(entry.mills, moment) : mills;
}

function toCOB (value) {
  if (value === undefined || value === null || value === '') return null;
  var num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function candidate (block, key, entry, moment) {
  if (!block || typeof block !== 'object') return null;

  var cobValue = toCOB(block[key]);
  if (cobValue === null) return null;

  var mills = blockMills(block, entry, moment);
  if (mills === null) return null;

  return { cob: cobValue, mills: mills };
}

function selectCOB (entry, moment) {
  if (!entry || typeof entry !== 'object') return {};

  if (entry.openaps && typeof entry.openaps === 'object') {
    var enacted = candidate(entry.openaps.enacted, 'COB', entry, moment);
    var suggested = candidate(entry.openaps.suggested, 'COB', entry, moment);

    var best = (enacted && suggested)
      ? (enacted.mills > suggested.mills ? enacted : suggested)
      : (enacted || suggested);

    if (best) {
      return {
        cob: best.cob
        , source: 'OpenAPS'
        , device: entry.device
        , mills: best.mills
      };
    }
  }

  if (entry.loop && typeof entry.loop === 'object') {
    var loopCOB = candidate(entry.loop.cob, 'cob', entry, moment);
    if (loopCOB) {
      return {
        cob: loopCOB.cob
        , source: 'Loop'
        , device: entry.device
        , mills: loopCOB.mills
      };
    }
  }

  return {};
}

function init (ctx) {
  var moment = ctx.moment;
  var translate = ctx.language.translate;
  var iob = require('./iob')(ctx);

  var cob = {
    name: 'cob'
    , label: 'Carbs-on-Board'
    , pluginType: 'pill-major'
  };

  cob.RECENCY_THRESHOLD = times.mins(30).msecs;

  cob.setProperties = function setProperties (sbx) {
    sbx.offerProperty('cob', function setCOB () {
      return cob.cobTotal(sbx.data.treatments, sbx.data.devicestatus, sbx.data.profile, sbx.time);
    });
  };

  cob.cobTotal = function cobTotal (treatments, devicestatus, profile, time, spec_profile) {

    if (typeof time === 'undefined') {
      time = Date.now();
    } else if (time && time.getTime) {
      time = time.getTime();
    }

    // sens and carbratio are needed only by the treatment-derived model; the
    // controller-reported COB needs neither, so check device status first.
    var hasProfile = Boolean(profile && profile.hasData()
      && profile.getSensitivity(time, spec_profile)
      && profile.getCarbRatio(time, spec_profile));

    var hasTreatments = treatments !== undefined && treatments.length > 0;

    const TEN_MINUTES = 10 * 60 * 1000;

    // Freshness is judged against the viewed time, not wall-clock time, so
    // controller-reported COB stays available while rewinding the timeline.
    var result = cob.lastCOBDeviceStatus(devicestatus, time);
    var deviceCOBIsCurrent = !_.isNil(result.cob) && Number.isFinite(result.mills) && (time - result.mills) <= TEN_MINUTES;

    if (deviceCOBIsCurrent) {
      if (hasProfile && hasTreatments) {
        var comparison = cob.fromTreatments(treatments, devicestatus, profile, time, spec_profile);
        if (comparison.cob) {
          result = _.assign({}, result, { treatmentCOB: comparison.cob });
        }
      }
      return addDisplay(result);
    }

    if (!hasProfile) {
      console.warn('For the COB plugin to derive COB from treatments you need a treatment profile with both sens and carbratio fields');
      return {};
    }

    var treatmentCOB = hasTreatments ? cob.fromTreatments(treatments, devicestatus, profile, time, spec_profile) : {};

    // detaches lastCarbs from the treatment record
    result = _.cloneDeep(treatmentCOB);
    result.source = translate('Care Portal');

    return addDisplay(result);
  };

  function addDisplay (cob) {
    if (_.isEmpty(cob) || cob.cob === undefined) {
      return {};
    }

    var display = Math.round(cob.cob * 10) / 10;
    return _.merge(cob, {
      display: display
      , displayLine: 'COB: ' + display + 'g'
    });
  }

  cob.isDeviceStatusAvailable = function isDeviceStatusAvailable (devicestatus) {

    return _.chain(devicestatus)
      .map(cob.fromDeviceStatus)
      .reject(_.isEmpty)
      .value()
      .length > 0;
  };

  cob.lastCOBDeviceStatus = function lastCOBDeviceStatus (devicestatus, time) {

    if (time && time.getTime) {
      time = time.getTime();
    }

    var futureMills = time + times.mins(5).msecs; //allow for clocks to be a little off
    var recentMills = time - cob.RECENCY_THRESHOLD;

    return _.chain(devicestatus)
      .filter(function(cobStatus) {
        return cobStatus.mills <= futureMills && cobStatus.mills >= recentMills;
      })
      .map(cob.fromDeviceStatus)
      .reject(_.isEmpty)
      .sortBy('mills')
      .last()
      .value() || {};
  };

  cob.COBDeviceStatusesInTimeRange = function COBDeviceStatusesInTimeRange (devicestatus, from, to) {

    return _.chain(devicestatus)
      .filter(function(cobStatus) {
        return cobStatus.mills > from && cobStatus.mills < to;
      })
      .map(cob.fromDeviceStatus)
      .reject(_.isEmpty)
      .sortBy('mills')
      .value();
  };

  // Shape is stable: { cob, source, device, mills } or {}. lib/server/iobcob.js
  // and lib/client/index.js read .cob / .mills from this to build the lean series.
  cob.fromDeviceStatus = function fromDeviceStatus (devicestatusEntry) {
    return selectCOB(devicestatusEntry, moment);
  };

  cob.fromTreatments = function fromTreatments (treatments, devicestatus, profile, time, spec_profile) {
    // TODO: figure out the liverSensRatio that gives the most accurate purple line predictions
    var liverSensRatio = 8;
    var totalCOB = 0;
    var lastCarbs = null;

    var isDecaying = 0;
    var lastDecayedBy = 0;

    _.each(treatments, function eachTreatment (treatment) {
      if (treatment.carbs && treatment.mills < time) {
        lastCarbs = treatment;
        var cCalc = cob.cobCalc(treatment, profile, lastDecayedBy, time, spec_profile);
        var decaysin_hr = (cCalc.decayedBy - time) / 1000 / 60 / 60;
        if (decaysin_hr > -10) {
          // units: BG
          var actStart = iob.calcTotal(treatments, devicestatus, profile, lastDecayedBy, spec_profile).activity;
          var actEnd = iob.calcTotal(treatments, devicestatus, profile, cCalc.decayedBy, spec_profile).activity;
          var avgActivity = (actStart + actEnd) / 2;
          // units:  g     =       BG      *      scalar     /          BG / U                           *     g / U
          var delayedCarbs = (avgActivity * liverSensRatio / profile.getSensitivity(treatment.mills, spec_profile)) * profile.getCarbRatio(treatment.mills, spec_profile);
          var delayMinutes = Math.round(delayedCarbs / profile.getCarbAbsorptionRate(treatment.mills, spec_profile) * 60);
          if (delayMinutes > 0) {
            cCalc.decayedBy.setMinutes(cCalc.decayedBy.getMinutes() + delayMinutes);
            decaysin_hr = (cCalc.decayedBy - time) / 1000 / 60 / 60;
          }
        }

        if (cCalc) {
          lastDecayedBy = cCalc.decayedBy;
        }

        if (decaysin_hr > 0) {
          //console.info('Adding ' + delayMinutes + ' minutes to decay of ' + treatment.carbs + 'g bolus at ' + treatment.mills);
          totalCOB += Math.min(Number(treatment.carbs), decaysin_hr * profile.getCarbAbsorptionRate(treatment.mills, spec_profile));
          //console.log('cob:', Math.min(cCalc.initialCarbs, decaysin_hr * profile.getCarbAbsorptionRate(treatment.mills)),cCalc.initialCarbs,decaysin_hr,profile.getCarbAbsorptionRate(treatment.mills));
          isDecaying = cCalc.isDecaying;
        } else {
          totalCOB = 0;
        }

      }
    });

    var rawCarbImpact = isDecaying * profile.getSensitivity(time, spec_profile) / profile.getCarbRatio(time, spec_profile) * profile.getCarbAbsorptionRate(time, spec_profile) / 60;

    return {
      decayedBy: lastDecayedBy
      , isDecaying: isDecaying
      , carbs_hr: profile.getCarbAbsorptionRate(time, spec_profile)
      , rawCarbImpact: rawCarbImpact
      , cob: totalCOB
      , lastCarbs: lastCarbs
    };
  };

  cob.carbImpact = function carbImpact (rawCarbImpact, insulinImpact) {
    var liverSensRatio = 1.0;
    var liverCarbImpactMax = 0.7;
    var liverCarbImpact = Math.min(liverCarbImpactMax, liverSensRatio * insulinImpact);
    //var liverCarbImpact = liverSensRatio*insulinImpact;
    var netCarbImpact = Math.max(0, rawCarbImpact - liverCarbImpact);
    var totalImpact = netCarbImpact - insulinImpact;
    return {
      netCarbImpact: netCarbImpact
      , totalImpact: totalImpact
    };
  };

  cob.cobCalc = function cobCalc (treatment, profile, lastDecayedBy, time, spec_profile) {

    var delay = 20;
    var isDecaying = 0;
    var initialCarbs;

    if (treatment.carbs) {
      var carbTime = new Date(treatment.mills);

      var carbs_hr = profile.getCarbAbsorptionRate(treatment.mills, spec_profile);
      var carbs_min = carbs_hr / 60;

      var decayedBy = new Date(carbTime);
      var minutesleft = (lastDecayedBy - carbTime) / 1000 / 60;
      decayedBy.setMinutes(decayedBy.getMinutes() + Math.max(delay, minutesleft) + treatment.carbs / carbs_min);
      if (delay > minutesleft) {
        initialCarbs = parseInt(treatment.carbs);
      } else {
        initialCarbs = parseInt(treatment.carbs) + minutesleft * carbs_min;
      }
      var startDecay = new Date(carbTime);
      startDecay.setMinutes(carbTime.getMinutes() + delay);
      if (time < lastDecayedBy || time > startDecay) {
        isDecaying = 1;
      } else {
        isDecaying = 0;
      }
      return {
        initialCarbs: initialCarbs
        , decayedBy: decayedBy
        , isDecaying: isDecaying
        , carbTime: carbTime
      };
    } else {
      return '';
    }
  };

  cob.updateVisualisation = function updateVisualisation (sbx) {

    var prop = sbx.properties.cob;

    if (prop === undefined || prop.cob === undefined) {
      sbx.pluginBase.updatePillText(cob, {
        value: '-'
        , label: translate('COB')
        , info: []
      });
      return;
    }

    var displayCob = Math.round(prop.cob * 10) / 10;

    var info = [];

    if (prop.source !== undefined) {
      info.push({ label: translate('Source'), value: prop.source });
    }

    if (prop.device !== undefined) {
      info.push({ label: translate('Device'), value: prop.device });
    }

    // treatmentCOB is a number (the treatment-derived comparison value) when a
    // controller-reported COB is current and the Care Portal model disagrees
    if (prop.treatmentCOB !== undefined) {
      info.push({ label: '------------', value: '' });
      info.push({ label: translate('Careportal COB'), value: Math.round(prop.treatmentCOB * 10) / 10 });
    }

    if (prop.lastCarbs) {
      var when = new Date(prop.lastCarbs.mills).toLocaleString();
      var amount = prop.lastCarbs.carbs + 'g';
      info.push({ label: translate('Last Carbs'), value: amount + ' @ ' + when });
    }

    sbx.pluginBase.updatePillText(cob, {
      value: displayCob + 'g'
      , label: translate('COB')
      , info: info
    });
  };

  function virtAsstCOBHandler (next, slots, sbx) {
    var response = '';
    var cob = _.get(sbx, 'properties.cob.cob');
    var pwd = _.get(slots, 'pwd.value');
    var value = cob ? cob : 0;
    if (pwd) {
      response = translate('virtAsstCob3person', {
        params: [
          pwd.replace('\'s', '')
          , value
        ]
      });
    } else {
      response = translate('virtAsstCob', {
        params: [
          value
        ]
      });
    }
    next(translate('virtAsstTitleCurrentCOB'), response);
  }

  cob.virtAsst = {
    intentHandlers: [{
      intent: 'MetricNow'
      , metrics: ['cob', 'carbs on board', 'carbohydrates on board']
      , intentHandler: virtAsstCOBHandler
    }]
  };

  return cob;

}

module.exports = init;
