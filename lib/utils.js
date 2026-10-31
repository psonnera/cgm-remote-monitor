'use strict';

var _ = require('lodash');

var units = require('./units')();

function init(ctx) {
  var moment = ctx.moment;
  var settings = ctx.settings;
  var translate = ctx.language.translate;
  var timeago = require('./plugins/timeago')(ctx);

  var utils = { };

  utils.scaleMgdl = function scaleMgdl (mgdl) {
    if (settings.units === 'mmol' && mgdl) {
      return Number(units.mgdlToMMOL(mgdl));
    } else {
      return Number(mgdl);
    }
  };

  utils.roundBGForDisplay = function roundBGForDisplay (bg) {
    return settings.units === 'mmol' ? Math.round(bg * 10) / 10 : Math.round(bg);
  };

  utils.toFixed = function toFixed(value) {
    if (!value) {
      return '0';
    } else {
      var fixed = value.toFixed(2);
      return fixed === '-0.00' ? '0.00' : fixed;
    }
  };

  /**
   * Round the number to maxDigits places, return a string
   * that truncates trailing zeros
   */
  utils.toRoundedStr = function toRoundedStr (value, maxDigits) {
    if (!value) {
      return '0';
    }
    const mult = Math.pow(10, maxDigits);
    // Rounding the float product directly is unreliable: binary floating point
    // stores 1.005 * 100 as 100.49999999999999, so Math.round() rounds it down
    // and a dose of 1.005 is displayed as "1" instead of "1.01". Shifting the
    // decimal exponent of the shortest representation of `value` - the number as
    // it was entered - keeps the decimal digits intact. Values that stringify in
    // exponential notation fall back to the plain product.
    const digits = String(Math.abs(value));
    const shifted = digits.indexOf('e') === -1 ? Number(digits + 'e' + maxDigits) : Math.abs(value) * mult;
    const fixed = Math.sign(value) * Math.round(shifted) / mult;
    if (isNaN(fixed)) return '0';
    return String(fixed);
  };

  // some helpers for input "date"
  utils.mergeInputTime = function mergeInputTime(timestring, datestring) {
    return moment(datestring + ' ' + timestring, 'YYYY-MM-D HH:mm');
  };


  // Escape untrusted text (notes, enteredBy, reason, food names, ...) before
  // concatenating it into HTML strings inserted with .html(). Server-side
  // purification (lib/server/purifier.js) is the primary control; this is
  // defense in depth so a single missed write path cannot lead to XSS.
  // Text-node context only: never use for attributes, URLs, script or CSS.
  utils.escapeHtml = _.escape;

  utils.deviceName = function deviceName (device) {
    var last = device ? _.last(device.split('://')) : 'unknown';
    return _.first(last.split('/'));
  };

  utils.timeFormat = function timeFormat (m, sbx) {
    var when;
    if (m && sbx.data.inRetroMode) {
      when = m.format('LT');
    } else if (m) {
      when = utils.formatAgo(m, sbx.time);
    } else {
      when = 'unknown';
    }

    return when;
  };

  utils.formatAgo = function formatAgo (m, nowMills) {
    var ago = timeago.calcDisplay({mills: m.valueOf()}, nowMills);
    return translate('%1' + ago.shortLabel + (ago.shortLabel.length === 1 ? ' ago' : ''), { params: [(ago.value ? ago.value : '')]});
  };

  utils.timeAt = function timeAt (prefix, sbx) {
    return sbx.data.inRetroMode ? (prefix ? ' ' : '') + '@ ' : (prefix ? ', ' : '');
  };

  return utils;
}

module.exports = init;
