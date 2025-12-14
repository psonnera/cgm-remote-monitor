'use strict';

var percentile = {
  name: 'percentile'
  , label: 'Percentile Chart'
  , pluginType: 'report'
};

function init() {
  return percentile;
}

module.exports = init;

percentile.html = function html(client) {
  var translate = client.translate;
  var ret =
  '<h2>'
  + translate('Glucose Percentile report')
  + ' ('
  + '<span id="percentile-days"></span>'
  + ')'
  + '</h2>'
  + '<div style="height:500px;">'
  + '  <div class="chart" id="percentile-chart"></div>'
  + '</div>'
  ;

  return ret;
};

percentile.css =
    '#percentile-chart {'
  + '  width: 100%;'
  + '  height: 100%;'
  + '}'
  ;

percentile.report = function report_percentile(datastorage, sorteddaystoshow, options) {
  var Nightscout = window.Nightscout;
  var client = Nightscout.client;
  var translate = client.translate;
  var ss = require('simple-statistics');

  var minutewindow = 30; //minute-window should be a divisor of 60

  var data = datastorage.allstatsrecords;

  var bins = [];
  var filterFunc = function withinWindow(record) {
    var recdate = new Date(record.displayTime);
    return recdate.getHours() === hour && recdate.getMinutes() >= minute && recdate.getMinutes() < minute + minutewindow;
  };

  var reportPlugins = Nightscout.report_plugins;
  var firstDay = reportPlugins.utils.localeDate(sorteddaystoshow[sorteddaystoshow.length - 1]);
  var lastDay = reportPlugins.utils.localeDate(sorteddaystoshow[0]);
  var countDays = sorteddaystoshow.length;

  $('#percentile-days').text(countDays + ' ' + translate('days total') + ', ' + firstDay + ' - ' + lastDay);

  for (var hour = 0; hour < 24; hour++) {
    for (var minute = 0; minute < 60; minute = minute + minutewindow) {
      var date = new Date();
      date.setHours(hour);
      date.setMinutes(minute);
      var readings = data.filter(filterFunc);
      readings = readings.map(function(record) {
        return record.sgv;
      });
      bins.push([date, readings]);
      //console.log(date +  " - " + readings.length);
      //readings.forEach(function(x){console.log(x)});
    }
  }
  var dat10 = bins.map(function(bin) {
    return [bin[0], ss.quantile(bin[1], 0.1)];
  });
  var dat25 = bins.map(function(bin) {
    return [bin[0], ss.quantile(bin[1], 0.25)];
  });
  var dat50 = bins.map(function(bin) {
    return [bin[0], ss.quantile(bin[1], 0.5)];
  });
  var dat75 = bins.map(function(bin) {
    return [bin[0], ss.quantile(bin[1], 0.75)];
  });
  var dat90 = bins.map(function(bin) {
    return [bin[0], ss.quantile(bin[1], 0.9)];
  });
  var high = options.targetHigh;
  var low = options.targetLow;
  
  // Calculate dynamic Y max from dat90 (highest percentile)
  var maxValue = 0;
  for (var i = 0; i < dat90.length; i++) {
    if (dat90[i][1] > maxValue) {
      maxValue = dat90[i][1];
    }
  }
  var yMax = Math.ceil(maxValue / 50) * 50;
  if (yMax < 100) yMax = 100; // minimum 100
  
  //dat50.forEach(function(x){console.log(x[0] + " - " + x[1])});
  $.plot(
    '#percentile-chart', [{
      label: translate('Median'),
      data: dat50,
      id: 'c50',
      color: '#000000',
      points: {
        show: false
      },
      lines: {
        show: true,
        lineWidth: 3
      },
      dashes: {
        show: true,
        lineWidth: 3
      }
    }, {
      label: '25%/75% '+translate('percentile'),
      data: dat25,
      id: 'c25',
      color: '#000055',
      points: {
        show: false
      },
      lines: {
        show: true,
        fill: 0.15,
        lineWidth: 1
      },
      fillBetween: 'c50',
      fillColor: {
        colors: [{
          opacity: 0.15
        }, {
          brightness: 0.5,
          opacity: 0.15
        }]
      }
    }, {
      data: dat75,
      id: 'c75',
      color: '#000055',
      points: {
        show: false
      },
      lines: {
        show: true,
        fill: 0.15,
        lineWidth: 1
      },
      fillBetween: 'c50',
      fillColor: {
        colors: [{
          opacity: 0.15
        }, {
          brightness: 0.5,
          opacity: 0.15
        }]
      }
    }, {
      label: '10%/90% '+translate('percentile'),
      data: dat10,
      id: 'c10',
      color: '#a0a0FF',
      points: {
        show: false
      },
      lines: {
        show: true,
        fill: false,
        lineWidth: 1
      }
    }, {
      data: dat90,
      id: 'c90',
      color: '#a0a0FF',
      points: {
        show: false
      },
      lines: {
        show: true,
        fill: false,
        lineWidth: 1
      }
    }, {
      label: 'Low (70)',
      data: [],
      color: '#214102',
    }, {
      label: 'High (180)',
      data: [],
      color: '#653403',
    }], {
      xaxis: {
        mode: 'time',
        timezone: 'browser',
        timeformat: '%H:%M',
        tickColor: '#555',
      },
      yaxis: {
        min: 40,
        max: options.units === 'mmol' ? Math.ceil(yMax / 18) : yMax,
        tickColor: '#555',
      },
      legend: {
        position: 'nw',
        margin: [10, 10],
        noColumns: 5
      },
      grid: {
        markings: [{
          color: 'rgba(0, 100, 0, 0.08)',
          yaxis: {
            from: 70,
            to: 180
          }
        }, {
          color: '#214102',
          lineWidth: 2,
          dashStyle: [5, 5],
          yaxis: {
            from: 70,
            to: 70
          }
        }, {
          color: '#0a6b01',
          lineWidth: 2,
          dashStyle: [5, 5],
          yaxis: {
            from: 140,
            to: 140
          }
        }, {
          color: '#653403',
          lineWidth: 2,
          dashStyle: [5, 5],
          yaxis: {
            from: 180,
            to: 180
          }
        }],
        //hoverable: true
      }
    }
  );
};
