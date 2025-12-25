'use strict';

var times = require('../times');
var moment = window.moment;

var success = {
  name: 'success'
  , label: 'Weekly Distribution'
  , pluginType: 'report'
};

function init () {
  return success;
}

module.exports = init;

success.html = function html (client) {
  var translate = client.translate;
  var ret =
    '<h2>' + translate('Weekly Distribution') + '</h2>' +
    '<div id="success-grid"></div>';
  return ret;
};

success.css =
  '#success-placeholder .tdborder {' +
  '  width:80px;' +
  '  border: 1px #ccc solid;' +
  '  margin: 0;' +
  '  padding: 1px;' +
  '  text-align:center;' +
  '}' +
  '#success-placeholder .inlinepiechart {' +
  '  width: 2.2in;' +
  '  height: 0.9in;' +
  '}';

success.report = function report_success (datastorage, sorteddaystoshow, options) {
  var Nightscout = window.Nightscout;
  var client = Nightscout.client;
  var translate = client.translate;
  var report_plugins = Nightscout.report_plugins;
  var displayUnits = Nightscout.client.settings.units;

  var ss = require('simple-statistics');

  var todo = [];
  var grid = $('#success-grid');
  var minForWeek, maxForWeek, sum;

  grid.empty();
  var table = $('<table class="centeraligned">');
  grid.append(table);
  var thead = $('<tr/>');
  $('<th></th>').appendTo(thead);
  $('<th>' + translate('Week') + '</th>').appendTo(thead);
  $('<th>' + translate('High/Normal/Low') + '</th>').appendTo(thead);
  $('<th>' + translate('Max/Min') + '</th>').appendTo(thead);
  $('<th>' + translate('Average') + '</th>').appendTo(thead);
  $('<th>' + translate('75%/StDev/25%') + '</th>').appendTo(thead);
  $('<th>' + translate('A1c est*') + '</th>').appendTo(thead);
  thead.appendTo(table);

  // Group days into weeks
  var weeks = {};
  sorteddaystoshow.forEach(function(day) {
    var weekStart = moment(day).startOf('isoWeek').format('YYYY-MM-DD');
    if (!weeks[weekStart]) {
      weeks[weekStart] = [];
    }
    weeks[weekStart].push(day);
  });

  // Convert to array and sort by week start date (descending)
  var weekArray = Object.keys(weeks).map(function(weekStart) {
    return {
      weekStart: weekStart,
      days: weeks[weekStart]
    };
  }).sort(function(a, b) {
    return b.weekStart.localeCompare(a.weekStart);
  });

  weekArray.forEach(function(weekInfo) {
    var tr = $('<tr>');
    var weekStart = weekInfo.weekStart;
    var weekDays = weekInfo.days;

    // Collect all records for this week
    var weekRecords = [];
    weekDays.forEach(function(day) {
      if (datastorage[day] && datastorage[day].statsrecords) {
        weekRecords = weekRecords.concat(datastorage[day].statsrecords);
      }
    });

    if (weekRecords.length === 0) {
      $('<td/>').appendTo(tr);
      var weekEnd = moment(weekStart).add(6, 'days').format('YYYY-MM-DD');
      $('<td class="tdborder" style="width:160px">' + report_plugins.utils.localeDate(weekStart) + ' - ' + report_plugins.utils.localeDate(weekEnd) + '</td>').appendTo(tr);
      $('<td class="tdborder" colspan="5">' + translate('No data available') + '</td>').appendTo(tr);
      table.append(tr);
      return;
    }

    minForWeek = weekRecords[0].sgv;
    maxForWeek = weekRecords[0].sgv;
    sum = 0;

    var stats = weekRecords.reduce(function(out, record) {
      record.sgv = parseFloat(record.sgv);
      // Note: Both record.sgv and options.targetLow/targetHigh are already in display units
      // (mg/dl or mmol/L), so no conversion is needed for comparison
      if (record.sgv < options.targetLow) {
        out.lows++;
      } else if (record.sgv < options.targetHigh) {
        out.normal++;
      } else {
        out.highs++;
      }
      if (minForWeek > record.sgv) {
        minForWeek = record.sgv;
      }
      if (maxForWeek < record.sgv) {
        maxForWeek = record.sgv;
      }
      sum += record.sgv;
      return out;
    }, {
      lows: 0
      , normal: 0
      , highs: 0
    });
    var average = sum / weekRecords.length;
    
    // A1c formula requires mg/dL, so convert if needed
    var averageInMgDl = average;
    if (displayUnits === 'mmol') {
      averageInMgDl = average * 18;
    }
    
    var averageA1cDCCT = (averageInMgDl + 46.7) / 28.7;
    var averageA1cIFCC = ((averageInMgDl + 46.7) / 28.7 - 2.15) * 10.929;

    var bgValues = weekRecords.map(function(r) { return r.sgv; });
    $('<td><div id="weeklystat-chart-' + weekStart + '" class="inlinepiechart"></div></td>').appendTo(tr);

    var weekEnd = moment(weekStart).add(6, 'days').format('YYYY-MM-DD');
    $('<td class="tdborder" style="width:160px">' + report_plugins.utils.localeDate(weekStart) + ' - ' + report_plugins.utils.localeDate(weekEnd) + '</td>').appendTo(tr);
    
    // Calculate percentages
    var highPct = Math.round((100 * stats.highs) / weekRecords.length);
    var normalPct = Math.round((100 * stats.normal) / weekRecords.length);
    var lowPct = Math.round((100 * stats.lows) / weekRecords.length);
    
    // Color code High: green if <25%, yellow if <31.25% (25*1.25), red otherwise
    var highColor = '';
    if (highPct < 25) {
      highColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (highPct < 31.25) {
      highColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      highColor = 'background-color: rgba(255, 0, 0, 0.15);';
    }
    
    // Color code Normal (In Range): green if ≥70%, yellow if ≥56% (70*0.8), red otherwise
    var normalColor = '';
    if (normalPct >= 70) {
      normalColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (normalPct >= 56) {
      normalColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      normalColor = 'background-color: rgba(255, 0, 0, 0.15);';
    }
    
    // Color code Low: green if <4%, yellow if <5% (4*1.25), red otherwise
    var lowColor = '';
    if (lowPct < 4) {
      lowColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (lowPct < 5) {
      lowColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      lowColor = 'background-color: rgba(255, 0, 0, 0.15);';
    }
    
    // Group High/Normal/Low vertically with color coding
    var percentagesHtml = '<div style="line-height: 1.2;">' +
      '<div style="' + highColor + '">' + highPct + '%</div>' +
      '<div style="' + normalColor + '">' + normalPct + '%</div>' +
      '<div style="' + lowColor + '">' + lowPct + '%</div>' +
      '</div>';
    $('<td class="tdborder">' + percentagesHtml + '</td>').appendTo(tr);
    
    // Group Max/Min vertically
    var maxMinHtml = '<div style="line-height: 1.2;">' +
      '<div>' + maxForWeek + '</div>' +
      '<div>' + minForWeek + '</div>' +
      '</div>';
    $('<td class="tdborder">' + maxMinHtml + '</td>').appendTo(tr);
    
    $('<td class="tdborder">' + average.toFixed(1) + '</td>').appendTo(tr);
    
    // Calculate StDev for color coding
    var stdValue = ss.standard_deviation(bgValues);
    var stdColor = '';
    var stdTarget = displayUnits === 'mmol' ? 2.0 : 36;
    var stdTargetHigh = displayUnits === 'mmol' ? 2.5 : 45;
    
    if (stdValue <= stdTarget) {
      stdColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (stdValue <= stdTargetHigh) {
      stdColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      stdColor = 'background-color: rgba(255, 0, 0, 0.15);';
    }
    
    // Group 75%/StDev/25% vertically with StDev color coded
    var quartilesHtml = '<div style="line-height: 1.2;">' +
      '<div>' + ss.quantile(bgValues, 0.75).toFixed(1) + '</div>' +
      '<div style="' + stdColor + '">' + stdValue.toFixed(1) + '</div>' +
      '<div>' + ss.quantile(bgValues, 0.25).toFixed(1) + '</div>' +
      '</div>';
    $('<td class="tdborder">' + quartilesHtml + '</td>').appendTo(tr);
    
    // Color code A1c: green if <7%, yellow if <8%, red otherwise
    var a1cColor = '';
    if (averageA1cDCCT < 7) {
      a1cColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (averageA1cDCCT < 8) {
      a1cColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      a1cColor = 'background-color: rgba(255, 0, 0, 0.15);';
    }
    
    // Group A1c % and number vertically with color coding
    var a1cHtml = '<div style="line-height: 1.2; ' + a1cColor + '">' +
      '<div>' + averageA1cDCCT.toFixed(1) + '%</div>' +
      '<div>' + averageA1cIFCC.toFixed(0) + '</div>' +
      '</div>';
    $('<td class="tdborder">' + a1cHtml + '</td>').appendTo(tr);

    table.append(tr);
    var inrange = [
      {
        label: translate('High')
        , data: Math.round(stats.highs * 1000 / weekRecords.length) / 10
      }
      , {
        label: translate('In Range')
        , data: Math.round(stats.normal * 1000 / weekRecords.length) / 10
      }
      , {
        label: translate('Low')
        , data: Math.round(stats.lows * 1000 / weekRecords.length) / 10
      }
    ];
    $.plot(
      '#weeklystat-chart-' + weekStart
      , inrange, {
        series: {
          pie: {
            show: true
          }
        }
        , colors: ['#ff8', '#8f8', '#f88']
      }
    );
  });

  setTimeout(function() {
    todo.forEach(function(fn) {
      fn();
    });
  }, 50);
};
