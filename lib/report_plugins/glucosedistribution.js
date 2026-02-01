'use strict';

var consts = require('../constants');

var glucosedistribution = {
  name: 'glucosedistribution'
  , label: 'AGP Report'
  , pluginType: 'report'
};

function init () {
  return glucosedistribution;
}

module.exports = init;

glucosedistribution.html = function html (client) {
  var translate = client.translate;
  var ret =
    '<h2>' +
    translate('Glucose distribution') +
    ' (' +
    '<span id="glucosedistribution-days"></span>' +
    ')' +
    '  </h2>' +
    '<table><tr>' +
    '<td rowspan="2" style="valign:middle; padding-right: 40px;"><div id="glucosedistribution-overviewchart"></div></td>' +
    '<td><div id="glucosedistribution-report"></div></td>' +
    '</tr>' +
    '<tr><td><div id="glucosedistribution-stability"></div></td></tr>' +
    '</table>' +
    '<br>' +
    '<h3>' + translate('Glucose Percentile report') + '</h3>' +
    '<div style="height:500px;">' +
    '  <div class="chart" id="glucosedistribution-percentile-chart"></div>' +
    '</div>';
  return ret;
};

glucosedistribution.css =
  '#glucosedistribution-overviewchart {' +
  '  min-width: 100px;' +
  '  height: 300px;' +
  '  margin: 0;' +
  '}' +
  '#glucosedistribution-percentile-chart {' +
  '  width: 100%;' +
  '  height: 100%;' +
  '}' +
  '#glucosedistribution-placeholder .tdborder {' +
  '  width:80px;' +
  '  border: 1px #ccc solid;' +
  '  margin: 0;' +
  '  padding: 1px;' +
  '    text-align:center;' +
  '}' +
  '#glucosedistribution-report .tdborder:first-child {' +
  '  width: 80px;' +
  '  white-space: nowrap;' +
  '}' +
  '#glucosedistribution-report .tdborder:nth-child(2) {' +
  '  white-space: nowrap;' +
  '}' +
  '#glucosedistribution-barchart-container {' +
  '  display: flex;' +
  '  flex-direction: column;' +
  '  margin: 20px 0;' +
  '}' +
  '#glucosedistribution-barchart-labels {' +
  '  display: flex;' +
  '  justify-content: space-around;' +
  '  margin-top: 10px;' +
  '  font-size: 12px;' +
  '}' +
  '#glucosedistribution-barchart-labels > div {' +
  '  display: flex;' +
  '  align-items: center;' +
  '  gap: 5px;' +
  '}' +
  '#glucosedistribution-barchart-labels .color-box {' +
  '  width: 15px;' +
  '  height: 15px;' +
  '  border: 1px solid #ccc;' +
  '}';

glucosedistribution.report = function report_glucosedistribution (datastorage, sorteddaystoshow, options) {
  var Nightscout = window.Nightscout;
  var client = Nightscout.client;
  var translate = client.translate;
  var displayUnits = Nightscout.client.settings.units;

  var ss = require('simple-statistics');
  
  // Helper function to update progress bar
  function updateProgress(percent, message) {
    // Check if progress bar exists, if not create it
    if ($('#progress-bar').length === 0) {
      $('#info').html('<b>' + message + '</b><br><div id="progress-container" style="width: 100%; background-color: #f0f0f0; border: 1px solid #ccc; border-radius: 5px; margin-top: 10px; height: 30px; position: relative;"><div id="progress-bar" style="width: ' + percent + '%; height: 100%; background-color: #6c6; border-radius: 5px; transition: width 0.3s ease;"></div><span id="progress-text" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #333; font-weight: bold; z-index: 1;">' + percent + '%</span></div>');
    } else {
      $('#progress-bar').css('width', percent + '%');
      $('#progress-text').text(percent + '%');
    }
  }
  
  // Show initial progress
  updateProgress(0, translate('Rendering AGP Report') + '...');
  
  // Use async processing to avoid blocking UI
  setTimeout(function() {
    processGlucoseDistribution(datastorage, sorteddaystoshow, options, ss, translate, displayUnits, updateProgress);
  }, 0);
};

