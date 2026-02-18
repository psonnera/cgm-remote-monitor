'use strict';

var _ = require('lodash');
var $ = (global && global.$) || require('jquery');
var d3 = (global && global.d3) || require('d3');

var Storages = require('js-storage');

var language = require('../language')();
var sandbox = require('../sandbox')();
var units = require('../units')();
var levels = require('../levels');
var times = require('../times');
var receiveDData = require('./receiveddata');

var retro = {};

var moment = window.moment;
var timezones = moment.tz.names();

retro.init = function init(serverSettings, callback) {
  
  var browserSettings = require('./browser-settings');
  retro.settings = browserSettings(retro, serverSettings, $);
  
  language.set(retro.settings.language).DOMtranslate($);
  retro.translate = language.translate;
  retro.language = language;
  
  retro.plugins = require('../plugins/')({
    settings: retro.settings,
    extendedSettings: retro.settings.extendedSettings,
    language: language,
    levels: levels,
    moment: moment
  }).registerClientDefaults();
  
  browserSettings.loadPluginSettings(retro);
  
  retro.utils = require('../utils')({
    settings: retro.settings,
    language: language,
    moment: moment
  });
  
  retro.browserUtils = require('./browser-utils')($);
  
  retro.rawbg = retro.plugins('rawbg');
  retro.delta = retro.plugins('delta');
  retro.timeago = retro.plugins('timeago');
  retro.direction = retro.plugins('direction');
  retro.errorcodes = retro.plugins('errorcodes');
  
  // Initialize containers
  var container = $('.container');
  var bgStatus = $('.bgStatus');
  var currentBG = $('.bgStatus .currentBG');
  var directionPill = $('.bgStatus .pill.direction');
  var majorPills = $('.bgStatus .majorPills');
  var minorPills = $('.bgStatus .minorPills');
  var statusPills = $('.status .statusPills');
  
  retro.tooltip = d3.select('body').append('div')
    .attr('class', 'tooltip')
    .style('display', 'none');
  
  retro.ctx = {
    data: {},
    bus: require('../bus')(retro.settings, retro.ctx),
    settings: retro.settings,
    pluginBase: retro.plugins.base(majorPills, minorPills, statusPills, bgStatus, retro.tooltip, Storages.localStorage),
    moment: moment,
    timezones: timezones
  };
  
  retro.ctx.language = language;
  levels.translate = language.translate;
  retro.ctx.levels = levels;
  
  retro.ctx.notifications = require('../notifications')(retro.settings, retro.ctx);
  
  retro.now = Date.now();
  retro.dataLastUpdated = 0;
  retro.ddata = require('../data/ddata')();
  retro.defaultForecastTime = times.mins(30).msecs;
  retro.forecastTime = retro.now + retro.defaultForecastTime;
  retro.entries = [];
  retro.ticks = require('./ticks');
  
  retro.sbx = sandbox.clientInit(retro.ctx, retro.now);
  retro.renderer = require('./renderer')(retro, d3, $);
  
  retro.focusRangeMS = times.hours(24).msecs; // Default to 24-hour display window
  retro.formatTime = formatTime;
  retro.dataUpdate = dataUpdate;
  retro.loadRetroIfNeeded = function() {}; // Stub for chart.js compatibility
  
  var profile = require('../profilefunctions')(null, retro.ctx);
  retro.profilefunctions = profile;
  
  retro.entryToDate = function entryToDate(entry) {
    if (entry.date) return entry.date;
    entry.date = new Date(entry.mills);
    return entry.date;
  };
  
  retro.bottomOfPills = function bottomOfPills() {
    var bgStatus = $('.bgStatus');
    var statusBox = $('.statusBox');
    var bottomOfBgStatus = bgStatus.offset() ? bgStatus.offset().top + bgStatus.height() : 0;
    var bottomOfStatus = statusBox.offset() ? statusBox.offset().top + statusBox.height() : 0;
    return Math.max(bottomOfBgStatus, bottomOfStatus);
  };
  
  retro.dataExtent = function dataExtent() {
    if (retro.entries.length > 0) {
      return [retro.entries[0].date, retro.entries[retro.entries.length - 1].date];
    } else if (retro.requestedTimeRange) {
      // Use the requested time range when no data is available
      return [new Date(retro.requestedTimeRange.from), new Date(retro.requestedTimeRange.to)];
    } else {
      return [new Date(retro.now - times.hours(3).msecs), new Date(retro.now)];
    }
  };
  
  function formatTime(time, compact) {
    var FORMAT_TIME_12 = '%-I:%M %p';
    var FORMAT_TIME_12_COMPACT = '%-I:%M';
    var FORMAT_TIME_24 = '%H:%M';
    var FORMAT_TIME_12_SCALE = '%-I %p';
    var FORMAT_TIME_24_SCALE = '%H';
    
    var timeFormat = retro.settings.timeFormat === 24 ? FORMAT_TIME_24 : 
                     (compact ? FORMAT_TIME_12_COMPACT : FORMAT_TIME_12);
    
    time = d3.timeFormat(timeFormat)(time);
    if (retro.settings.timeFormat !== 24) {
      time = time.toLowerCase();
    }
    return time;
  }
  
  function formatDateWithTime(date) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = new Date(date);
    var day = d.getDate();
    var month = months[d.getMonth()];
    var timeStr = formatTime(d, true);
    return day + ' ' + month + ' ' + timeStr;
  }
  
  function scaleBg(bg) {
    if (retro.settings.units === 'mmol') {
      return bg / 18;
    } else {
      return bg;
    }
  }
  
  function generateTitle() {
    function s(value, sep) {
      return value ? sep + value : '';
    }
    
    var title = '';
    var status = retro.timeago.checkStatus(retro.sbx);
    
    if (status !== 'current') {
      title = s(retro.sbx.lastEntry().sgv, '') + ' ' + status;
    } else if (retro.latestSGV) {
      var currentMgdl = retro.latestSGV.mgdl;
      
      if (currentMgdl < 39) {
        title = s(retro.errorcodes.toDisplay(currentMgdl), '') + s(retro.timeago.checkStatus(retro.sbx), ' ');
      } else {
        var deltaDisplay = retro.delta && retro.delta.calc(retro.sbx).display;
        title = s(scaleBg(currentMgdl), '') + s(deltaDisplay, ' ') + s(retro.direction.info(retro.sbx).label, ' ') + s(retro.timeago.checkStatus(retro.sbx), ' ');
      }
    }
    return title;
  }
  
  function updateTitle() {
    $(document).attr('title', 'Retro: ' + generateTitle());
  }
  
  function sgvToColoredRange(sgv) {
    var range = '';
    if (retro.settings.theme !== 'default') {
      if (sgv > retro.settings.thresholds.bgHigh) {
        range = 'urgent';
      } else if (sgv > retro.settings.thresholds.bgTargetTop) {
        range = 'warning';
      } else if (sgv >= retro.settings.thresholds.bgTargetBottom && sgv <= retro.settings.thresholds.bgTargetTop && retro.settings.theme === 'colors') {
        range = 'inrange';
      } else if (sgv < retro.settings.thresholds.bgLow) {
        range = 'urgent';
      } else if (sgv < retro.settings.thresholds.bgTargetBottom) {
        range = 'warning';
      }
    }
    return range;
  }

  function brushed() {
    // Get the brushed range from the chart if available, otherwise use full data extent
    var brushExtent = retro.chart && retro.chart.createBrushedRange ?
      retro.chart.createBrushedRange() : retro.dataExtent();

    function adjustCurrentSGVClasses(value, isCurrent) {
      var bgClasses = 'urgent warn inrange';
      currentBG.removeClass(bgClasses);

      if (value) {
        currentBG.addClass(sgvToColoredRange(value));
      }

      container.toggleClass('loading', !isCurrent);
    }

    function updateCurrentSGV(entry) {
      var value = entry.mgdl || entry.sgv;
      if (!value) {
        clearCurrentSGV();
        return;
      }

      var isCurrent = retro.timeago.checkStatus(retro.sbx) === 'current';

      if (value < 39) {
        currentBG.text(retro.errorcodes.toDisplay(value));
        directionPill.text('');
      } else {
        currentBG.text(scaleBg(value));
        directionPill.text(retro.direction.info(retro.sbx).label);
      }

      adjustCurrentSGVClasses(value, isCurrent);
    }

    function clearCurrentSGV() {
      currentBG.text('---');
      directionPill.text('');
      container.removeClass('loading');
    }

    function updatePlugins(time) {
      // Ensure devicestatus is at least an empty array to prevent plugin errors
      // Don't create fake entries - let plugins handle empty data gracefully
      if (!retro.ddata.devicestatus) {
        retro.ddata.devicestatus = [];
      }

      retro.sbx = sandbox.clientInit(
        retro.ctx,
        time,
        retro.ddata
      );

      // Wrap plugin calls in try-catch to prevent crashes from missing data
      try {
        retro.plugins.setProperties(retro.sbx);
      } catch (err) {
      }

      try {
        retro.plugins.updateVisualisations(retro.sbx);
      } catch (err) {
      }
    }

    var nowDate = null;
    var brushStart = brushExtent[0].getTime();
    var brushEnd = brushExtent[1].getTime();

    // Filter entries to those within the focused/brushed range
    var nowData = retro.entries.filter(function(d) {
      return d.type === 'sgv' && d.mills >= brushStart && d.mills <= brushEnd;
    });

    // If no data in focused range, fall back to all SGV data
    if (nowData.length === 0) {
      nowData = retro.entries.filter(function(d) {
        return d.type === 'sgv';
      });
    }

    // Use the last data point in the focused range for both BG display and plugin context
    var focusPoint = _.last(nowData);

    if (focusPoint) {
      retro.latestSGV = focusPoint;
      updateCurrentSGV(focusPoint);
      // Use the time of the last actual data point for plugin calculations
      nowDate = focusPoint.mills;
      // Update the clock to show the date and time of the last data point in focus
      $('#currentTime').text(formatDateWithTime(nowDate));
    } else {
      clearCurrentSGV();
      $('#currentTime').text('---');
      // Use the end of the brush range as the time for plugin calculations
      nowDate = brushEnd;
    }

    // Always update plugins with the current time (either from data or brush end)
    updatePlugins(nowDate);

    updateTitle();
    container.removeClass('loading');
  }

  retro.brushed = brushed;
  
  function prepareEntries() {
    var temp1 = [];
    var sbx = retro.sbx.withExtendedSettings(retro.rawbg);
    
    // Function to determine dot color based on BG value and range thresholds
    function sgvToColor(sgv) {
      var color = 'grey';
      
      if (retro.settings.theme !== 'default') {
        if (sgv > retro.settings.thresholds.bgHigh) {
          color = 'red';
        } else if (sgv > retro.settings.thresholds.bgTargetTop) {
          color = 'yellow';
        } else if (sgv >= retro.settings.thresholds.bgTargetBottom && sgv <= retro.settings.thresholds.bgTargetTop && retro.settings.theme === 'colors') {
          color = '#4cff00';
        } else if (sgv < retro.settings.thresholds.bgLow) {
          color = 'red';
        } else if (sgv < retro.settings.thresholds.bgTargetBottom) {
          color = 'yellow';
        }
      }
      
      return color;
    }
    
    // Initialize arrays if missing
    if (!retro.ddata.sgvs) retro.ddata.sgvs = [];
    if (!retro.ddata.mbgs) retro.ddata.mbgs = [];
    
    if (retro.ddata.cal && retro.rawbg.isEnabled(sbx)) {
      temp1 = retro.ddata.sgvs.map(function(obj) {
        var mgdl = obj.mgdl || obj.sgv;
        var rawbg = retro.rawbg.showRawBGs(mgdl, obj.noise, retro.ddata.cal, sbx) ? obj : null;
        if (rawbg !== null) {
          return { mills: obj.mills, mgdl: mgdl, color: 'white', type: 'rawbg', noFade: true };
        } else {
          return null;
        }
      }).filter(function(obj) { return obj !== null; });
    }
    
    var temp2 = retro.ddata.sgvs.map(function(obj) {
      var mgdl = obj.mgdl || obj.sgv;
      return { mills: obj.mills, mgdl: mgdl, direction: obj.direction, color: sgvToColor(mgdl), type: 'sgv', noise: obj.noise, filtered: obj.filtered, unfiltered: obj.unfiltered };
    });
    
    retro.entries = [];
    retro.entries = retro.entries.concat(temp1, temp2);
    
    if (retro.ddata.mbgs && retro.ddata.mbgs.length > 0) {
      retro.entries = retro.entries.concat(retro.ddata.mbgs.map(function(obj) {
        return { mills: obj.mills, mgdl: obj.mgdl, color: 'red', type: 'mbg', device: obj.device };
      }));
    }
    
    // In retro mode, don't filter by 48-hour window since we're loading specific time ranges
    // The server already filters the data based on the requested time range
    // Only filter out entries with invalid mgdl values
    /*
    var tooOld = retro.now - times.hours(48).msecs;
    retro.entries = _.filter(retro.entries, function notTooOld(entry) {
      return entry.mills >= tooOld;
    });
    */
    
    retro.entries.forEach(function(point) {
      if (point.mgdl < 39) {
        point.color = 'transparent';
      }
    });
    
    retro.entries.sort(function sorter(a, b) {
      return a.mills - b.mills;
    });
    
    // Add date property to all entries
    retro.entries.forEach(function(entry) {
      retro.entryToDate(entry);
    });
  }
  
  function dataUpdate(received, headless) {
    var lastUpdated = Date.now();
    retro.dataLastUpdated = lastUpdated;
    
    receiveDData(received, retro.ddata, retro.settings);

    // Update retro.now to the latest data time, or use requested time range if no data
    if (retro.ddata.sgvs && retro.ddata.sgvs.length > 0) {
      retro.now = retro.ddata.sgvs[retro.ddata.sgvs.length - 1].mills;
    } else if (retro.requestedTimeRange) {
      // Use end of requested time range when no data is available
      retro.now = retro.requestedTimeRange.to;
    }
    
    retro.profilefunctions.updateTreatments(retro.ddata.profileTreatments, retro.ddata.tempbasalTreatments, retro.ddata.combobolusTreatments);
    
    if (received.profiles) {
      retro.profilefunctions.loadData(received.profiles);
    }
    
    if (retro.ddata.sgvs) {
      retro.latestSGV = retro.ddata.sgvs[retro.ddata.sgvs.length - 1];
    }
    
    retro.ddata.inRetroMode = true;
    retro.ddata.profile = profile;
    
    // Initialize devicestatus if not present to prevent plugin errors
    if (!retro.ddata.devicestatus) {
      retro.ddata.devicestatus = [];
    }
    // Ensure devicestatus[0] exists and has expected properties to avoid plugin errors
    if (!retro.ddata.devicestatus[0]) {
      retro.ddata.devicestatus[0] = {};
    }
    if (!retro.ddata.devicestatus[0].uploader) {
      retro.ddata.devicestatus[0].uploader = {};
    }
    if (!retro.ddata.devicestatus[0].devices) {
      retro.ddata.devicestatus[0].devices = [];
    }
    
    retro.nowSBX = sandbox.clientInit(
      retro.ctx,
      lastUpdated,
      retro.ddata
    );
    
    retro.plugins.setProperties(retro.nowSBX);
    
    prepareEntries();
    updateTitle();

    // Always determine the correct data range for the chart
    let dataRange;
    if (retro.entries.length > 0) {
      dataRange = [retro.entries[0].date, retro.entries[retro.entries.length - 1].date];
    } else if (retro.requestedTimeRange) {
      dataRange = [new Date(retro.requestedTimeRange.from), new Date(retro.requestedTimeRange.to)];
    } else {
      dataRange = [new Date(retro.now - times.hours(3).msecs), new Date(retro.now)];
    }

    if (retro.chart && retro.chart.xScale) {
      retro.chart.xScale.domain(dataRange);
      if (retro.chart.xScaleBasals) retro.chart.xScaleBasals.domain(dataRange);
    }

    if (headless) return;

    // Initialize or update chart (even if no entries, to show empty time range)
    if (!retro.chart) {
      // Only create chart if we have some entries initially
      if (retro.entries.length === 0) {
        return;
      }
      retro.chart = require('./chart')(retro, d3, $);
      retro.chart.update(true);
      retro.chart.scroll(retro.now);
      brushed();
    } else {
      // Update existing chart even with no entries (to show empty time range)
      retro.chart.update(false);
      retro.chart.scroll(retro.now);
      brushed();
    }
  }
  
  retro.brushed = brushed;
  
  // Initialize socket connection
  var socket = io.connect({ transports: ["polling"] });
  retro.socket = socket;
  
  socket.on('connect', function() {
    var auth_data = {
      client: 'web-retro',
      secret: null, // Add auth if needed
      token: null,
      history: 48
    };
    
    socket.emit('authorize', auth_data, function authCallback(data) {
      // Authorized
    });
  });
  
  socket.on('dataUpdate', function(received) {
    if (!retro.ddata || !retro.ddata.inRetroMode) {
      dataUpdate(received, false);
    }
  });
  
  // Load initial data for a specific time range
  retro.loadDataForTimeRange = function loadDataForTimeRange(from, to) {
    // Store the requested time range so we can use it even if no data is returned
    retro.requestedTimeRange = { from: from, to: to };

    socket.emit('loadRetro', {
      sgv: true,
      treatments: true,
      devicestatus: true,
      profile: true,
      from: from,
      to: to
    });
  };
  
  socket.on('retroUpdate', function retroUpdate(retroData) {
    if (retroData) {
      dataUpdate(retroData, false);
    }
  });
  
  // Initial load - yesterday (midnight to midnight)
  var now = new Date();
  var yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  var todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  
  var from = yesterday.getTime();
  var to = todayMidnight.getTime();
  
  retro.loadDataForTimeRange(from, to);
  
  // Set up time range selector
  retro.setTimeRange = function setTimeRange(hours) {
    retro.focusRangeMS = times.hours(hours).msecs;
    if (retro.chart) {
      retro.chart.update(false);
    }
  };
  
  // Set up date selector
  retro.setDateRange = function setDateRange(startDate, endDate) {
    var from = new Date(startDate).getTime();
    var to = new Date(endDate).getTime();
    retro.loadDataForTimeRange(from, to);
  };
  
  // Update clock for retro mode
  function updateClock() {
    if (retro.chart && retro.chart.inRetroMode && retro.chart.inRetroMode()) {
      var brushedRange = retro.chart.createBrushedRange();
      if (brushedRange && brushedRange[1]) {
        $('#currentTime').text(formatDateWithTime(brushedRange[1]));
      }
    }
    setTimeout(updateClock, 15000);
  }
  
  updateClock();
  
  // Date picker functionality
  retro.setupDatePicker = function setupDatePicker() {
    var dateInput = $('#retroDateInput');
    
    // Set default value to current retro date or yesterday
    var defaultDate = retro.now ? new Date(retro.now) : new Date();
    defaultDate.setDate(defaultDate.getDate() - 1);
    dateInput.val(defaultDate.toISOString().split('T')[0]);
    
    // Helper function to load a specific date
    var loadDate = function(date) {
      var startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      var endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      var from = startOfDay.getTime();
      var to = endOfDay.getTime();
      
      retro.loadDataForTimeRange(from, to);
      dateInput.val(startOfDay.toISOString().split('T')[0]);
    };
    
    // Trigger native date picker when calendar icon clicked
    $('#retroMenu').on('click', function(e) {
      e.preventDefault();
      // Update default value to current retro date
      if (retro.now) {
        var currentDate = new Date(retro.now);
        dateInput.val(currentDate.toISOString().split('T')[0]);
      }
      dateInput[0].showPicker();
    });
    
    // Load data immediately when date changes
    dateInput.on('change', function() {
      var selectedDate = dateInput.val();
      
      if (selectedDate) {
        loadDate(new Date(selectedDate + 'T12:00:00'));
      }
    });
    
    // Previous day button
    $('#prevDay').on('click', function(e) {
      e.preventDefault();
      var currentDate = retro.now ? new Date(retro.now) : new Date(dateInput.val() + 'T12:00:00');
      currentDate.setDate(currentDate.getDate() - 1);
      loadDate(currentDate);
    });
    
    // Next day button
    $('#nextDay').on('click', function(e) {
      e.preventDefault();
      var currentDate = retro.now ? new Date(retro.now) : new Date(dateInput.val() + 'T12:00:00');
      var nextDate = new Date(currentDate);
      nextDate.setDate(nextDate.getDate() + 1);
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      if (nextDate > today) {
        // Prevent navigating to a future date
        return;
      }
      loadDate(nextDate);
    });
  };
  
  retro.setupDatePicker();

