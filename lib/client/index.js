
'use strict';

const _ = require('lodash');
const $ = (global && global.$) || require('jquery');
const d3 = (global && global.d3) || require('d3');
const shiroTrie = require('shiro-trie');

const Storages = require('js-storage');

const language = require('../language')();
const sandbox = require('../sandbox')();
const units = require('../units')();
const levels = require('../levels');
const times = require('../times');
const receiveDData = require('./receiveddata');

let brushing = false;

let browserSettings;
const moment = window.moment;
const timezones = moment.tz.names();

const client = {};

const hashauth = require('./hashauth');
client.hashauth = hashauth.init(client, $);

const loadingMessageText = document.getElementById('loadingMessageText');
const centerMessagePanel = document.getElementById('centerMessagePanel');
const currentTimeEl = document.getElementById('currentTime');
const customTitleEls = document.querySelectorAll('.customTitle');
const chartContainerEl = document.getElementById('chartContainer');
const bodyEl = document.body;
const agpButtonEl = document.getElementById('agpButton');
const testAlarmsEl = document.getElementById('testAlarms');
const appNameEl = document.querySelector('.appName');
const versionEl = document.querySelector('.version');
const headEl = document.querySelector('.head');
const serverSettingsEl = document.querySelector('.serverSettings');
const foodControlEl = document.querySelector('.foodcontrol');
const cobControlEl = document.querySelector('.cobcontrol');
const focusRangeEl = document.querySelector('.focus-range');
const focusRangeItems = document.querySelectorAll('.focus-range li');
const editButtonEl = document.getElementById('editbutton');
const lockedToggleEl = document.getElementById('lockedToggle');
const treatmentDrawerToggleEl = document.getElementById('treatmentDrawerToggle');
const boluscalcDrawerToggleEl = document.getElementById('boluscalcDrawerToggle');
const silenceBtnEl = document.getElementById('silenceBtn');
const viewMenuEl = document.getElementById('viewMenu');
const setLoadingMessage = (message) => {
  if (loadingMessageText) loadingMessageText.textContent = message;
};
const setCenterMessageVisible = (isVisible) => {
  if (centerMessagePanel) centerMessagePanel.style.display = isVisible ? '' : 'none';
};
const setCustomTitle = (message) => {
  if (!customTitleEls.length) return;
  customTitleEls.forEach((el) => {
    el.textContent = message;
  });
};
const setCurrentTimeText = (text, isStrikethrough) => {
  if (!currentTimeEl) return;
  currentTimeEl.textContent = text;
  currentTimeEl.style.textDecoration = isStrikethrough ? 'line-through' : '';
};
const setText = (el, text) => {
  if (el) el.textContent = text;
};
const setVisible = (el, isVisible) => {
  if (el) el.style.display = isVisible ? '' : 'none';
};
const setSelectedIcon = (el, isSelected) => {
  if (!el) return;
  var icon = el.querySelector('i');
  if (!icon) return;
  if (isSelected) {
    icon.classList.add('selected');
  } else {
    icon.classList.remove('selected');
  }
};
const setFocusRangeSelected = (hours) => {
  if (!focusRangeItems.length) return;
  var selectedHours = Number(hours);
  focusRangeItems.forEach((item) => {
    var itemHours = Number(item.getAttribute('data-hours'));
    if (item.getAttribute('data-hours') && itemHours === selectedHours) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
};

// DOM Manager: centralizes DOM element references and UI state operations
const DOMManager = {
  // UI Message Elements
  messages: {
    loading: loadingMessageText,
    center: centerMessagePanel,
    setLoading: (msg) => { if (loadingMessageText) loadingMessageText.textContent = msg; },
    setCenterVisible: (visible) => { if (centerMessagePanel) centerMessagePanel.style.display = visible ? '' : 'none'; },
  },
  
  // Display Elements
  display: {
    currentTime: currentTimeEl,
    customTitles: customTitleEls,
    setCurrentTime: (text, strikethrough) => {
      if (!currentTimeEl) return;
      currentTimeEl.textContent = text;
      currentTimeEl.style.textDecoration = strikethrough ? 'line-through' : '';
    },
    setCustomTitle: (msg) => {
      if (!customTitleEls.length) return;
      customTitleEls.forEach((el) => { el.textContent = msg; });
    },
  },
  
  // Control Elements
  controls: {
    editButton: editButtonEl,
    lockedToggle: lockedToggleEl,
    treatmentDrawer: treatmentDrawerToggleEl,
    boluscalcDrawer: boluscalcDrawerToggleEl,
    silenceBtn: silenceBtnEl,
    setEditButtonVisible: (visible) => { if (editButtonEl) editButtonEl.style.display = visible ? '' : 'none'; },
    setEditButtonIcon: (selected) => {
      if (!editButtonEl) return;
      const icon = editButtonEl.querySelector('i');
      if (!icon) return;
      icon.classList.toggle('selected', selected);
    },
    setControlVisible: (el, visible) => { if (el) el.style.display = visible ? '' : 'none'; },
  },
  
  // Info Elements
  info: {
    appName: appNameEl,
    version: versionEl,
    head: headEl,
    serverSettings: serverSettingsEl,
    foodControl: foodControlEl,
    cobControl: cobControlEl,
    setText: (el, text) => { if (el) el.textContent = text; },
    setInfoVisible: (el, visible) => { if (el) el.style.display = visible ? '' : 'none'; },
  },
  
  // Chart Elements
  chart: {
    container: chartContainerEl,
    body: bodyEl,
    viewMenu: viewMenuEl,
    focusRange: focusRangeEl,
    setChartSize: (top, height) => {
      if (chartContainerEl) {
        chartContainerEl.style.top = top + 'px';
        chartContainerEl.style.height = height + 'px';
      }
    },
    setBodyOpacity: (opacity) => { if (bodyEl) bodyEl.style.opacity = String(opacity); },
  },
};

setLoadingMessage('Connecting to server');

// Performance utilities for optimized event handling and UI updates
const PerfUtils = {
  // Debounce a function to limit how often it runs
  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },
  
  // Throttle a function to run at most once per interval
  throttle: (func, limit) => {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },
  
  // Batch DOM reads/writes to avoid layout thrashing
  batch: {
    updates: [],
    scheduled: false,
    schedule: (fn) => {
      PerfUtils.batch.updates.push(fn);
      if (!PerfUtils.batch.scheduled) {
        PerfUtils.batch.scheduled = true;
        requestAnimationFrame(() => {
          PerfUtils.batch.updates.forEach(f => f());
          PerfUtils.batch.updates = [];
          PerfUtils.batch.scheduled = false;
        });
      }
    }
  }
};

client.headers = () => {
  if (client.authorized) {
    return {
      Authorization: 'Bearer ' + client.authorized.token
    };
  } else if (client.hashauth) {
    return {
      'api-secret': client.hashauth.hash()
    };
  } else {
    return {};
  }
};

client.crashed = () => {
  DOMManager.messages.setCenterVisible(true);
  DOMManager.messages.setLoading('It appears the server has crashed. Please go to Heroku and reboot the server.');
};

client.init = function init (callback) {

  client.browserUtils = require('./browser-utils')($);

  var token = client.browserUtils.queryParms().token;
  var secret = client.hashauth.apisecrethash || Storages.localStorage.get('apisecrethash');

  var src = '/api/v1/status.json?t=' + new Date().getTime();

  if (secret) {
    src += '&secret=' + secret;
  } else if (token) {
    src += '&token=' + token;
  }

  const fetchStatus = async () => {
    try {
      const response = await fetch(src, {
        method: 'GET',
        headers: client.headers()
      });
      if (!response.ok) throw new Error('Network response was not ok');
      const serverSettings = await response.json();
      if (serverSettings.runtimeState !== 'loaded') {
        DOMManager.messages.setLoading('Server is starting and still loading data, retrying load in 5 seconds');
        window.setTimeout(() => client.init(callback), 5000);
        return;
      }
      client.settingsFailed = false;
      client.loadLanguage(serverSettings, callback);
    } catch (error) {
      // check if we couldn't reach the server at all, show offline message
      if (error && error.message === 'Failed to fetch') {
        DOMManager.messages.setLoading('Connecting to Nightscout server failed, retrying every 5 seconds');
        window.setTimeout(() => client.init(callback), 5000);
        return;
      }

      // no server setting available, use defaults, auth, etc
      if (client.settingsFailed) {
      } else {
        client.settingsFailed = true;

        // detect browser language
        var lang = Storages.localStorage.get('language') || (navigator.language || navigator.userLanguage).toLowerCase();
        if (lang !== 'zh_cn' && lang !== 'zh-cn' && lang !== 'zh_tw' && lang !== 'zh-tw') {
          lang = lang.substring(0, 2);
        } else {
          lang = lang.replace('-', '_');
        }
        if (language.languages.find(l => l.code === lang)) {
          language.set(lang);
        } else {
          language.set('en');
        }

        client.translate = language.translate;
        // auth failed, hide loader and request for key
        DOMManager.messages.setCenterVisible(false);
        client.hashauth.requestAuthentication(function afterRequest () {
          window.setTimeout(() => client.init(callback), 5000);
        });
      }
    }
  };
  fetchStatus();

};

client.loadLanguage = function loadLanguage (serverSettings, callback) {

  DOMManager.messages.setLoading('Loading language file');

  browserSettings = require('./browser-settings');
  client.settings = browserSettings(client, serverSettings, $);

  let filename = language.getFilename(client.settings.language);

  const fetchLanguage = async () => {
    try {
      const response = await fetch('/translations/' + filename);
      if (!response.ok) throw new Error('Failed to load language');
      const localization = await response.json();
      language.offerTranslations(localization);
      DOMManager.messages.setCenterVisible(false);
      client.load(serverSettings, callback);
    } catch (error) {
      DOMManager.messages.setCenterVisible(false);
      client.load(serverSettings, callback);
    }
  };
  fetchLanguage();

}

client.load = function load (serverSettings, callback) {

  var FORMAT_TIME_12 = '%-I:%M %p'
    , FORMAT_TIME_12_COMPACT = '%-I:%M'
    , FORMAT_TIME_24 = '%H:%M%'
    , FORMAT_TIME_12_SCALE = '%-I %p'
    , FORMAT_TIME_24_SCALE = '%H';

  var history = 48;

  var chart
    , socket
	, alarmSocket
    , isInitialData = false
    , opacity = { current: 1, DAY: 1, NIGHT: 0.5 }
    , clientAlarms = {}
    , alarmInProgress = false
    , alarmMessage
    , currentNotify
    , currentAnnouncement
    , alarmSound = 'alarm.mp3'
    , urgentAlarmSound = 'alarm2.mp3'
    , previousNotifyTimestamp;

  client.entryToDate = function entryToDate (entry) {
    if (entry.date) return entry.date;
    entry.date = new Date(entry.mills);
    return entry.date;
  };

  client.now = Date.now();
  client.dataLastUpdated = 0;
  client.lastPluginUpdateTime = 0;
  client.ddata = require('../data/ddata')();
  client.defaultForecastTime = times.mins(30).msecs;
  client.forecastTime = client.now + client.defaultForecastTime;
  client.entries = [];
  client.ticks = require('./ticks');

  //containers
  const container = document.querySelector('.container');
  const bgStatus = $('.bgStatus'); // Keep as jQuery for plugin compatibility
  const currentBG = document.querySelector('.bgStatus .currentBG');
  const majorPills = $('.bgStatus .majorPills'); // Keep as jQuery for plugin compatibility
  const minorPills = $('.bgStatus .minorPills'); // Keep as jQuery for plugin compatibility
  const statusPills = $('.status .statusPills'); // Keep as jQuery for plugin compatibility
  const primary = $('.primary'); // Keep as jQuery for offset/height methods

  // Helper function to safely toggle classes on container (may not exist on report page)
  const updateContainerClass = (method, klass, condition) => {
    if (container) {
      if (method === 'toggle') container.classList.toggle(klass, condition);
      else if (method === 'add') container.classList.add(klass);
      else if (method === 'remove') container.classList.remove(...klass.split(' '));
    }
  };

  client.tooltip = d3.select('body').append('div')
    .attr('class', 'tooltip')
    .style('display', 'none');

  client.settings = browserSettings(client, serverSettings, $);

  language.set(client.settings.language).DOMtranslate($);
  client.translate = language.translate;
  client.language = language;

  client.plugins = require('../plugins/')({
    settings: client.settings
    , extendedSettings: client.settings.extendedSettings
    , language: language
    , levels: levels
    , moment: moment
  }).registerClientDefaults();

  browserSettings.loadPluginSettings(client);

  client.utils = require('../utils')({
    settings: client.settings
    , language: language
    , moment: moment
  });

  client.rawbg = client.plugins('rawbg');
  client.delta = client.plugins('delta');
  client.timeago = client.plugins('timeago');
  client.direction = client.plugins('direction');
  client.errorcodes = client.plugins('errorcodes');

  client.ctx = {
    data: {}
    , bus: require('../bus')(client.settings, client.ctx)
    , settings: client.settings
    , pluginBase: client.plugins.base(majorPills, minorPills, statusPills, bgStatus, client.tooltip, Storages.localStorage)
    , moment: moment
    , timezones: timezones
  };

  client.ctx.language = language;
  levels.translate = language.translate;
  client.ctx.levels = levels;

  client.ctx.notifications = require('../notifications')(client.settings, client.ctx);

  client.sbx = sandbox.clientInit(client.ctx, client.now);
  client.renderer = require('./renderer')(client, d3, $);

  // store for last-50h device-status derived COB/IOB values
  client.last48 = {
    iob: [],
    cob: [],
    fetchedAt: 0
  };

  // Request last-50h device-status via retro load to initialize client.last48
  client.requestLast48DeviceStatus = function requestLast48DeviceStatus() {
    if (!client.socket) {
      // socket not ready yet
      return;
    }
    if (client._last48RequestInFlight) return;
    var to = Date.now();
    var from = to - times.hours(50).msecs;
    client._last48RequestInFlight = true;
    socket.emit('loadRetro', { devicestatus: true, from: from, to: to });
  };

  client.updateLast48FromDeviceStatus = function updateLast48FromDeviceStatus(devicestatusArray) {
    try {
      var to = Date.now();
      var from = to - times.hours(50).msecs;
      var iobPlugin = client.plugins && client.plugins('iob');
      var cobPlugin = client.plugins && client.plugins('cob');

      if (iobPlugin && iobPlugin.IOBDeviceStatusesInTimeRange) {
        client.last48.iob = iobPlugin.IOBDeviceStatusesInTimeRange(devicestatusArray || [], from, to);
      } else if (iobPlugin && iobPlugin.fromDeviceStatus) {
        client.last48.iob = (devicestatusArray || []).map(function(s){ try { return iobPlugin.fromDeviceStatus(s); } catch(e){ return {}; } }).filter(function(x){ return x && x.iob !== undefined; }).filter(function(x){ return x.mills >= from && x.mills <= to; }).sort(function(a,b){ return a.mills - b.mills; });
      } else {
        client.last48.iob = [];
      }

      if (cobPlugin && cobPlugin.COBDeviceStatusesInTimeRange) {
        client.last48.cob = cobPlugin.COBDeviceStatusesInTimeRange(devicestatusArray || [], from, to);
      } else if (cobPlugin && cobPlugin.fromDeviceStatus) {
        client.last48.cob = (devicestatusArray || []).map(function(s){ try { return cobPlugin.fromDeviceStatus(s); } catch(e){ return {}; } }).filter(function(x){ return x && x.cob !== undefined; }).filter(function(x){ return x.mills >= from && x.mills <= to; }).sort(function(a,b){ return a.mills - b.mills; });
      } else {
        client.last48.cob = [];
      }

      client.last48.fetchedAt = Date.now();
    } catch (e) {
    }
  };

  //After plugins are initialized with browser settings;
  browserSettings.loadAndWireForm();

  client.adminnotifies = require('./adminnotifiesclient')(client, $);

  if (serverSettings && serverSettings.authorized) {
    client.authorized = serverSettings.authorized;
    client.authorized.lat = Date.now();
    client.authorized.shiros = client.authorized.permissionGroups.map(function toShiro (group) {
      const shiro = shiroTrie.new();
      group.forEach(function eachPermission (permission) {
        shiro.add(permission);
      });
      return shiro;
    });

    client.authorized.check = function check (permission) {
      var found = client.authorized.shiros.find(function checkEach (shiro) {
        return shiro.check(permission);
      });

      return typeof found === 'object' && found !== null;
    };
  }

  client.afterAuth = function afterAuth (isAuthenticated) {

    var treatmentCreateAllowed = client.authorized ? client.authorized.check('api:treatments:create') : isAuthenticated;
    var treatmentUpdateAllowed = client.authorized ? client.authorized.check('api:treatments:update') : isAuthenticated;

    if (lockedToggleEl && !lockedToggleEl._nsBound) {
      lockedToggleEl.addEventListener('click', client.hashauth.requestAuthentication);
      lockedToggleEl._nsBound = true;
    }
  DOMManager.controls.setControlVisible(lockedToggleEl, !treatmentCreateAllowed && client.settings.showPlugins.indexOf('careportal') > -1);
  DOMManager.controls.setControlVisible(treatmentDrawerToggleEl, treatmentCreateAllowed && client.settings.showPlugins.indexOf('careportal') > -1);
  DOMManager.controls.setControlVisible(boluscalcDrawerToggleEl, treatmentCreateAllowed && client.settings.showPlugins.indexOf('boluscalc') > -1);
    setVisible(editButtonEl, client.settings.editMode && treatmentUpdateAllowed);
    if (editButtonEl) {
      editButtonEl.addEventListener('click', function editModeClick (event) {
        client.editMode = !client.editMode;
        if (client.editMode) {
          client.renderer.drawTreatments(client);
          DOMManager.controls.setEditButtonIcon(true);
        } else {
          chart.focus.selectAll('.draggable-treatment')
            .style('cursor', 'default')
            .on('mousedown.drag', null);
          DOMManager.controls.setEditButtonIcon(false);
        }
        if (event) { event.preventDefault(); }
      });
    }
  };

  client.hashauth.initAuthentication(client.afterAuth);

  client.focusRangeMS = times.hours(client.settings.focusHours).msecs;
  setFocusRangeSelected(client.settings.focusHours);
  client.brushed = brushed;
  client.formatTime = formatTime;
  client.dataUpdate = dataUpdate;

  client.careportal = require('./careportal')(client, $);
  client.boluscalc = require('./boluscalc')(client, $);

  var profile = require('../profilefunctions')(null, client.ctx);

  client.profilefunctions = profile;

  client.editMode = false;

  //TODO: use the bus for updates and notifications
  //client.ctx.bus.on('tick', function timedReload (tick) {
  //});
  //broadcast 'tock' event each minute, start a new setTimeout each time it fires make it happen on the minute
  //see updateClock
  //start the bus after setting up listeners
  //client.ctx.bus.uptime( );

  client.dataExtent = function dataExtent () {
    if (client.entries.length > 0) {
      return [client.entryToDate(client.entries[0]), client.entryToDate(client.entries[client.entries.length - 1])];
    } else {
      return [new Date(client.now - times.hours(history).msecs), new Date(client.now)];
    }
  };

  client.bottomOfPills = function bottomOfPills () {
    //the offset's might not exist for some tests
    var bottomOfPrimary = primary.offset() ? primary.offset().top + primary.height() : 0;
    var bottomOfMinorPills = minorPills.offset() ? minorPills.offset().top + minorPills.height() : 0;
    var bottomOfStatusPills = statusPills.offset() ? statusPills.offset().top + statusPills.height() : 0;
    return Math.max(bottomOfPrimary, bottomOfMinorPills, bottomOfStatusPills);
  };

  function formatTime (time, compact) {
    var timeFormat = getTimeFormat(false, compact);
    time = d3.timeFormat(timeFormat)(time);
    if (client.settings.timeFormat !== 24) {
      time = time.toLowerCase();
    }
    return time;
  }

  function getTimeFormat (isForScale, compact) {
    var timeFormat = FORMAT_TIME_12;
    if (client.settings.timeFormat === 24) {
      timeFormat = isForScale ? FORMAT_TIME_24_SCALE : FORMAT_TIME_24;
    } else {
      timeFormat = isForScale ? FORMAT_TIME_12_SCALE : (compact ? FORMAT_TIME_12_COMPACT : FORMAT_TIME_12);
    }

    return timeFormat;
  }

  //TODO: replace with utils.scaleMgdl and/or utils.roundBGForDisplay
  function scaleBg (bg) {
    if (client.settings.units === 'mmol') {
      return units.mgdlToMMOL(bg);
    } else {
      return bg;
    }
  }

  function generateTitle () {
    function s (value, sep) { return value ? value + ' ' : sep || ''; }

    var title = '';

    var status = client.timeago.checkStatus(client.sbx);

    if (status !== 'current') {
      var ago = client.timeago.calcDisplay(client.sbx.lastSGVEntry(), client.sbx.time);
      title = s(ago.value) + s(ago.label, ' - ') + title;
    } else if (client.latestSGV) {
      var currentMgdl = client.latestSGV.mgdl;

      if (currentMgdl < 39) {
        title = s(client.errorcodes.toDisplay(currentMgdl), ' - ') + title;
      } else {
        var delta = client.nowSBX.properties.delta;
        if (delta) {
          var deltaDisplay = delta.display;
          title = s(scaleBg(currentMgdl)) + s(deltaDisplay) + s(client.direction.info(client.latestSGV).label) + title;
        }
      }
    }
    return title;
  }

  function resetCustomTitle () {
    var customTitle = client.settings.customTitle || 'Nightscout';
    DOMManager.display.setCustomTitle(customTitle);
  }

  function checkAnnouncement () {
    var result = {
      inProgress: currentAnnouncement ? Date.now() - currentAnnouncement.received < times.mins(5).msecs : false
    };

    if (result.inProgress) {
      var message = currentAnnouncement.message.length > 1 ? currentAnnouncement.message : currentAnnouncement.title;
      result.message = message;
      DOMManager.display.setCustomTitle(message);
    } else if (currentAnnouncement) {
      currentAnnouncement = null;
    }

    return result;
  }

  function updateTitle () {

    var windowTitle;
    var announcementStatus = checkAnnouncement();

    if (alarmMessage && alarmInProgress) {
      DOMManager.display.setCustomTitle(alarmMessage);
      if (!isTimeAgoAlarmType()) {
        windowTitle = alarmMessage + ': ' + generateTitle();
      }
    } else if (announcementStatus.inProgress && announcementStatus.message) {
      windowTitle = announcementStatus.message + ': ' + generateTitle();
    } else {
      resetCustomTitle();
    }

    updateContainerClass('toggle', 'announcing', announcementStatus.inProgress);

    document.title = windowTitle || generateTitle();
  }

  // clears the current user brush and resets to the current real time data
  function updateBrushToNow (skipBrushing) {

    // update brush and focus chart with recent data
    var brushExtent = client.dataExtent();

    brushExtent[0] = new Date(brushExtent[1].getTime() - client.focusRangeMS);

    if (chart.theBrush) {
      chart.theBrush.call(chart.brush)
      chart.theBrush.call(chart.brush.move, brushExtent.map(chart.xScale2));
    }

    if (!skipBrushing) {
      brushed();
    }
  }

  function alarmingNow () {
    return container && container.classList.contains('alarming');
  }

  function inRetroMode () {
    return chart && chart.inRetroMode();
  }

  function brushed () {
    // Brush not initialized
    if (!chart.theBrush) {
      return;
    }

    if (brushing) {
      return;
    }

    brushing = true;

    // default to most recent focus period
    var brushExtent = client.dataExtent();
    brushExtent[0] = new Date(brushExtent[1].getTime() - client.focusRangeMS);

    var brushedRange = d3.brushSelection(chart.theBrush.node());

    if (brushedRange) {
      brushExtent = brushedRange.map(chart.xScale2.invert);
      // Update the main xScale domain to match the brush selection
      if (chart.xScale && typeof chart.xScale.domain === 'function') {
        chart.xScale.domain(brushExtent);
        if (window.console && window.console.debug) {
          console.debug('[brushed] Updated xScale domain to', brushExtent);
        }
      }
    }

    if (!brushedRange || (brushExtent[1].getTime() - brushExtent[0].getTime() !== client.focusRangeMS)) {
      // ensure that brush updating is with the time range
      if (brushExtent[0].getTime() + client.focusRangeMS > client.dataExtent()[1].getTime()) {
        brushExtent[0] = new Date(brushExtent[1].getTime() - client.focusRangeMS);
      } else {
        brushExtent[1] = new Date(brushExtent[0].getTime() + client.focusRangeMS);
      }

      chart.theBrush.call(chart.brush.move, brushExtent.map(chart.xScale2));
    }

    function adjustCurrentSGVClasses (value, isCurrent) {
      var reallyCurrentAndNotAlarming = isCurrent && !inRetroMode() && !alarmingNow();

      bgStatus.toggleClass('current', alarmingNow() || reallyCurrentAndNotAlarming);
      if (!alarmingNow()) {
        updateContainerClass('remove', 'urgent warning inrange', false);
        if (reallyCurrentAndNotAlarming) {
          updateContainerClass('add', sgvToColoredRange(value), false);
        }
      }
      currentBG.classList.toggle('icon-hourglass', value === 9);
      currentBG.classList.toggle('error-code', value < 39);
      currentBG.classList.toggle('bg-limit', value === 39 || value > 400);
    }

    function updateCurrentSGV (entry) {
      var value = entry.mgdl
        , isCurrent = 'current' === client.timeago.checkStatus(client.sbx);

      if (value === 9) {
        currentBG.textContent = '';
      } else if (value < 39) {
        currentBG.innerHTML = client.errorcodes.toDisplay(value);
      } else if (value < 40) {
        currentBG.textContent = 'LOW';
      } else if (value > 400) {
        currentBG.textContent = 'HIGH';
      } else {
        currentBG.textContent = scaleBg(value);
      }

      adjustCurrentSGVClasses(value, isCurrent);
    }

    function mergeDeviceStatus (retro, ddata) {
      if (!retro) {
        return ddata;
      }

      var result = retro.map(x => Object.assign(x, ddata.find(y => y._id == x._id)));

      var missingInRetro = ddata.filter(y => !retro.find(x => x._id == y._id));

      result.push(...missingInRetro);

      return result;
    }

    function updatePlugins (time) {

      if (time > client.lastPluginUpdateTime && time > client.dataLastUpdated) {
        if ((time - client.lastPluginUpdateTime) < 1000) {
          return; // Don't update the plugins more than once a second
        }
        client.lastPluginUpdateTime = time;
      }

      //TODO: doing a clone was slow, but ok to let plugins muck with data?
      //var ddata = client.ddata.clone();

      client.ddata.inRetroMode = inRetroMode();
      client.ddata.profile = profile;

      // retro data only ever contains device statuses
      // Cleate a clone of the data for the sandbox given to plugins

      var mergedStatuses = client.ddata.devicestatus;

      if (client.retro.data) {
        mergedStatuses = mergeDeviceStatus(client.retro.data.devicestatus, client.ddata.devicestatus);
      }

      var clonedData = Object.assign({}, client.ddata);
      clonedData.devicestatus = mergedStatuses;

      client.sbx = sandbox.clientInit(
        client.ctx
        , new Date(time).getTime() //make sure we send a timestamp
        , clonedData
      );

      //all enabled plugins get a chance to set properties, even if they aren't shown
      client.plugins.setProperties(client.sbx);

      //only shown plugins get a chance to update visualisations
      client.plugins.updateVisualisations(client.sbx);

      if (viewMenuEl) {
        viewMenuEl.innerHTML = '';
      }

  // Add event delegation for forecast menu changes to avoid re-attaching handlers
  if (viewMenuEl) {
    viewMenuEl.addEventListener('change', function(e) {
      if (e.target.type === 'checkbox' && e.target.getAttribute('data-forecast-type')) {
        var checkbox = e.target;
        var type = checkbox.getAttribute('data-forecast-type');
        var checked = checkbox.checked;
        if (checked) {
          client.settings.showForecast += ' ' + type;
        } else {
          client.settings.showForecast = _.chain(client.settings.showForecast.split(' '))
            .filter(function(forecast) { return forecast !== type; })
            .value()
            .join(' ');
        }
        Storages.localStorage.set('showForecast', client.settings.showForecast);
        refreshChart(true);
      }
    });
  }

      //send data to boluscalc too
      client.boluscalc.updateVisualisations(client.sbx);
    }

    function clearCurrentSGV () {
      currentBG.textContent = '---';
      updateContainerClass('remove', 'alarming urgent warning inrange', false);
    }

    var nowDate = null;
    var nowData = client.entries.filter(function(d) {
      return d.type === 'sgv' && d.mills <= brushExtent[1].getTime();
    });
    var focusPoint = nowData.length > 0 ? nowData[nowData.length - 1] : null;

    function updateHeader () {
      if (inRetroMode()) {
        nowDate = brushExtent[1];
        DOMManager.display.setCurrentTime(formatTime(nowDate, true), true);
      } else {
        nowDate = new Date(client.now);
        updateClockDisplay();
      }

      if (focusPoint) {
        if (brushExtent[1].getTime() - focusPoint.mills > times.mins(15).msecs) {
          clearCurrentSGV();
        } else {
          updateCurrentSGV(focusPoint);
        }
        updatePlugins(nowDate.getTime());
      } else {
        clearCurrentSGV();
        updatePlugins(nowDate);
      }
    }

    updateHeader();
    updateTimeAgo();
    if (chart.prevChartHeight) {
      chart.scroll(nowDate);
    }

    var top = (client.bottomOfPills() + 5);
    DOMManager.chart.setChartSize(top, window.innerHeight - top - 10);
updateContainerClass('remove', 'loading', false);

    brushing = false;
  }

  function sgvToColor (sgv) {
    var color = 'grey';

    if (client.settings.theme !== 'default') {
      if (sgv > client.settings.thresholds.bgHigh) {
        color = 'red';
      } else if (sgv > client.settings.thresholds.bgTargetTop) {
        color = 'yellow';
      } else if (sgv >= client.settings.thresholds.bgTargetBottom && sgv <= client.settings.thresholds.bgTargetTop && client.settings.theme === 'colors') {
        color = '#4cff00';
      } else if (sgv < client.settings.thresholds.bgLow) {
        color = 'red';
      } else if (sgv < client.settings.thresholds.bgTargetBottom) {
        color = 'yellow';
      }
    }

    return color;
  }

  function sgvToColoredRange (sgv) {
    var range = '';

    if (client.settings.theme !== 'default') {
      if (sgv > client.settings.thresholds.bgHigh) {
        range = 'urgent';
      } else if (sgv > client.settings.thresholds.bgTargetTop) {
        range = 'warning';
      } else if (sgv >= client.settings.thresholds.bgTargetBottom && sgv <= client.settings.thresholds.bgTargetTop && client.settings.theme === 'colors') {
        range = 'inrange';
      } else if (sgv < client.settings.thresholds.bgLow) {
        range = 'urgent';
      } else if (sgv < client.settings.thresholds.bgTargetBottom) {
        range = 'warning';
      }
    }

    return range;
  }

  function formatAlarmMessage (notify) {
    var announcementMessage = notify && notify.isAnnouncement && notify.message && notify.message.length > 1;

    if (announcementMessage) {
      return levels.toDisplay(notify.level) + ': ' + notify.message;
    } else if (notify) {
      return notify.title;
    }
    return null;
  }

  function setAlarmMessage (notify) {
    alarmMessage = formatAlarmMessage(notify);
  }

  function generateAlarm (file, notify) {
    alarmInProgress = true;

    currentNotify = notify;
    setAlarmMessage(notify);
    var selector = '.audio.alarms audio.' + file;

    if (!alarmingNow()) {
      d3.select(selector).each(function() {
        var audio = this;
        playAlarm(audio);
        audio.classList.add('playing');
      });
      client.plugins.visualizeAlarm(client.sbx, notify, alarmMessage);
    }

    updateContainerClass('add', 'alarming', false);
    updateContainerClass('add', file === urgentAlarmSound ? 'urgent' : 'warning', false);

    if (silenceBtnEl) {
      silenceBtnEl.innerHTML = '';
    }

    _.each(client.settings.snoozeMinsForAlarmEvent(notify), function eachOption (mins) {
      if (!silenceBtnEl) return;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.setAttribute('data-snooze-time', String(times.mins(mins).msecs));
      a.textContent = client.translate('Silence for %1 minutes', { params: [mins] });
      a.addEventListener('click', snoozeAlarm);
      li.appendChild(a);
      silenceBtnEl.appendChild(li);
    });

    updateTitle();
  }

  function snoozeAlarm (event) {
    if (!event) return;
    var target = event.target;
    var anchor = target && target.closest ? target.closest('a') : target;
    var silenceTime = anchor && anchor.getAttribute ? Number(anchor.getAttribute('data-snooze-time')) : null;
    stopAlarm(true, silenceTime);
    event.preventDefault();
  }

  function playAlarm (audio) {
    // ?mute=true disables alarms to testers.
    if (client.browserUtils.queryParms().mute !== 'true') {
      audio.play();
    } else {
      client.browserUtils.showNotification('Alarm was muted (?mute=true)');
    }
  }

  function stopAlarm (isClient, silenceTime, notify) {
    alarmInProgress = false;
    alarmMessage = null;
    updateContainerClass('remove', 'urgent warning', false);
    d3.selectAll('audio.playing').each(function() {
      var audio = this;
      audio.pause();
      audio.classList.remove('playing');
    });

    client.browserUtils.closeNotification();
    updateContainerClass('remove', 'alarming', false);

    updateTitle();

    silenceTime = silenceTime || times.mins(5).msecs;

    var alarm = null;

    if (notify) {
      if (notify.level) {
        alarm = getClientAlarm(notify.level, notify.group);
      } else if (notify.group) {
        alarm = getClientAlarm(currentNotify.level, notify.group);
      } else {
        alarm = getClientAlarm(currentNotify.level, currentNotify.group);
      }
    } else if (currentNotify) {
      alarm = getClientAlarm(currentNotify.level, currentNotify.group);
    }

    if (alarm) {
      alarm.lastAckTime = Date.now();
      alarm.silenceTime = silenceTime;
      if (alarm.group === 'Time Ago') {
        updateContainerClass('remove', 'alarming-timeago', false);
      }
    } else {
    }

    // only emit ack if client invoke by button press
    if (isClient && currentNotify) {
      alarmSocket.emit('ack', currentNotify.level, currentNotify.group, silenceTime);
    }

    currentNotify = null;

    brushed();
  }

  function refreshAuthIfNeeded () {
    var clientToken = client.authorized ? client.authorized.token : null;
    var token = client.browserUtils.queryParms().token || clientToken;
    if (token && client.authorized) {
      var renewTime = (client.authorized.exp * 1000) - times.mins(15).msecs - Math.abs((client.authorized.iat * 1000) - client.authorized.lat);
      var refreshIn = Math.round((renewTime - client.now) / 1000);
      if (client.now > renewTime) {
        fetch('/api/v2/authorization/request/' + token)
          .then(response => response.json())
          .then(authorized => {
            if (authorized) {
              authorized.lat = client.now;
              client.authorized = authorized;
            }
          })
          .catch(err => {
            // Log error but don't break functionality
          });
      } else if (refreshIn < times.mins(5).secs) {
      }
    }
  }

  function updateClock () {
    updateClockDisplay();
    // Update at least every 15 seconds
    var interval = Math.min(15 * 1000, (60 - (new Date()).getSeconds()) * 1000 + 5);
    setTimeout(updateClock, interval);

    updateTimeAgo();
    if (chart) {
      brushed();
    }

    // Dim the screen by reducing the opacity when at nighttime
    if (client.settings.nightMode) {
      var dateTime = new Date();
      if (opacity.current !== opacity.NIGHT && (dateTime.getHours() > 21 || dateTime.getHours() < 7)) {
        if (bodyEl) bodyEl.style.opacity = String(opacity.NIGHT);
      } else {
        if (bodyEl) bodyEl.style.opacity = String(opacity.DAY);
      }
    }
    refreshAuthIfNeeded();
    if (client.resetRetroIfNeeded) {
      client.resetRetroIfNeeded();
    }
  }

  function updateClockDisplay () {
    if (inRetroMode()) {
      return;
    }
    client.now = Date.now();
    DOMManager.display.setCurrentTime(formatTime(new Date(client.now), true), false);
  }

  function getClientAlarm (level, group) {
    var key = level + '-' + group;
    var alarm = null;
    // validate the key before getting the alarm
    if (Object.prototype.hasOwnProperty.call(clientAlarms, key)) {
      /* eslint-disable-next-line security/detect-object-injection */ // verified false positive
      alarm = clientAlarms[key];
    }
    if (!alarm) {
      alarm = { level: level, group: group };
      /* eslint-disable-next-line security/detect-object-injection */ // verified false positive
      clientAlarms[key] = alarm;
    }
    return alarm;
  }

  function isTimeAgoAlarmType () {
    return currentNotify && currentNotify.group === 'Time Ago';
  }

  function isStale (status) {
    return client.settings.alarmTimeagoWarn && status === 'warn' ||
      client.settings.alarmTimeagoUrgent && status === 'urgent';
  }

  function notAcked (alarm) {
    return Date.now() >= (alarm.lastAckTime || 0) + (alarm.silenceTime || 0);
  }

  function checkTimeAgoAlarm (status) {
    var level = status === 'urgent' ? levels.URGENT : levels.WARN;
    var alarm = getClientAlarm(level, 'Time Ago');

    if (isStale(status) && notAcked(alarm)) {
      updateContainerClass('add', 'alarming-timeago', false);
      var display = client.timeago.calcDisplay(client.sbx.lastSGVEntry(), client.sbx.time);
      var translate = client.translate;
      var notify = {
        title: translate('Last data received') + ' ' + display.value + ' ' + translate(display.label)
        , level: status === 'urgent' ? 2 : 1
        , group: 'Time Ago'
      };
      var sound = status === 'warn' ? alarmSound : urgentAlarmSound;
      generateAlarm(sound, notify);
    }

    if (container) container.classList.toggle('alarming-timeago', status !== 'current');

    if (status === 'warn') {
      if (container) container.classList.add('warn');
    } else if (status === 'urgent') {
      if (container) container.classList.add('urgent');
    }

    if (alarmingNow() && status === 'current' && isTimeAgoAlarmType()) {
      stopAlarm(true, times.min().msecs);
    }
  }

  function updateTimeAgo () {
    var status = client.timeago.checkStatus(client.sbx);
    if (status !== 'current') {
      updateTitle();
    }
    checkTimeAgoAlarm(status);
  }

  function updateTimeAgoSoon () {
    setTimeout(function updatingTimeAgoNow () {
      updateTimeAgo();
    }, times.secs(10).msecs);
  }

  function refreshChart (updateToNow) {
    if (updateToNow) {
      updateBrushToNow();
    }
    chart.update(false);
  }

  (function watchVisibility () {
    // Set the name of the hidden property and the change event for visibility
    var hidden, visibilityChange;
    if (typeof document.hidden !== 'undefined') {
      hidden = 'hidden';
      visibilityChange = 'visibilitychange';
    } else if (typeof document.mozHidden !== 'undefined') {
      hidden = 'mozHidden';
      visibilityChange = 'mozvisibilitychange';
    } else if (typeof document.msHidden !== 'undefined') {
      hidden = 'msHidden';
      visibilityChange = 'msvisibilitychange';
    } else if (typeof document.webkitHidden !== 'undefined') {
      hidden = 'webkitHidden';
      visibilityChange = 'webkitvisibilitychange';
    }

    document.addEventListener(visibilityChange, function visibilityChanged () {
      var prevHidden = client.documentHidden;
      /* eslint-disable-next-line security/detect-object-injection */ // verified false positive
      client.documentHidden = document[hidden];

      if (prevHidden && !client.documentHidden) {
        refreshChart(true);
      }
    });
  })();

  const debouncedRefreshChart = PerfUtils.debounce(refreshChart, 200);
  window.addEventListener('resize', debouncedRefreshChart);

  updateClock();
  updateTimeAgoSoon();

  function Dropdown (el) {
    this.ddmenuitem = null;
    this.el = typeof el === 'string' ? document.querySelector(el) : el;
    var that = this;

    document.addEventListener('click', function() { that.close(); });
  }
  Dropdown.prototype.close = function() {
    if (this.ddmenuitem) {
      this.ddmenuitem.style.visibility = 'hidden';
      this.ddmenuitem = null;
    }
  };
  Dropdown.prototype.open = function(e) {
    this.close();
    if (this.el) {
      this.ddmenuitem = this.el;
      this.ddmenuitem.style.visibility = 'visible';
    }
    if (e) e.stopPropagation();
  };

  var silenceDropdown = new Dropdown('#silenceBtn');
  var viewDropdown = new Dropdown('#viewMenu');

  var bgButtons = document.querySelectorAll('.bgButton');
  bgButtons.forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      if (alarmingNow()) {
        /* eslint-disable-next-line security/detect-non-literal-fs-filename */ // verified false positive
        silenceDropdown.open(e);
      }
    });
  });

  if (focusRangeEl) {
    focusRangeEl.addEventListener('click', function(e) {
      var target = e.target;
      var li = target && target.closest ? target.closest('li') : null;
      if (!li || !focusRangeEl.contains(li)) return;
      var hoursAttr = li.getAttribute('data-hours');
      if (hoursAttr) {
        var hours = Number(hoursAttr);
        setFocusRangeSelected(hours);
        client.focusRangeMS = times.hours(hours).msecs;
        Storages.localStorage.set('focusHours', hours);
        refreshChart();
      } else {
        /* eslint-disable-next-line security/detect-non-literal-fs-filename */ // verified false positive
        viewDropdown.open(e);
      }
    });
  }

  // Helper function to change timespan
  var availableHours = [2, 3, 4, 6, 12, 24];
  function changeTimespan(direction) {
    var currentHours = Math.round(client.focusRangeMS / times.hours(1).msecs);
    var currentIndex = availableHours.indexOf(currentHours);
    if (currentIndex === -1) {
      // If current value is not in the list, find the closest one
      currentIndex = 0;
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
      setFocusRangeSelected(hours);
      client.focusRangeMS = times.hours(hours).msecs;
      Storages.localStorage.set('focusHours', hours);
      refreshChart();
    }
  }

  // Mouse wheel support on chart container
  var wheelTimeout;
  if (chartContainerEl) {
    const debouncedWheelChange = PerfUtils.debounce((direction) => {
      changeTimespan(direction);
    }, 150);

    chartContainerEl.addEventListener('wheel', function(e) {
      e.preventDefault();
      var direction = e.deltaY > 0 ? 1 : -1;
      debouncedWheelChange(direction);
    }, { passive: false });
  }

  // Pinch-to-zoom support for touch devices
  var touchStartDistance = null;
  if (chartContainerEl) {
    const debouncedPinchChange = PerfUtils.debounce((direction) => {
      changeTimespan(direction);
    }, 150);

    chartContainerEl.addEventListener('touchstart', function(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var touch1 = e.touches[0];
        var touch2 = e.touches[1];
        var dx = touch2.clientX - touch1.clientX;
        var dy = touch2.clientY - touch1.clientY;
        touchStartDistance = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: false });

    chartContainerEl.addEventListener('touchmove', function(e) {
      if (e.touches.length === 2 && touchStartDistance !== null) {
        e.preventDefault();
        var touch1 = e.touches[0];
        var touch2 = e.touches[1];
        var dx = touch2.clientX - touch1.clientX;
        var dy = touch2.clientY - touch1.clientY;
        var currentDistance = Math.sqrt(dx * dx + dy * dy);

        var delta = currentDistance - touchStartDistance;

        // Pinch out (zoom in) = shorter timespan, pinch in (zoom out) = longer timespan
        if (Math.abs(delta) > 50) { // Threshold to prevent accidental triggers
          var direction = delta < 0 ? 1 : -1;
          debouncedPinchChange(direction);
          touchStartDistance = currentDistance; // Update for continuous pinching
        }
      }
    }, { passive: false });

    chartContainerEl.addEventListener('touchend', function() {
      touchStartDistance = null;
    });
    chartContainerEl.addEventListener('touchcancel', function() {
      touchStartDistance = null;
    });
  }

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Client-side code to connect to server and handle incoming data
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /* global io */
  client.socket = socket = io.connect({ transports: ["polling"] });
  client.alarmSocket = alarmSocket = io.connect("/alarm", { multiplex: true, transports: ["polling"] });

  socket.on('dataUpdate', dataUpdate);

  function resetRetro () {
    client.retro = {
      loadedMills: 0
      , loadStartedMills: 0
      , lastRequestedFrom: 0
      , lastRequestedTo: 0
    };
  }

  client.resetRetroIfNeeded = function resetRetroIfNeeded () {
    if (client.retro.loadedMills > 0 && Date.now() - client.retro.loadedMills > times.mins(5).msecs) {
      resetRetro();
      console.info('Cleared retro data to free memory');
    }
  };

  resetRetro();

  client.loadRetroIfNeeded = function loadRetroIfNeeded () {
    var now = Date.now();
    var timeSinceStarted = now - client.retro.loadStartedMills;
    var timeSinceLoaded = now - client.retro.loadedMills;
    
    // Determine the time range we need
    var range = client.chart && client.chart.createBrushedRange ? client.chart.createBrushedRange() : client.dataExtent();
    var from = range[0] && range[0].getTime ? range[0].getTime() : (Date.now() - client.focusRangeMS);
    var to = range[1] && range[1].getTime ? range[1].getTime() : Date.now();
    
    // Check if the requested range has changed significantly (more than 10 minutes difference)
    var rangeChanged = Math.abs(from - (client.retro.lastRequestedFrom || 0)) > times.mins(10).msecs ||
                       Math.abs(to - (client.retro.lastRequestedTo || 0)) > times.mins(10).msecs;
    
    if (timeSinceStarted < times.secs(30).msecs) {
      return;
    }

    // Load if retro is stale OR if the time range has changed (retro-browsing to different period)
    if (timeSinceLoaded > times.mins(3).msecs || rangeChanged) {
      client.retro.loadStartedMills = now;
      client.retro.lastRequestedFrom = from;
      client.retro.lastRequestedTo = to;
      
      // Request device-status only for the current brushed/focus range so
      // the IOB plugin can use historical device-status values without
      // loading full retro data.
      try {
        socket.emit('loadRetro', {
          devicestatus: true,
          from: from,
          to: to
        });
      } catch (e) {
        // fallback to legacy request
        socket.emit('loadRetro', {
          loadedMills: client.retro.loadedMills
        });
      }
    }
  };

  socket.on('retroUpdate', function retroUpdate (retroData) {
    client.retro = {
      loadedMills: Date.now()
      , loadStartedMills: 0
      , data: retroData
      , lastRequestedFrom: client.retro.lastRequestedFrom
      , lastRequestedTo: client.retro.lastRequestedTo
    };
    // Populate/refresh last48 store from retro device-status responses
    if (retroData && retroData.devicestatus) {
      client.updateLast48FromDeviceStatus(retroData.devicestatus);
    }
    // Clear in-flight flag even if retro response was empty
    if (client._last48RequestInFlight) {
      client._last48RequestInFlight = false;
    }
    // Redraw chart so renderer can use newly arrived retro device-status (for IOB/COB)
    try {
      if (chart && retroData && retroData.devicestatus && retroData.devicestatus.length) {
        chart.update(false);
      }
    } catch (e) {
      console.error('retroUpdate redraw failed', e);
    }
  });

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Alarms and Text handling
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  client.authorizeSocket = function authorizeSocket () {

    console.log('Authorizing socket');
    var auth_data = {
      client: 'web'
      , secret: client.authorized && client.authorized.token ? null : client.hashauth.hash()
      , token: client.authorized && client.authorized.token
      , history: history
    };

    socket.emit(
      'authorize'
      , auth_data
      , function authCallback (data) {
        if (!data) {
          console.log('Crashed!');
          client.crashed();
        }

        if (!data.read || !hasRequiredPermission()) {
          client.hashauth.requestAuthentication(function afterRequest () {
            client.hashauth.updateSocketAuth();
            if (callback) {
              callback();
            }
          });
        } else if (callback) {
          callback();
        }
        // After successful authorization, request last-24h device-status if not yet fetched
        try {
          if (!client.last48 || !client.last48.fetchedAt) {
            setTimeout(function() {
              try { client.requestLast48DeviceStatus(); } catch (e) { /* ignore */ }
            }, 200);
          }
        } catch (e) {
          console.error('requestLast48DeviceStatus failed', e);
        }
      }
    );
  }

  socket.on('connect', function() {
    console.log('Client connected to server.');
    client.authorizeSocket();
  });

  client.subscribeForAlarms = function subscribeForAlarms () {

    var auth_data = {
      secret: client.authorized && client.authorized.token ? null : client.hashauth.hash()
      , jwtToken: client.authorized && client.authorized.token
    };

    alarmSocket.emit(
      'subscribe'
      , auth_data
      , function subscribeCallback (data) {
        if (!data) {
          console.log('Crashed!');
          client.crashed();
        }

        console.log('Subscribed for alarms', data);
        var shouldAuthenticationPromptOnLoad = client.settings.authenticationPromptOnLoad ;
        if (!data.success) {
          if (!data.read || !hasRequiredPermission() || shouldAuthenticationPromptOnLoad) {
            return client.hashauth.requestAuthentication(function afterRequest () {
              return client.hashauth.updateSocketAuth();
            });
          }
        }
      }
    );
  }

  alarmSocket.on('connect', function() {
    client.subscribeForAlarms();
  });

  function hasRequiredPermission () {
    if (client.requiredPermission) {
      if (client.hashauth && client.hashauth.isAuthenticated()) {
        return true;
      } else {
        return client.authorized && client.authorized.check(client.requiredPermission);
      }
    } else {
      return true;
    }
  }

  //with predicted alarms, latestSGV may still be in target so to see if the alarm
  //  is for a HIGH we can only check if it's >= the bottom of the target
  function isAlarmForHigh () {
    return client.latestSGV && client.latestSGV.mgdl >= client.settings.thresholds.bgTargetBottom;
  }

  //with predicted alarms, latestSGV may still be in target so to see if the alarm
  //  is for a LOW we can only check if it's <= the top of the target
  function isAlarmForLow () {
    return client.latestSGV && client.latestSGV.mgdl <= client.settings.thresholds.bgTargetTop;
  }

  alarmSocket.on('notification', function(notify) {
    console.log('notification from server:', notify);
    if (notify.timestamp && previousNotifyTimestamp !== notify.timestamp) {
      previousNotifyTimestamp = notify.timestamp;
      client.plugins.visualizeAlarm(client.sbx, notify, notify.title + ' ' + notify.message);
    } else {
      console.log('No timestamp found for notify, not passing to plugins');
    }
  });

  alarmSocket.on('announcement', function(notify) {
    console.info('announcement received from server');
    currentAnnouncement = notify;
    currentAnnouncement.received = Date.now();
    updateTitle();
  });

  alarmSocket.on('alarm', function(notify) {
    console.info('alarm received from server');
    var enabled = (isAlarmForHigh() && client.settings.alarmHigh) || (isAlarmForLow() && client.settings.alarmLow);
    if (enabled) {
      console.log('Alarm raised!');
      generateAlarm(alarmSound, notify);
    } else {
      console.info('alarm was disabled locally', client.latestSGV.mgdl, client.settings);
    }
    chart.update(false);
  });

  alarmSocket.on('urgent_alarm', function(notify) {
    console.info('urgent alarm received from server');
    var enabled = (isAlarmForHigh() && client.settings.alarmUrgentHigh) || (isAlarmForLow() && client.settings.alarmUrgentLow);
    if (enabled) {
      console.log('Urgent alarm raised!');
      generateAlarm(urgentAlarmSound, notify);
    } else {
      console.info('urgent alarm was disabled locally', client.latestSGV.mgdl, client.settings);
    }
    chart.update(false);
  });

  alarmSocket.on('clear_alarm', function(notify) {
    if (alarmInProgress) {
      console.log('clearing alarm');
      stopAlarm(false, null, notify);
    }
  });
  /*
  *
  // TODO: When an unauthorized client attempts to silence an alarm, we should
  // allow silencing locally, request for authorization, and if the
  // authorization succeeds even republish the ACK notification. something like...
  alarmSocket.on('authorization_needed', function(details) {
    if (alarmInProgress) {
      console.log('clearing alarm');
      stopAlarm(true, details.silenceTime, currentNotify);
    }
    client.hashauth.requestAuthentication(function afterRequest () {
      console.log("SUCCESSFULLY AUTHORIZED, REPUBLISHED ACK?");
      // easiest way to update permission set on server side is to send another message.
      alarmSocket.emit('resubscribe', currentNotify, details);

      if (isClient && currentNotify) {
        alarmSocket.emit('ack', currentNotify.level, currentNotify.group, details.silenceTime);
      }
    });
  });

  */

  if (agpButtonEl) {
    agpButtonEl.addEventListener('click', function(event) {
      event.preventDefault();
      window.open('/report', '_blank');
    });
  }

  if (testAlarmsEl) {
    testAlarmsEl.addEventListener('click', function(event) {

      // Speech synthesis also requires on iOS that user triggers a speech event for it to speak anything
      if (client.plugins('speech').isEnabled) {
        var msg = new SpeechSynthesisUtterance('Ok ok.');
        msg.lang = 'en-US';
        window.speechSynthesis.speak(msg);
      }

      d3.selectAll('.audio.alarms audio').each(function() {
        var audio = this;
        playAlarm(audio);
        setTimeout(function() {
          audio.pause();
        }, 4000);
      });
      event.preventDefault();
    });
  }

  if (serverSettings) {
    DOMManager.info.setText(appNameEl, serverSettings.name);
    DOMManager.info.setText(versionEl, serverSettings.version);
    DOMManager.info.setText(headEl, serverSettings.head);
    if (serverSettings.apiEnabled) {
      DOMManager.info.setInfoVisible(serverSettingsEl, true);
    }
  }

  client.updateAdminMenu = function updateAdminMenu() {
    // hide food control if not enabled
    DOMManager.info.setInfoVisible(foodControlEl, client.settings.enable.indexOf('food') > -1);
    // hide cob control if not enabled
    DOMManager.info.setInfoVisible(cobControlEl, client.settings.enable.indexOf('cob') > -1);
}

  client.updateAdminMenu();

  updateContainerClass('toggle', 'has-minor-pills', client.plugins.hasShownType('pill-minor', client.settings));

  function prepareEntries () {
    // Post processing after data is in
    var temp1 = [];
    var sbx = client.sbx.withExtendedSettings(client.rawbg);

    if (client.ddata.cal && client.rawbg.isEnabled(sbx)) {
      temp1 = client.ddata.sgvs.map(function(entry) {
        var rawbgValue = client.rawbg.showRawBGs(entry.mgdl, entry.noise, client.ddata.cal, sbx) ? client.rawbg.calc(entry, client.ddata.cal, sbx) : 0;
        if (rawbgValue > 0) {
          return { mills: entry.mills - 2000, mgdl: rawbgValue, color: 'white', type: 'rawbg' };
        } else {
          return null;
        }
      }).filter(function(entry) {
        return entry !== null;
      });
    }
    var temp2 = client.ddata.sgvs.map(function(obj) {
      return { mills: obj.mills, mgdl: obj.mgdl, direction: obj.direction, color: sgvToColor(obj.mgdl), type: 'sgv', noise: obj.noise, filtered: obj.filtered, unfiltered: obj.unfiltered };
    });
    client.entries = [];
    client.entries = client.entries.concat(temp1, temp2);

    client.entries = client.entries.concat(client.ddata.mbgs.map(function(obj) {
      return { mills: obj.mills, mgdl: obj.mgdl, color: 'red', type: 'mbg', device: obj.device };
    }));

    var tooOld = client.now - times.hours(48).msecs;
    client.entries = client.entries.filter(function notTooOld (entry) {
      return entry.mills > tooOld;
    });

    client.entries.forEach(function(point) {
      if (point.mgdl < 39) {
        point.color = 'transparent';
      }
    });

    client.entries.sort(function sorter (a, b) {
      return a.mills - b.mills;
    });
  }

  function dataUpdate (received, headless) {
    console.info('got dataUpdate', new Date(client.now));

    var lastUpdated = Date.now();
    client.dataLastUpdated = lastUpdated;

    receiveDData(received, client.ddata, client.settings);

    // Resend new treatments to profile
    client.profilefunctions.updateTreatments(client.ddata.profileTreatments, client.ddata.tempbasalTreatments, client.ddata.combobolusTreatments);

    if (received.profiles) {
      profile.loadData(received.profiles);
    }

    if (client.ddata.sgvs) {
      // TODO change the next line so that it uses the prediction if the signal gets lost (max 1/2 hr)
      client.ctx.data.lastUpdated = lastUpdated;
      client.latestSGV = client.ddata.sgvs[client.ddata.sgvs.length - 1];
    }

    client.ddata.inRetroMode = false;
    client.ddata.profile = profile;

    client.nowSBX = sandbox.clientInit(
      client.ctx
      , lastUpdated
      , client.ddata
    );

    //all enabled plugins get a chance to set properties, even if they aren't shown
    client.plugins.setProperties(client.nowSBX);

    // Update last48 store from the current client devicestatus (keeps it up-to-date)
    try {
      if (client.ddata && client.ddata.devicestatus) {
        client.updateLast48FromDeviceStatus(client.ddata.devicestatus);
      }
    } catch (e) {
      console.error('Error updating last48 from devicestatus in dataUpdate', e);
    }

    prepareEntries();
    updateTitle();

    // Don't invoke D3 in headless mode

    if (headless) return;

    if (!isInitialData) {
      isInitialData = true;
      chart = client.chart = require('./chart')(client, d3, $);
      chart.update(true);
      brushed();
      chart.update(false);
    } else if (!inRetroMode()) {
      brushed();
      chart.update(false);
    } else {
      chart.updateContext();
    }
  }
};

module.exports = client;
