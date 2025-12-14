'use strict';

var consts = require('../constants');

var dailystats = {
  name: 'dailystats'
  , label: 'Daily Stats'
  , pluginType: 'report'
};

function init () {
  return dailystats;
}

module.exports = init;

dailystats.html = function html (client) {
  var translate = client.translate;
  var ret =
    '<h2>' + translate('Daily stats report') + '</h2>' +
    '<div id="dailystats-report"></div>';
  return ret;
};

dailystats.css =
  '#dailystats-placeholder .tdborder {' +
  '  width:80px;' +
  '  border: 1px #ccc solid;' +
  '  margin: 0;' +
  '  padding: 1px;' +
  '  text-align:center;' +
  '}' +
  '#dailystats-placeholder .inlinepiechart {' +
  '  width: 2.2in;' +
  '  height: 0.9in;' +
  '}';

dailystats.report = function report_dailystats (datastorage, sorteddaystoshow, options) {
  var Nightscout = window.Nightscout;
  var client = Nightscout.client;
  var translate = client.translate;
  var report_plugins = Nightscout.report_plugins;

  var ss = require('simple-statistics');

  var todo = [];
  var report = $('#dailystats-report');
  var minForDay, maxForDay, sum;

  report.empty();
  var table = $('<table class="centeraligned">');
  report.append(table);
  var thead = $('<tr/>');
  $('<th></th>').appendTo(thead);
  $('<th>' + translate('Date') + '</th>').appendTo(thead);
  $('<th>' + translate('High/Normal/Low') + '</th>').appendTo(thead);
  $('<th>' + translate('Max/Min') + '</th>').appendTo(thead);
  $('<th>' + translate('Average') + '</th>').appendTo(thead);
  $('<th>' + translate('75%/StDev/25%') + '</th>').appendTo(thead);
  $('<th>' + translate('A1c est*') + '</th>').appendTo(thead);
  thead.appendTo(table);

  sorteddaystoshow.forEach(function(day) {
    var tr = $('<tr>');

    var daysRecords = datastorage[day].statsrecords;

    if (daysRecords.length === 0) {
      $('<td/>').appendTo(tr);
      $('<td class="tdborder" style="width:160px">' + report_plugins.utils.localeDate(day) + '</td>').appendTo(tr);
      $('<td  class="tdborder"colspan="5">' + translate('No data available') + '</td>').appendTo(tr);
      table.append(tr);
      return;
    }

    minForDay = daysRecords[0].sgv;
    maxForDay = daysRecords[0].sgv;
    sum = 0;

    var stats = daysRecords.reduce(function(out, record) {
      record.sgv = parseFloat(record.sgv);
      if (record.sgv < options.targetLow) {
        out.lows++;
      } else if (record.sgv < options.targetHigh) {
        out.normal++;
      } else {
        out.highs++;
      }
      if (minForDay > record.sgv) {
        minForDay = record.sgv;
      }
      if (maxForDay < record.sgv) {
        maxForDay = record.sgv;
      }
      sum += record.sgv;
      return out;
    }, {
      lows: 0
      , normal: 0
      , highs: 0
    });
    var average = sum / daysRecords.length;
    var averageA1cDCCT = (average + 46.7) / 28.7;
    var averageA1cIFCC = ((average + 46.7) / 28.7 - 2.15) * 10.929;

    var bgValues = daysRecords.map(function(r) { return r.sgv; });
    $('<td><div id="dailystat-chart-' + day.toString() + '" class="inlinepiechart"></div></td>').appendTo(tr);

    $('<td class="tdborder" style="width:160px">' + report_plugins.utils.localeDate(day) + '</td>').appendTo(tr);
    
    // Calculate percentages
    var highPct = Math.round((100 * stats.highs) / daysRecords.length);
    var normalPct = Math.round((100 * stats.normal) / daysRecords.length);
    var lowPct = Math.round((100 * stats.lows) / daysRecords.length);
    
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
      '<div>' + maxForDay + '</div>' +
      '<div>' + minForDay + '</div>' +
      '</div>';
    $('<td class="tdborder">' + maxMinHtml + '</td>').appendTo(tr);
    
    $('<td class="tdborder">' + average.toFixed(1) + '</td>').appendTo(tr);
    
    // Calculate StDev for color coding
    var stdValue = ss.standard_deviation(bgValues);
    var stdColor = '';
    if (stdValue <= 36) {
      stdColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (stdValue <= 45) {
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
        , data: Math.round(stats.highs * 1000 / daysRecords.length) / 10
      }
      , {
        label: translate('In Range')
        , data: Math.round(stats.normal * 1000 / daysRecords.length) / 10
      }
      , {
        label: translate('Low')
        , data: Math.round(stats.lows * 1000 / daysRecords.length) / 10
      }
    ];
    $.plot(
      '#dailystat-chart-' + day.toString()
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