// Helper function to change timespan
var availableHours = [2, 3, 4, 6, 12, 24];
function changeTimespan(direction) {
  var currentHours = Math.round(retro.focusRangeMS / times.hours(1).msecs);
  var currentIndex = availableHours.indexOf(currentHours);
  if (currentIndex === -1) {
    currentIndex = availableHours.length - 1; // Default to 24h if not found
    for (var i = 0; i < availableHours.length; i++) {
      if (availableHours[i] >= currentHours) {
        currentIndex = i;
        break;
      }
    }
  }
  
  var newIndex = currentIndex + direction;
  if (newIndex >= 0 && newIndex < availableHours.length) {
    var hours = availableHours[newIndex];
    retro.focusRangeMS = times.hours(hours).msecs;
    
    // Update the focus range selector UI if it exists
    $('.focus-range li').removeClass('selected');
    $('.focus-range li[data-hours=' + hours + ']').addClass('selected');
    
    // Force chart to update with new focus range
    if (retro.chart) {
      // Get the current brush center or end point
      var currentBrushExtent = retro.chart.createBrushedRange ? retro.chart.createBrushedRange() : retro.dataExtent();
      var centerTime = currentBrushExtent[1].getTime(); // Use the end time as anchor
      
      // Create new brush extent with updated focus range, anchored to the end
      var newStart = new Date(centerTime - retro.focusRangeMS);
      var newEnd = new Date(centerTime);
      
      // Make sure we don't go beyond data boundaries
      var dataExtent = retro.dataExtent();
      if (newStart.getTime() < dataExtent[0].getTime()) {
        newStart = dataExtent[0];
      }
      if (newEnd.getTime() > dataExtent[1].getTime()) {
        newEnd = dataExtent[1];
      }
      
      // Update the brush if it exists
      if (retro.chart.brush && retro.chart.theBrush && retro.chart.xScale2) {
        retro.chart.theBrush.call(retro.chart.brush.move, [newStart, newEnd].map(retro.chart.xScale2));
      }
      
      // Force a full chart redraw with the new focus range
      retro.chart.update(true);
      
      // Scroll to the current time to ensure focus is updated
      retro.chart.scroll(centerTime);
      
      // Trigger brushed to update the display
      if (retro.brushed) {
        retro.brushed();
      }
    }
  }
}