function processGlucoseDistribution(datastorage, sorteddaystoshow, options, ss, translate, displayUnits, updateProgress) {

  // Always use all available data (no sampling)
  var adaptiveSampleInterval = 1;
  
  updateProgress(10, translate('Rendering AGP Report') + '...');

  // Bright colors for graph
  var graphcolors = {
    'Very Low': '#8B0000'
    , 'Low': '#FF0000'
    , 'Target Range': '#00AA00'
    , 'High': '#FFD700'
    , 'Very High': '#FF8800'
  };
  
  // Softer colors for table
  var tablecolors = {
    'Very Low': '#ffcccc'
    , 'Low': '#ffdddd'
    , 'Target Range': '#ccffcc'
    , 'High': '#ffffcc'
    , 'Very High': '#ffe5cc'
  };

  var enabledHours = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];

  var report = $('#glucosedistribution-report');
  report.empty();

  var stability = $('#glucosedistribution-stability');
  stability.empty();

  var stats = [];
  
  // Create container div for side-by-side tables
  var tablesContainer = $('<div style="display: flex; gap: 20px;"></div>');
  
  var table = $('<table class="centeraligned">');
  var thead = $('<tr/>');
  $('<th>' + translate('Range') + '</th>').appendTo(thead);
  $('<th>' + translate('Limits') + '</th>').appendTo(thead);
  $('<th>' + translate('%') + '</th>').appendTo(thead);
  $('<th colspan="2">' + translate('Target') + '</th>').appendTo(thead);
  thead.appendTo(table);

  var days = datastorage.alldays;

  var reportPlugins = Nightscout.report_plugins;
  var firstDay = reportPlugins.utils.localeDate(sorteddaystoshow[sorteddaystoshow.length - 1]);
  var lastDay = reportPlugins.utils.localeDate(sorteddaystoshow[0]);

  $('#glucosedistribution-days').text(days + ' ' + translate('days total') + ', ' + firstDay + ' - ' + lastDay);

  for (var i = 0; i < 24; i++) {
    $('#glucosedistribution-' + i).unbind('click').click(onClick);
    enabledHours[i] = $('#glucosedistribution-' + i).is(':checked');
  }

  // Load and validate data once - remove duplicates and invalid entries
  var rawData = datastorage.allstatsrecords;
  var seen = [];
  var validatedData = rawData.filter(function(item) {
    if (!item.sgv || !item.bgValue || !item.displayTime || item.bgValue < 39) {
      console.log(item);
      return false;
    }
    return seen.includes(item.displayTime) ? false : (seen[item.displayTime] = true);
  });

  validatedData.sort(function(a, b) {
    return a.displayTime.getTime() - b.displayTime.getTime();
  });

  if (validatedData.length === 0) {
    $('#glucosedistribution-days').text(translate('Result is empty'));
    return;
  }
  
  updateProgress(20, translate('Rendering AGP Report') + '...');

  // Create independent copies for each processing path
  var dataForDistribution = validatedData.slice();
  var dataForPercentile = validatedData.slice();

  var result = {};

  // Process data for distribution table
  var data = dataForDistribution;

  // Simplified data processing - skip interpolation for performance
  // Filter by enabled hours only (already sorted from validatedData)
  var glucose_data = data.filter(function(r) {
    return enabledHours[new Date(r.displayTime).getHours()];
  });

  var timeTotal = 0;
  for (i = 1; i <= glucose_data.length - 2; i++) {
    let entry = glucose_data[i];
    let nextEntry = glucose_data[i + 1];
    let timeDelta = nextEntry.displayTime.getTime() - entry.displayTime.getTime();
    if (timeDelta < maxGap) {
      timeTotal += timeDelta;
    }
  }

  var daysTotal = timeTotal / (1000 * 60 * 60 * 24);

  // Define ranges in mg/dL
  var ranges = [
    {name: 'Very Low', min: 0, max: 54},
    {name: 'Low', min: 54, max: 70},
    {name: 'Target Range', min: 70, max: 181},
    {name: 'TITR', min: 70, max: 141},
    {name: 'High', min: 181, max: 251},
    {name: 'Very High', min: 251, max: 9999}
  ];

  // Initialize result objects and arrays
  for (var rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
    var rangeName = ranges[rangeIdx].name;
    result[rangeName] = {
      rangeRecords: [],
      localBgs: []
    };
  }

  // Single pass through data to populate all ranges
  for (var i = 0; i < glucose_data.length; i++) {
    var rec = glucose_data[i];
    var bgValue = rec.bgValue;
    
    for (var rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
      var rangeInfo = ranges[rangeIdx];
      if (bgValue >= rangeInfo.min && bgValue < rangeInfo.max) {
        var r = result[rangeInfo.name];
        r.rangeRecords.push(rec);
        if (rec.sgv) {
          r.localBgs.push(rec.sgv);
        }
      }
    }
  }

  // Calculate statistics for each range (skip detailed stats - not displayed)
  for (var rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
    var rangeInfo = ranges[rangeIdx];
    var r = result[rangeInfo.name];
    
    stats.push(r.rangeRecords.length);
    
    // Skip expensive mean/median/stddev calculations - not used in display
    // Only keeping percentage which is calculated below
    
    r.readingspct = (100 * r.rangeRecords.length / glucose_data.length).toFixed(1);
  }

  // Calculate actual total to ensure 100%
  var totalPct = 0;
  for (var pctIdx = 0; pctIdx < ranges.length; pctIdx++) {
    if (result[ranges[pctIdx].name] && result[ranges[pctIdx].name].readingspct) {
      totalPct += parseFloat(result[ranges[pctIdx].name].readingspct);
    }
  }
  
  // Adjust Target Range to make total exactly 100%
  if (result['Target Range'] && result['Very Low'] && result['Low'] && result['High'] && result['Very High']) {
    result['Target Range'].readingspct = (100 - 
      parseFloat(result['Very Low'].readingspct || 0) - 
      parseFloat(result['Low'].readingspct || 0) - 
      parseFloat(result['High'].readingspct || 0) - 
      parseFloat(result['Very High'].readingspct || 0)).toFixed(1);
  }

  // Helper function to convert mg/dL range to mmol/L
  function convertRangeToMmol(rangeMgDl) {
    // Convert mg/dL ranges to mmol/L (divide by 18)
    return rangeMgDl
      .replace(/>(\d+)/, function(match, num) { return '>' + (Math.round(parseInt(num) / 18 * 10) / 10); })
      .replace(/<(\d+)/, function(match, num) { return '<' + (Math.round(parseInt(num) / 18 * 10) / 10); })
      .replace(/(\d+)–(\d+)/, function(match, num1, num2) { 
        return (Math.round(parseInt(num1) / 18 * 10) / 10) + '–' + (Math.round(parseInt(num2) / 18 * 10) / 10);
      });
  }

  var rangeDefinitions = [
    {name: 'Very High', label: 'Very High', range: '>250', target1: '<5%', target2: 'TAR <25%', target2Rowspan: 2, targetValue: 5, comparison: '<'},
    {name: 'High', label: 'High', range: '181–250', target1: '', target2Skip: true, targetValue: 25, comparison: '<'},
    {name: 'Target Range', label: 'In Range', range: '70–180', target1: '≥70%', target2: 'TIR', targetValue: 70, comparison: '>='},
    {name: 'TITR', label: 'Tight', range: '70–140', target1: '≥50%', target2: 'TITR', targetValue: 50, comparison: '>='},
    {name: 'Low', label: 'Low', range: '54–69', target1: '', target2: 'TBR <4%', target2Rowspan: 2, targetValue: 4, comparison: '<'},
    {name: 'Very Low', label: 'Very Low', range: '<54', target1: '<1%', target2Skip: true, targetValue: 1, comparison: '<'}
  ];

  var tableHTML = '';
  for (var defIdx = 0; defIdx < rangeDefinitions.length; defIdx++) {
    var rangeInfo = rangeDefinitions[defIdx];
    var r = result[rangeInfo.name];
    
    if (!r) {
      console.warn('Range not found:', rangeInfo.name);
      continue;
    }

    // Convert range to appropriate units
    var displayRange = rangeInfo.range;
    var unitLabel = 'mg/dL';
    if (displayUnits === 'mmol') {
      displayRange = convertRangeToMmol(rangeInfo.range);
      unitLabel = 'mmol/L';
    }
    
    // Color code percentage cell based on target
    var actualPct = parseFloat(r.readingspct || '0.0');
    var bgColor = '';
    var testPct = actualPct;
    
    // For High, test against sum of High + Very High
    if (rangeInfo.name === 'High') {
      testPct = parseFloat(result['High'].readingspct || '0.0') + parseFloat(result['Very High'].readingspct || '0.0');
    }
    // For Low, test against sum of Low + Very Low
    else if (rangeInfo.name === 'Low') {
      testPct = parseFloat(result['Low'].readingspct || '0.0') + parseFloat(result['Very Low'].readingspct || '0.0');
    }
    
    if (rangeInfo.targetValue !== undefined) {
      var meetsTarget = false;
      if (rangeInfo.comparison === '>=') {
        meetsTarget = testPct >= rangeInfo.targetValue;
        if (meetsTarget) {
          bgColor = 'background-color: rgba(0, 200, 0, 0.15);';
        } else if (testPct >= rangeInfo.targetValue * 0.8) {
          bgColor = 'background-color: rgba(255, 200, 0, 0.15);';
        } else {
          bgColor = 'background-color: rgba(255, 0, 0, 0.15);';
        }
      } else if (rangeInfo.comparison === '<') {
        meetsTarget = testPct < rangeInfo.targetValue;
        if (meetsTarget) {
          bgColor = 'background-color: rgba(0, 200, 0, 0.15);';
        } else if (testPct < rangeInfo.targetValue * 1.25) {
          bgColor = 'background-color: rgba(255, 200, 0, 0.15);';
        } else {
          bgColor = 'background-color: rgba(255, 0, 0, 0.15);';
        }
      }
    }
    
    tableHTML += '<tr>';
    tableHTML += '<td class="tdborder"><strong>' + translate(rangeInfo.label) + '</strong></td>';
    tableHTML += '<td class="tdborder">' + displayRange + ' ' + unitLabel + '</td>';
    tableHTML += '<td class="tdborder" style="' + bgColor + '">' + actualPct + '%</td>';
    tableHTML += '<td class="tdborder">' + (rangeInfo.target1 || '') + '</td>';
    
    // Target column 2 with rowspan for combined targets
    if (!rangeInfo.target2Skip) {
      if (rangeInfo.target2Rowspan) {
        tableHTML += '<td class="tdborder" rowspan="' + rangeInfo.target2Rowspan + '">' + (rangeInfo.target2 || '') + '</td>';
      } else {
        tableHTML += '<td class="tdborder">' + (rangeInfo.target2 || '') + '</td>';
      }
    }
    
    tableHTML += '</tr>';
  }
  
  table.append(tableHTML);
  tablesContainer.append(table);
  
  // Calculate statistics for separate table
  var avgValue, medianValue, stdValue, stdBgColor, gmiValue, gmiBgColor, gmiDisplay;
  if (glucose_data.length > 0) {
    // Use all data for statistics
    var localBgs = [];
    var mgDlBgs = [];
    for (var i = 0; i < glucose_data.length; i++) {
      if (glucose_data[i].sgv) localBgs.push(glucose_data[i].sgv);
      if (glucose_data[i].bgValue) mgDlBgs.push(glucose_data[i].bgValue);
    }
    
    avgValue = (Math.round(10 * ss.mean(localBgs)) / 10).toFixed(1);
    medianValue = (Math.round(10 * ss.quantile(localBgs, 0.5)) / 10).toFixed(1);
    
    // Color code STD with target ≤36
    stdValue = Math.round(ss.standard_deviation(localBgs) * 10) / 10;
    stdBgColor = '';
    if (stdValue <= 36) {
      stdBgColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (stdValue <= 45) {
      stdBgColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      stdBgColor = 'background-color: rgba(255, 0, 0, 0.15);';
    }
    
    // Color code GMI with target <7%
    gmiValue = Math.round(10 * (ss.mean(mgDlBgs) + 46.7) / 28.7) / 10;
    gmiBgColor = '';
    if (gmiValue < 7) {
      gmiBgColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (gmiValue < 8) {
      gmiBgColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      gmiBgColor = 'background-color: rgba(255, 0, 0, 0.15);';
    }
    
    gmiDisplay = '<strong>' + gmiValue.toFixed(1) + '%</strong><br><strong>' + Math.round(((ss.mean(mgDlBgs) + 46.7) / 28.7 - 2.15) * 10.929) + '</strong>';
  }
  
  updateProgress(40, translate('Rendering AGP Report') + '...');

  // Calculate GVI and PGS - sample every 3rd point for performance
  var events = 0;
  var GVITotal = 0;
  var GVIIdeal = 0;
  var GVIIdeal_Time = 0;

  var usedRecords = 0;
  var glucoseTotal = 0;
  var deltaTotal = 0;
  
  const maxGap = (5 * 60 * 1000) + 10000;

  for (i = 0; i <= glucose_data.length - 2; i++) {
    const entry = glucose_data[i];
    const nextEntry = glucose_data[i + 1];
    const timeDelta = nextEntry.displayTime.getTime() - entry.displayTime.getTime();

    if (timeDelta == 0 || timeDelta > maxGap) {
      continue;
    }

    usedRecords += 1;
    events += 1;

    var delta = Math.abs(nextEntry.bgValue - entry.bgValue);
    deltaTotal += delta;

    GVITotal += Math.sqrt(Math.pow(timeDelta / (1000 * 60), 2) + Math.pow(delta, 2));
    GVIIdeal_Time += timeDelta / (1000 * 60);
    glucoseTotal += entry.bgValue;
  }

  // Difference between first and last reading
  var GVIDelta = Math.floor(glucose_data[0].bgValue - glucose_data[glucose_data.length - 1].bgValue);

  // Delta for total time considered against total period rise
  GVIIdeal = Math.sqrt(Math.pow(GVIIdeal_Time, 2) + Math.pow(GVIDelta, 2));

  var GVI = Math.round(GVITotal / GVIIdeal * 100) / 100;

  var glucoseMean = Math.floor(glucoseTotal / usedRecords);
  var tirMultiplier = (result['Target Range'] && result['Target Range'].readingspct) ? result['Target Range'].readingspct / 100.0 : 0;
  var PGS = Math.round(GVI * glucoseMean * (1 - tirMultiplier) * 100) / 100;

  // Create statistics table
  var statsTable = $('<table class="centeraligned" style="margin-left: 20px;">');
  var statsHTML = '<tr><th colspan="2">' + translate('Statistics') + '</th></tr>';
  
  if (glucose_data.length > 0) {
    statsHTML += '<tr><td class="tdborder"><strong>' + translate('Average') + '</strong></td><td class="tdborder">' + avgValue + '</td></tr>';
    statsHTML += '<tr><td class="tdborder"><strong>' + translate('Median') + '</strong></td><td class="tdborder">' + medianValue + '</td></tr>';
    statsHTML += '<tr><td class="tdborder"><strong>' + translate('STDev.') + '</strong></td><td class="tdborder" style="' + stdBgColor + '">' + stdValue.toFixed(1) + '</td></tr>';
    statsHTML += '<tr><td class="tdborder"><strong>' + translate('GMI') + '</strong></td><td class="tdborder" style="' + gmiBgColor + '">' + gmiDisplay + '</td></tr>';
    
    // Color code GVI: green <15, yellow 15-20, red >20
    var gviBgColor = '';
    if (GVI < 15) {
      gviBgColor = 'background-color: rgba(0, 200, 0, 0.15);';
    } else if (GVI <= 20) {
      gviBgColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      gviBgColor = 'background-color: rgba(255, 0, 0, 0.15);';
    }
    
    // Color code PGS: red <70, yellow 70-80, green >80
    var pgsBgColor = '';
    if (PGS < 70) {
      pgsBgColor = 'background-color: rgba(255, 0, 0, 0.15);';
    } else if (PGS <= 80) {
      pgsBgColor = 'background-color: rgba(255, 200, 0, 0.15);';
    } else {
      pgsBgColor = 'background-color: rgba(0, 200, 0, 0.15);';
    }
    
    statsHTML += '<tr><td class="tdborder"><strong>' + translate('GVI') + '</strong></td><td class="tdborder" style="' + gviBgColor + '">' + GVI + '</td></tr>';
    statsHTML += '<tr><td class="tdborder"><strong>' + translate('PGS') + '</strong></td><td class="tdborder" style="' + pgsBgColor + '">' + PGS + '</td></tr>';
  }
  
  statsTable.append(statsHTML);
  tablesContainer.append(statsTable);
  
  // Batch all DOM updates together to avoid multiple reflows
  report.append(tablesContainer);
  
  updateProgress(60, translate('Rendering AGP Report') + '...');

  // Create vertical stacked bar chart with 5 ranges using bright colors
  // Defer to next frame to avoid blocking
  requestAnimationFrame(function() {
  try {
    var barRanges = [
      'Very Low', 'Low', 'Target Range', 'High', 'Very High'
    ];
    
    // Wrapper container with horizontal layout
    var barHTML = '<div style="display: flex; flex-direction: row; gap: 15px; align-items: center;">';
    
    // Bar chart
    barHTML += '<div style="display: flex; flex-direction: column-reverse; width: 100px; height: 300px; border: 1px solid #ccc; border-radius: 5px; overflow: hidden;">';
    
    // Stack from bottom to top: Very Low, Low, Target Range, High, Very High
    for (var idx = 0; idx < barRanges.length; idx++) {
      var rangeName = barRanges[idx];
      if (result[rangeName] && result[rangeName].readingspct) {
        var pct = parseFloat(result[rangeName].readingspct);
        if (pct > 0) {
          barHTML += '<div style="height: ' + pct + '%; width: 100%; background-color: ' + graphcolors[rangeName] + '; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 12px; text-shadow: 1px 1px 1px rgba(0,0,0,0.5);">';
          if (pct > 3) barHTML += pct + '%';
          barHTML += '</div>';
        }
      }
    }
    
    barHTML += '</div>';
    
    // Add legend to the right (ordered high to low, vertically stacked)
    var legendRanges = ['Very High', 'High', 'Target Range', 'Low', 'Very Low'];
    barHTML += '<div style="display: flex; flex-direction: column; gap: 5px; font-size: 11px; white-space: nowrap;">';
    for (var idx2 = 0; idx2 < legendRanges.length; idx2++) {
      var rangeName2 = legendRanges[idx2];
      if (result[rangeName2] && result[rangeName2].readingspct) {
        barHTML += '<div style="display: flex; align-items: center; gap: 5px;"><span style="width: 15px; height: 15px; background-color: ' + graphcolors[rangeName2] + '; border: 1px solid #ccc; display: inline-block;"></span><span>' + translate(rangeName2) + '</span></div>';
      }
    }
    barHTML += '</div>';
    
    // Close wrapper
    barHTML += '</div>';
    
    $('#glucosedistribution-overviewchart').html(barHTML);
  } catch (e) {
    console.error('Error rendering bar chart:', e);
    $('#glucosedistribution-overviewchart').html('<div style="color: red;">Error rendering chart</div>');
  }
  });
  
  updateProgress(75, translate('Rendering AGP Report') + '...');

  // Render percentile chart with pre-validated data
  renderPercentileChart(dataForPercentile, options);

  function renderPercentileChart(validatedData, options) {
    var minutewindow = 30;
    var data = validatedData;
    
    // Helper function to safely plot when container is ready
    function safePlot(selector, chartData, chartOptions, retryCount) {
      retryCount = retryCount || 0;
      var container = $(selector);
      
      if (container.length === 0 || container.width() === 0 || container.height() === 0) {
        if (retryCount < 5) {
          setTimeout(function() {
            safePlot(selector, chartData, chartOptions, retryCount + 1);
          }, 100);
        }
        return;
      }
      
      // Validate data - ensure all series have color defined
      if (chartData && Array.isArray(chartData)) {
        for (var i = 0; i < chartData.length; i++) {
          if (!chartData[i].color) {
            chartData[i].color = '#000000';
          }
        }
      }
      
      try {
        $.plot(selector, chartData, chartOptions);
      } catch (e) {
        console.error('Error plotting percentile chart:', e);
      }
    }
    
    // Use all data for percentile chart
    var timeSlots = {};
    for (var i = 0; i < data.length; i++) {
      var recdate = new Date(data[i].displayTime);
      var hour = recdate.getHours();
      var minute = Math.floor(recdate.getMinutes() / minutewindow) * minutewindow;
      var key = hour + '_' + minute;
      if (!timeSlots[key]) {
        timeSlots[key] = [];
      }
      timeSlots[key].push(data[i].sgv);
    }
    
    // Build bins with pre-grouped data
    var bins = [];
    for (var hour = 0; hour < 24; hour++) {
      for (var minute = 0; minute < 60; minute = minute + minutewindow) {
        var date = new Date();
        date.setHours(hour);
        date.setMinutes(minute);
        var key = hour + '_' + minute;
        var readings = timeSlots[key] || [];
        bins.push([date, readings]);
      }
    }

    // Calculate all quantiles in single pass per bin
    var dat10 = [];
    var dat25 = [];
    var dat50 = [];
    var dat75 = [];
    var dat90 = [];
    var datMin = [];
    var datMax = [];
    
    for (var i = 0; i < bins.length; i++) {
      var bin = bins[i];
      var readings = bin[1];
      if (readings.length > 0) {
        // sgv values are already in the user's display units (mg/dL or mmol/L)
        // so we don't need to convert them
        dat10.push([bin[0], ss.quantile(readings, 0.1)]);
        dat25.push([bin[0], ss.quantile(readings, 0.25)]);
        dat50.push([bin[0], ss.quantile(readings, 0.5)]);
        dat75.push([bin[0], ss.quantile(readings, 0.75)]);
        dat90.push([bin[0], ss.quantile(readings, 0.9)]);
        datMin.push([bin[0], ss.min(readings)]);
        datMax.push([bin[0], ss.max(readings)]);
      } else {
        dat10.push([bin[0], null]);
        dat25.push([bin[0], null]);
        dat50.push([bin[0], null]);
        dat75.push([bin[0], null]);
        dat90.push([bin[0], null]);
        datMin.push([bin[0], null]);
        datMax.push([bin[0], null]);
      }
    }

    var maxValue = 0;
    for (var i = 0; i < datMax.length; i++) {
      if (datMax[i][1] && datMax[i][1] > maxValue) {
        maxValue = datMax[i][1];
      }
    }
    
    var yMax, yMin;
    if (displayUnits === 'mmol') {
      yMax = Math.ceil(maxValue * 2) / 2; // Round up to nearest 0.5
      if (yMax < 6) yMax = 6;
      yMin = 2;
    } else {
      yMax = Math.ceil(maxValue / 50) * 50;
      if (yMax < 100) yMax = 100;
      yMin = 40;
    }

    // Defer plotting to next animation frame to avoid forced reflow
    requestAnimationFrame(function() {
      var chartData = [{
      label: translate('Median'),
      data: dat50, id: 'c50', color: '#000000',
      points: { show: false },
      lines: { show: true, lineWidth: 3 },
      dashes: { show: true, lineWidth: 3 }
    }, {
      label: '25%/75% ' + translate('percentile'),
      data: dat25, id: 'c25', color: '#000055',
      points: { show: false },
      lines: { show: true, fill: 0.15, lineWidth: 1 },
      fillBetween: 'c50',
      fillColor: { colors: [{ opacity: 0.15 }, { brightness: 0.5, opacity: 0.15 }] }
    }, {
      data: dat75, id: 'c75', color: '#000055',
      points: { show: false },
      lines: { show: true, fill: 0.15, lineWidth: 1 },
      fillBetween: 'c50',
      fillColor: { colors: [{ opacity: 0.15 }, { brightness: 0.5, opacity: 0.15 }] }
    }, {
      label: '10%/90% ' + translate('percentile'),
      data: dat10, id: 'c10', color: '#888888',
      points: { show: false },
      lines: { show: true, lineWidth: 1, fill: 0.3 },
      fillBetween: 'c90',
      fillColor: { colors: [{ opacity: 0.3 }, { opacity: 0.3 }] }
    }, {
      data: dat90, id: 'c90', color: '#888888',
      points: { show: false },
      lines: { show: true, lineWidth: 1 }
    }, {
      label: translate('Min'),
      data: datMin, id: 'cMin', color: '#cc0000',
      points: { show: false },
      lines: { show: true, lineWidth: 1 },
      dashes: { show: true, lineWidth: 1, dashLength: [5, 5] }
    }, {
      label: translate('Max'),
      data: datMax, id: 'cMax', color: '#ff8800',
      points: { show: false },
      lines: { show: true, lineWidth: 1 },
      dashes: { show: true, lineWidth: 1, dashLength: [5, 5] }
    }];
    
    // Add legend labels and grid markings based on units
    var lowValue, highValue, midValue, rangeFrom, rangeTo;
    var lowLabel, highLabel;
    
    if (displayUnits === 'mmol') {
      lowValue = 3.9;
      midValue = 7.8;
      highValue = 10.0;
      rangeFrom = 3.9;
      rangeTo = 10.0;
      lowLabel = 'Low (3.9)';
      highLabel = 'High (10.0)';
    } else {
      lowValue = 70;
      midValue = 140;
      highValue = 180;
      rangeFrom = 70;
      rangeTo = 180;
      lowLabel = 'Low (70)';
      highLabel = 'High (180)';
    }
    
    chartData.push({
      label: lowLabel, data: [], color: '#214102'
    });
    chartData.push({
      label: highLabel, data: [], color: '#653403'
    });
    
    safePlot('#glucosedistribution-percentile-chart', chartData, {
      xaxis: { mode: 'time', timezone: 'browser', timeformat: '%H:%M', tickColor: '#555' },
      yaxis: { min: yMin, max: yMax, tickColor: '#555' },
      legend: { position: 'nw', margin: [10, 10], noColumns: 5 },
      grid: {
        markings: [{
          color: 'rgba(0, 100, 0, 0.08)', yaxis: { from: rangeFrom, to: rangeTo }
        }, {
          color: '#214102', lineWidth: 2, dashStyle: [5, 5], yaxis: { from: lowValue, to: lowValue }
        }, {
          color: '#0a6b01', lineWidth: 2, dashStyle: [5, 5], yaxis: { from: midValue, to: midValue }
        }, {
          color: '#653403', lineWidth: 2, dashStyle: [5, 5], yaxis: { from: highValue, to: highValue }
        }]
      }
    });
    
    // Complete and clear progress
    updateProgress(100, translate('Rendering AGP Report') + '...');
    setTimeout(function() {
      $('#info').html('');
    }, 500);
    });
  }

  function onClick () {
    processGlucoseDistribution(datastorage, sorteddaystoshow, options, ss, translate, displayUnits, updateProgress);
  }
}
