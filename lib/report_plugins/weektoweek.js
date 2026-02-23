'use strict';

var _ = require('lodash');
var moment = window.moment;
var d3 = (global && global.d3) || require('d3');
var ss = require('simple-statistics');

var dayColors = [
  'rgb(73, 22, 153)'
  , 'rgb(34, 201, 228)'
  , 'rgb(0, 153, 123)'
  , 'rgb(135, 135, 228)'
  , 'rgb(135, 49, 204)'
  , 'rgb(36, 36, 228)'
  , 'rgb(0, 234, 188)'
];

var weektoweek = {
  name: 'weektoweek'
  , label: 'Week to week'
  , pluginType: 'report'
};

function init (ctx) {

  weektoweek.html = function html (client) {
    var translate = client.translate;
    var ret =
      '<h2>' + translate('Week to week') + '</h2>' +
      '<b>' + translate('To update this report, press SHOW while in this view') + '</b><br>' +
      '&nbsp;' + translate('Size') +
      ' <select id="wrp_size">' +
      '  <option x="800" y="250">800x250px</option>' +
      '  <option x="1000" y="300" selected>1000x300px</option>' +
      '  <option x="1200" y="400">1200x400px</option>' +
      '  <option x="1550" y="600">1550x600px</option>' +
      '</select>' +
      '<br>' +
      translate('Scale') + ': ' +
      '<input type="radio" name="wrp_scale" id="wrp_linear" checked>' +
      translate('Linear') +
      '<input type="radio" name="wrp_scale" id="wrp_log">' +
      translate('Logarithmic') +
      '<br>' +
      '<div id="weektoweekcharts">' +
      '</div>';
    return ret;
  };

  weektoweek.css =
    '#weektoweekcharts .weektoweek-glucosebar {' +
    '  width: 0.55in;' +
    '  height: 0.9in;' +
    '  border: 1px solid #ccc;' +
    '  border-radius: 4px;' +
    '  overflow: hidden;' +
    '  display: flex;' +
    '  flex-direction: column-reverse;' +
    '  margin: 0 auto;' +
    '}' +
    '#weektoweekcharts .weektoweek-segment {' +
    '  width: 100%;' +
    '  display: flex;' +
    '  align-items: center;' +
    '  justify-content: center;' +
    '  font-size: 14px;' +
    '  font-weight: bold;' +
    '  color: #333;' +
    '}' +
    '#weektoweekcharts .weektoweek-segment span {' +
    '  display: block;' +
    '  padding: 0 2px;' +
    '}' +
    '#weektoweekcharts .weektoweek-rangetable {' +
    '  margin: 5px auto;' +
    '  border-collapse: collapse;' +
    '  font-size: 16px;' +
    '}' +
    '#weektoweekcharts .weektoweek-rangetable td {' +
    '  padding: 2px 8px;' +
    '  text-align: right;' +
    '}' +
    '#weektoweekcharts .weektoweek-rangetable td:first-child {' +
    '  text-align: left;' +
    '  font-weight: bold;' +
    '}' +
    '#weektoweekcharts .weektoweek-statstable {' +
    '  margin: 10px auto;' +
    '  border-collapse: collapse;' +
    '  font-size: 16px;' +
    '}' +
    '#weektoweekcharts .weektoweek-statstable td {' +
    '  padding: 2px 8px;' +
    '  text-align: right;' +
    '}' +
    '#weektoweekcharts .weektoweek-statstable td:first-child {' +
    '  text-align: left;' +
    '  font-weight: bold;' +
    '}' +
    '#weektoweekcharts table td {' +
    '  vertical-align: top;' +
    '  padding-left: 20px;' +
    '}' +
    '#weektoweekcharts table td:first-child {' +
    '  padding-left: 0;' +
    '}' +
    '#weektoweekcharts > table {' +
    '  margin-bottom: 30px;' +
    '}';

  weektoweek.prepareHtml = function weektoweekPrepareHtml (weekstoshow) {
    $('#weektoweekcharts').html('');

    var translate = ctx.language.translate;

    var colorIdx = 0;

    var legend = '<table>';

    legend += '<tr><td><svg width="16" height="16"><g><circle fill="' + dayColors[colorIdx++] + '" r="40"></circle></g></svg></td><td>' + translate('Sunday') + '</td>';
    legend += '<td><svg width="16" height="16"><circle fill="' + dayColors[colorIdx++] + '" r="40"></circle></g></svg></td><td>' + translate('Monday') + '</td>';
    legend += '<td><svg width="16" height="16"><circle fill="' + dayColors[colorIdx++] + '" r="40"></circle></g></svg></td><td>' + translate('Tuesday') + '</td>';
    legend += '<td><svg width="16" height="16"><circle fill="' + dayColors[colorIdx++] + '" r="40"></circle></g></svg></td><td>' + translate('Wednesday') + '</td></tr>';
    legend += '<tr><td><svg width="16" height="16"><circle fill="' + dayColors[colorIdx++] + '" r="40"></circle></g></svg></td><td>' + translate('Thursday') + '</td>';
    legend += '<td><svg width="16" height="16"><circle fill="' + dayColors[colorIdx++] + '" r="40"></circle></g></svg></td><td>' + translate('Friday') + '</td>';
    legend += '<td><svg width="16" height="16"><circle fill="' + dayColors[colorIdx++] + '" r="40"></circle></g></svg></td><td>' + translate('Saturday') + '</td></tr>';
    legend += '</table>';

    $('#weektoweekcharts').append($(legend));

    weekstoshow.forEach(function eachWeek (d) {
      $('#weektoweekcharts').append($('<table><tr><td><div id="weektoweekchart-' + d[0] + '-' + d[d.length - 1] + '"></div></td><td><div id="weektoweekglucosestats-' + d[0] + '-' + d[d.length - 1] + '"></div></td><td><div id="weektoweekstatchart-' + d[0] + '-' + d[d.length - 1] + '"></div></td></tr></table>'));
    });
  };

  weektoweek.report = function report_weektoweek (datastorage, sorteddaystoshow, options) {
    var Nightscout = window.Nightscout;
    var client = Nightscout.client;
    var report_plugins = Nightscout.report_plugins;

    var padding = { top: 15, right: 22, bottom: 30, left: 35 };

    var weekstoshow = [];

    var startDay = moment(sorteddaystoshow[0] + ' 00:00:00');

    sorteddaystoshow.forEach(function eachDay (day) {
      var weekNum = Math.abs(moment(day + ' 00:00:00').diff(startDay, 'weeks'));

      if (typeof weekstoshow[weekNum] === 'undefined') {
        weekstoshow[weekNum] = [];
      }

      weekstoshow[weekNum].push(day);
    });

    weekstoshow = weekstoshow.map(function orderWeek (week) {
      return _.sortBy(week);
    });

    weektoweek.prepareHtml(weekstoshow);

    // Modernized: Async chunked week rendering for better UI responsiveness
    var weekIdx = 0;
    var chunkSize = 1; // Render 1 week at a time (weeks have more data)
    
    function renderWeekChunk() {
      var end = Math.min(weekIdx + chunkSize, weekstoshow.length);
      for (; weekIdx < end; weekIdx++) {
        var week = weekstoshow[weekIdx];
        var sgvData = [];
        var weekStart = moment(week[0] + ' 00:00:00');

        week.forEach(function eachDay (day) {
          var dayNum = Math.abs(moment(day + ' 00:00:00').diff(weekStart, 'days'));

          datastorage[day].sgv.forEach(function eachSgv (sgv) {
            var sgvWeekday = moment(sgv.date).day();
            var sgvColor = dayColors[sgvWeekday];

            if (sgv.color === 'gray') {
              sgvColor = sgv.color;
            }

            sgvData.push({
              'color': sgvColor
              , 'date': moment(sgv.date).subtract(dayNum, 'days').toDate()
              , 'filtered': sgv.filtered
              , 'mills': sgv.mills - dayNum * 24 * 60 * 60000
              , 'noise': sgv.noise
              , 'sgv': sgv.sgv
              , 'type': sgv.type
              , 'unfiltered': sgv.unfiltered
              , 'y': sgv.y
            });
          });
        });

        drawChart(week, sgvData, options);
      }
      
      if (weekIdx < weekstoshow.length) {
        setTimeout(renderWeekChunk, 0);
      }
    }
    
    renderWeekChunk();

    function timeTicks (n, i) {
      var t12 = [
      '12am', '', '2am', '', '4am', '', '6am', '', '8am', '', '10am', ''
      , '12pm', '', '2pm', '', '4pm', '', '6pm', '', '8pm', '', '10pm', '', '12am'
    ];
      if (Nightscout.client.settings.timeFormat === 24) {
        return ('00' + i).slice(-2);
      } else {
        return t12[i];
      }
    }

    function drawChart (week, sgvData, options) {
      var tickValues
        , charts
        , context
        , xScale2, yScale2
        , xAxis2, yAxis2
        , dateFn = function(d) { return new Date(d.date); };

      tickValues = client.ticks(client, {
        scaleY: options.weekscale === report_plugins.consts.SCALE_LOG ? 'log' : 'linear'
        , targetTop: options.targetHigh
        , targetBottom: options.targetLow
      });

      // add defs for combo boluses
      var dashWidth = 5;
      d3.select('body').append('svg')
        .append('defs')
        .append('pattern')
        .attr('id', 'hash')
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('width', 6)
        .attr('height', 6)
        .attr('x', 0)
        .attr('y', 0)
        .append('g')
        .style('fill', 'none')
        .style('stroke', '#0099ff')
        .style('stroke-width', 2)
        .append('path').attr('d', 'M0,0 l' + dashWidth + ',' + dashWidth)
        .append('path').attr('d', 'M' + dashWidth + ',0 l-' + dashWidth + ',' + dashWidth);

      // create svg and g to contain the chart contents
      charts = d3.select('#weektoweekchart-' + week[0] + '-' + week[week.length - 1]).html(
        '<b>' +
        report_plugins.utils.localeDate(week[0]) +
        '-' +
        report_plugins.utils.localeDate(week[week.length - 1]) +
        '</b><br>'
      ).append('svg');

      charts.append('rect')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('fill', 'WhiteSmoke');

      context = charts.append('g');

      // define the parts of the axis that aren't dependent on width or height
      xScale2 = d3.scaleTime()
        .domain(d3.extent(sgvData, dateFn));

      if (options.weekscale === report_plugins.consts.SCALE_LOG) {
        yScale2 = d3.scaleLog()
          .domain([client.utils.scaleMgdl(36), client.utils.scaleMgdl(420)]);
      } else {
        yScale2 = d3.scaleLinear()
          .domain([client.utils.scaleMgdl(36), client.utils.scaleMgdl(420)]);
      }

      xAxis2 = d3.axisBottom(xScale2)
        .tickFormat(timeTicks)
        .ticks(24);

      yAxis2 = d3.axisLeft(yScale2)
        .tickFormat(d3.format('d'))
        .tickValues(tickValues);

      // get current data range
      var dataRange = d3.extent(sgvData, dateFn);

      // get the entire container height and width subtracting the padding
      var chartWidth = options.weekwidth - padding.left - padding.right;
      var chartHeight = options.weekheight - padding.top - padding.bottom;

      //set the width and height of the SVG element
      charts.attr('width', options.weekwidth)
        .attr('height', options.weekheight);

      // ranges are based on the width and height available so reset
      xScale2.range([0, chartWidth]);
      yScale2.range([chartHeight, 0]);

      // add target BG rect
      context.append('rect')
        .attr('x', xScale2(dataRange[0]) + padding.left)
        .attr('y', yScale2(options.targetHigh) + padding.top)
        .attr('width', xScale2(dataRange[1] - xScale2(dataRange[0])))
        .attr('height', yScale2(options.targetLow) - yScale2(options.targetHigh))
        .style('fill', '#D6FFD6')
        .attr('stroke', 'grey');

      // create the x axis container
      context.append('g')
        .attr('class', 'x axis');

      // create the y axis container
      context.append('g')
        .attr('class', 'y axis');

      context.select('.y')
        .attr('transform', 'translate(' + (padding.left) + ',' + padding.top + ')')
        .style('stroke', 'black')
        .style('shape-rendering', 'crispEdges')
        .style('fill', 'none')
        .call(yAxis2);

      // if first run then just display axis with no transition
      context.select('.x')
        .attr('transform', 'translate(' + padding.left + ',' + (chartHeight + padding.top) + ')')
        .style('stroke', 'black')
        .style('shape-rendering', 'crispEdges')
        .style('fill', 'none')
        .call(xAxis2);

      _.each(tickValues, function(n, li) {
        context.append('line')
          .attr('class', 'high-line')
          .attr('x1', xScale2(dataRange[0]) + padding.left)
          .attr('y1', yScale2(tickValues[li]) + padding.top)
          .attr('x2', xScale2(dataRange[1]) + padding.left)
          .attr('y2', yScale2(tickValues[li]) + padding.top)
          .style('stroke-dasharray', ('1, 5'))
          .attr('stroke', 'grey');
      });

      // bind up the context chart data to an array of circles
      var contextCircles = context.selectAll('circle')
        .data(sgvData);

      function prepareContextCircles (sel) {
        var badData = [];
        sel.attr('cx', function(d) {
            return xScale2(d.date) + padding.left;
          })
          .attr('cy', function(d) {
            if (isNaN(d.sgv)) {
              badData.push(d);
              return yScale2(client.utils.scaleMgdl(450) + padding.top);
            } else {
              return yScale2(d.sgv) + padding.top;
            }
          })
          .attr('fill', function(d) {
            if (d.color === 'gray') {
              return 'transparent';
            }
            return d.color;
          })
          .style('opacity', function() { return 0.5 })
          .attr('stroke-width', function(d) { if (d.type === 'mbg') { return 2; } else { return 0; } })
          .attr('stroke', function() { return 'black'; })
          .attr('r', function(d) {
            if (d.type === 'mbg') {
              return 4;
            } else {
              return 2 + (options.weekwidth - 800) / 400;
            }
          })
          .on('mouseout', hideTooltip);

        if (badData.length > 0) {
          console.warn('Bad Data: isNaN(sgv)', badData);
        }
        return sel;
      }

      // if new circle then just display
      prepareContextCircles(contextCircles.enter().append('circle'));

      contextCircles.exit()
        .remove();

      // Calculate and render glucose distribution stats for the week
      var glucoseStats = {
        lows: 0,
        normal: 0,
        highs: 0
      };
      
      var bgValues = [];
      // Collect statsrecords from all days in this week
      var weekRecords = [];
      week.forEach(function(day) {
        if (datastorage[day] && datastorage[day].statsrecords) {
          weekRecords = weekRecords.concat(datastorage[day].statsrecords);
        }
      });
      
      weekRecords.forEach(function(record) {
        var sgv = parseFloat(record.sgv);
        if (!isNaN(sgv)) {
          bgValues.push(sgv);
          if (sgv < options.targetLow) {
            glucoseStats.lows++;
          } else if (sgv < options.targetHigh) {
            glucoseStats.normal++;
          } else {
            glucoseStats.highs++;
          }
        }
      });
      
      if (bgValues.length > 0) {
        var totalReadings = bgValues.length;
        var highPct = Math.round((100 * glucoseStats.highs) / totalReadings);
        var normalPct = Math.round((100 * glucoseStats.normal) / totalReadings);
        var lowPct = Math.round((100 * glucoseStats.lows) / totalReadings);
        var labelMinPct = 10;
        
        var average = bgValues.reduce(function(sum, val) { return sum + val; }, 0) / bgValues.length;
        var stdDev = ss.standardDeviation(bgValues);
        var gmi = (3.31 + (0.02392 * average)).toFixed(1);
        
        var translate = ctx.language.translate;
        
        // Render glucose stats to middle column with vertical centering
        var glucoseStatsHtml = '<div style="text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%;">';
        
        // Header
        glucoseStatsHtml += '<b>' + translate('Statistics') + '</b><br><br>';
        
        // Stacked bar chart in middle
        var lowLabel = lowPct >= labelMinPct ? '<span>' + lowPct + '%</span>' : '';
        var normalLabel = normalPct >= labelMinPct ? '<span>' + normalPct + '%</span>' : '';
        var highLabel = highPct >= labelMinPct ? '<span>' + highPct + '%</span>' : '';
        glucoseStatsHtml += '<div class="weektoweek-glucosebar">';
        glucoseStatsHtml += '<div class="weektoweek-segment" style="height:' + lowPct + '%; background-color:#f88;">' + lowLabel + '</div>';
        glucoseStatsHtml += '<div class="weektoweek-segment" style="height:' + normalPct + '%; background-color:#8f8;">' + normalLabel + '</div>';
        glucoseStatsHtml += '<div class="weektoweek-segment" style="height:' + highPct + '%; background-color:#ff8; color:#000;">' + highLabel + '</div>';
        glucoseStatsHtml += '</div>';
        
        // Statistics table at bottom
        glucoseStatsHtml += '<table class="weektoweek-statstable"><tbody>';
        glucoseStatsHtml += '<tr><td>' + translate('High') + '</td><td>' + highPct.toFixed(1) + '%</td></tr>';
        glucoseStatsHtml += '<tr><td>' + translate('In Range') + '</td><td>' + normalPct.toFixed(1) + '%</td></tr>';
        glucoseStatsHtml += '<tr><td>' + translate('Low') + '</td><td>' + lowPct.toFixed(1) + '%</td></tr>';
        glucoseStatsHtml += '<tr><td>' + translate('Average') + '</td><td>' + average.toFixed(1) + '</td></tr>';
        glucoseStatsHtml += '<tr><td>' + translate('StDev.') + '</td><td>' + stdDev.toFixed(1) + '</td></tr>';
        glucoseStatsHtml += '<tr><td>' + translate('GMI') + '</td><td>' + gmi + '%</td></tr>';
        glucoseStatsHtml += '</tbody></table>';
        
        glucoseStatsHtml += '</div>';
        
        $('#weektoweekglucosestats-' + week[0] + '-' + week[week.length - 1]).append(glucoseStatsHtml);
      }
    }

    function hideTooltip () {
      client.tooltip.style('display', 'none');
    }
  };
  return weektoweek;
}

module.exports = init;