// Mouse wheel support on chart container
var wheelTimeout;
$('#chartContainer').on('wheel', function(e) {
  e.preventDefault();
  clearTimeout(wheelTimeout);
  wheelTimeout = setTimeout(function() {
    var direction = e.originalEvent.deltaY > 0 ? 1 : -1;
    changeTimespan(direction);
  }, 100);
});

// Pinch-to-zoom support for touch devices
var touchStartDistance = null;
var lastPinchTime = 0;

$('#chartContainer').on('touchstart', function(e) {
  if (e.originalEvent.touches.length === 2) {
    var touch1 = e.originalEvent.touches[0];
    var touch2 = e.originalEvent.touches[1];
    var dx = touch2.clientX - touch1.clientX;
    var dy = touch2.clientY - touch1.clientY;
    touchStartDistance = Math.sqrt(dx * dx + dy * dy);
  }
});

// Use native addEventListener for touchmove to support { passive: false }
var chartContainer = document.getElementById('chartContainer');
if (chartContainer) {
  chartContainer.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2 && touchStartDistance !== null) {
      e.preventDefault();
      var touch1 = e.touches[0];
      var touch2 = e.touches[1];
      var dx = touch2.clientX - touch1.clientX;
      var dy = touch2.clientY - touch1.clientY;
      var currentDistance = Math.sqrt(dx * dx + dy * dy);
      
      var delta = currentDistance - touchStartDistance;
      
      var now = Date.now();
      if (Math.abs(delta) > 30 && now - lastPinchTime > 200) {
        var direction = delta < 0 ? 1 : -1;
        changeTimespan(direction);
        touchStartDistance = currentDistance;
        lastPinchTime = now;
      }
    }
  }, { passive: false });
}

$('#chartContainer').on('touchend touchcancel', function() {
  touchStartDistance = null;
});

  window.onresize = function() {
    if (retro.chart) {
      retro.chart.update(false);
    }
  };
  
  if (callback) {
    callback();
  }
};

module.exports = retro;
