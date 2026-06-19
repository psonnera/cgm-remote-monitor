
var init = function init () {
  'use strict';

  //for the tests window isn't the global object
  var $ = window.$;
  var _ = window._;
  var Nightscout = window.Nightscout;
  var client = Nightscout.client;
  var report_plugins_preinit = Nightscout.report_plugins_preinit;
  var report_plugins;

  client.init(function loaded () {
    var moment = client.ctx.moment;

    report_plugins = report_plugins_preinit(client.ctx);
    Nightscout.report_plugins = report_plugins;

    // init HTML code
    report_plugins.addHtmlFromPlugins(client);
    // make show() accessible outside for treatments.js
    report_plugins.show = show;

    var translate = client.translate;

    var maxInsulinValue = 0
      , maxCarbsValue = 0
      , maxDailyCarbsValue = 0;
    var maxdays = 6 * 31;
    var datastorage = {};
    var daystoshow = {};
    var sorteddaystoshow = [];

    var targetBGdefault = {
      'mg/dl': {
        low: client.settings.thresholds.bgTargetBottom
        , high: client.settings.thresholds.bgTargetTop
      }
      , 'mmol': {
        low: client.utils.scaleMgdl(client.settings.thresholds.bgTargetBottom)
        , high: client.utils.scaleMgdl(client.settings.thresholds.bgTargetTop)
      }
    };
    
    // Normalize units to handle variations (mmol, mmol/L, mmol/l, etc.)
    function normalizeUnits(units) {
      var normalized = units.toLowerCase();
      return normalized.includes('mmol') ? 'mmol' : 'mg/dl';
    }

    var ONE_MIN_IN_MS = 60000;
    var activeRangePreset = null;

    // Progress popup helper functions
    function showProgressPopup(message, percent) {
      percent = Math.round(percent || 0);
      $('#progress-popup-overlay').remove();
      var popupHtml = '<div id="progress-popup-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">' +
        '<div id="progress-popup" style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); min-width: 400px; max-width: 500px;">' +
        '<div id="progress-message" style="font-size: 16px; font-weight: bold; margin-bottom: 15px; text-align: center;">' + message + '</div>' +
        '<div id="progress-container" style="width: 100%; background-color: #f0f0f0; border: 1px solid #ccc; border-radius: 5px; height: 30px; position: relative; overflow: hidden;">' +
        '<div id="progress-bar" style="width: ' + percent + '%; height: 100%; background-color: #6c6; border-radius: 5px; transition: width 0.3s ease;"></div>' +
        '<span id="progress-text" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #333; font-weight: bold; z-index: 1;">' + percent + '%</span>' +
        '</div>' +
        '</div>' +
        '</div>';
      $('body').append(popupHtml);
    }

    function updateProgressPopup(message, percent) {
      percent = Math.round(percent || 0);
      if ($('#progress-popup-overlay').length === 0) {
        showProgressPopup(message, percent);
      } else {
        if (message) {
          $('#progress-message').text(message);
        }
        $('#progress-bar').css('width', percent + '%');
        $('#progress-text').text(percent + '%');
      }
    }

    function hideProgressPopup(delay, immediate) {
      setTimeout(function() {
        if (immediate) {
          $('#progress-popup-overlay').remove();
        } else {
          $('#progress-popup-overlay').fadeOut(300, function() {
            $(this).remove();
          });
        }
      }, delay || 500);
    }

    prepareGUI();

    // ****** FOOD CODE START ******
    var food_categories = [];
    var food_list = [];

    var filter = {
      category: ''
      , subcategory: ''
      , name: ''
    };

    function fillFoodForm (event) {
      $('#rp_category').empty().append('<option value="">' + translate('(none)') + '</option>');
      Object.keys(food_categories).forEach(function eachCategory (s) {
        $('#rp_category').append('<option value="' + s + '">' + s + '</option>');
      });
      filter.category = '';
      fillFoodSubcategories();

      $('#rp_category').change(fillFoodSubcategories);
      $('#rp_subcategory').change(doFoodFilter);
      $('#rp_name').on('input', doFoodFilter);

      return maybePrevent(event);
    }

    function fillFoodSubcategories (event) {
      filter.category = $('#rp_category').val();
      filter.subcategory = '';
      $('#rp_subcategory').empty().append('<option value="">' + translate('(none)') + '</option>');
      if (filter.category !== '') {
        Object.keys(food_categories[filter.category] || {}).forEach(function eachSubCategory (s) {
          $('#rp_subcategory').append('<option value="' + s + '">' + s + '</option>');
        });
      }
      doFoodFilter();
      return maybePrevent(event);
    }

    function doFoodFilter (event) {
      if (event) {
        filter.category = $('#rp_category').val();
        filter.subcategory = $('#rp_subcategory').val();
        filter.name = $('#rp_name').val();
      }
      $('#rp_food').empty();
      for (var i = 0; i < food_list.length; i++) {
        if (filter.category !== '' && food_list[i].category !== filter.category) { continue; }
        if (filter.subcategory !== '' && food_list[i].subcategory !== filter.subcategory) { continue; }
        if (filter.name !== '' && food_list[i].name.toLowerCase().indexOf(filter.name.toLowerCase()) < 0) { continue; }
        var o = '';
        o += food_list[i].name + ' | ';
        o += translate('Portion') + ': ' + food_list[i].portion + ' ';
        o += food_list[i].unit + ' | ';
        o += translate('Carbs') + ': ' + food_list[i].carbs + ' g';
        $('#rp_food').append('<option value="' + food_list[i]._id + '">' + o + '</option>');
      }

      return maybePrevent(event);
    }

    $('#info').html('<b>' + translate('Loading food database') + ' ...</b>');
    $.ajax('/api/v1/food/regular.json', {
      headers: client.headers()
      , success: function foodLoadSuccess (records) {
        records.forEach(function(r) {
          food_list.push(r);
          if (r.category && !food_categories[r.category]) { food_categories[r.category] = {}; }
          if (r.category && r.subcategory) { food_categories[r.category][r.subcategory] = true; }
        });
        fillFoodForm();
      }
    }).done(function() {
      $('#info').html('');
      if (food_list.length) {
        enableFoodGUI();
      } else {
        disableFoodGUI();
      }
    }).fail(function() {
      $('#info').html('');
      disableFoodGUI();
    });

    function enableFoodGUI () {
      $('#info').html('');

      $('.rp_foodgui').css('display', '');
      $('#rp_food').change(function(event) {
        $('#rp_enablefood').prop('checked', true);
        return maybePrevent(event);
      });
    }

    function disableFoodGUI () {
      $('#info').html('');
      $('.rp_foodgui').css('display', 'none');
    }

    // ****** FOOD CODE END ******

    function prepareGUI () {
      $('.presetdates').click(function(event) {
        var days = $(this).attr('days');
        $('#rp_enabledate').prop('checked', true);
        $('.presetdates').removeClass('selected');
        $(this).addClass('selected');
        setDataRange(event, days);
        
        // Auto-trigger show() when preset date button is clicked
        window.setTimeout(function() {
          show();
        }, 100);
        return maybePrevent(event);
      });
      $('#rp_show').click(show);
      $('#rp_prev').click(navigatePrev);
      $('#rp_next').click(navigateNext);
      
      // Check on date field changes
      $('#rp_from, #rp_to').on('change', function() {
        activeRangePreset = null;
        updateNextButtonVisibility();
      });
      $('#rp_notes').bind('input', function(event) {
        $('#rp_enablenotes').prop('checked', true);
        return maybePrevent(event);
      });
      $('#rp_eventtype').bind('input', function(event) {
        $('#rp_enableeventtype').prop('checked', true);
        return maybePrevent(event);
      });

      // fill careportal events
      $('#rp_eventtype').empty();
      _.each(client.careportal.events, function eachEvent (event) {
        $('#rp_eventtype').append('<option value="' + event.val + '">' + translate(event.name) + '</option>');
      });
      $('#rp_eventtype').append('<option value="sensor">' + '>>> ' + translate('All sensor events') + '</option>');

      $('#rp_targetlow').val(targetBGdefault[normalizeUnits(client.settings.units)].low);
      $('#rp_targethigh').val(targetBGdefault[normalizeUnits(client.settings.units)].high);

      if (client.settings.scaleY === 'linear') {
        $('#rp_linear').prop('checked', true);
        $('#wrp_linear').prop('checked', true);
      } else {
        $('#rp_log').prop('checked', true);
        $('#wrp_log').prop('checked', true);
      }

      $('.menutab').click(switchreport_handler);

      // The default selected tab is glucosedistribution (AGP), so set previous calendar month
      setDataRange(null, 31);
      $('#rp_enabledate').prop('checked', true);
      updateActiveReportTitle();
      // No preset button selected for previous calendar month
      
      // Check NEXT button visibility
      updateNextButtonVisibility();
      
      // Automatically load data on initial page load
      window.setTimeout(function() {
        show();
      }, 100);
    }

    function updateActiveReportTitle () {
      var currentTitle = $('.tabplaceholder:visible').find('h2:first').first().text().trim();
      $('#rp_active_report_title').text(currentTitle || '');
    }

    function sgvToColor (sgv, options) {
      var color = 'darkgreen';

      if (sgv > options.targetHigh) {
        color = 'red';
      } else if (sgv < options.targetLow) {
        color = 'red';
      }

      return color;
    }
    
    // Function to check if NEXT button should be hidden
    function updateNextButtonVisibility() {
      var to = moment($('#rp_to').val());
      var today = moment().startOf('day');
      if (to.isSameOrAfter(today)) {
        $('#rp_next').hide();
      } else {
        $('#rp_next').show();
      }
    }

    function show (event) {
      // Clear all report content divs
      $('#pluginchartplaceholders > div').each(function() {
        $(this).find('[id$="-report"], [id$="-grid"], [id$="charts"]').empty();
      });
      
      var options = {
        width: 1000
        , height: 300
        , weekwidth: 1000
        , weekheight: 300
        , targetLow: 3.5
        , targetHigh: 10
        , raw: true
        , notes: true
        , food: true
        , insulin: true
        , carbs: true
        , iob: true
        , cob: true
        , basal: true
        , scale: report_plugins.consts.scaleYFromSettings(client)
        , weekscale: report_plugins.consts.scaleYFromSettings(client)
        , units: client.settings.units
      };

      // default time range if no time range specified in GUI
      var zone = client.sbx.data.profile.getTimezone();
      var timerange = '&find[created_at][$gte]=' + moment.tz('2000-01-01', zone).toISOString();
      //console.log(timerange,zone);
      
      // Ensure target fields have valid values for current units
      // If empty or if values seem to be in wrong units, reset to defaults
      var currentUnitsAreMmol = normalizeUnits(client.settings.units) === 'mmol';
      var targetLowVal = parseFloat($('#rp_targetlow').val().replace(',', '.'));
      var targetHighVal = parseFloat($('#rp_targethigh').val().replace(',', '.'));
      
      // Check if values need to be reset (empty, NaN, or likely in wrong units)
      var needsReset = false;
      if (isNaN(targetLowVal) || isNaN(targetHighVal)) {
        needsReset = true;
      } else if (currentUnitsAreMmol && (targetLowVal > 25 || targetHighVal > 25)) {
        // Values > 25 in mmol mode are likely mg/dl values
        needsReset = true;
      } else if (!currentUnitsAreMmol && (targetLowVal < 25 && targetHighVal < 25)) {
        // Values < 25 in mg/dl mode are likely mmol values
        needsReset = true;
      }
      
      if (needsReset) {
        $('#rp_targetlow').val(targetBGdefault[normalizeUnits(client.settings.units)].low);
        $('#rp_targethigh').val(targetBGdefault[normalizeUnits(client.settings.units)].high);
      }
      
      options.targetLow = parseFloat($('#rp_targetlow').val().replace(',', '.'));
      options.targetHigh = parseFloat($('#rp_targethigh').val().replace(',', '.'));
      options.raw = $('#rp_optionsraw').is(':checked');
      options.iob = $('#rp_optionsiob').is(':checked');
      options.cob = $('#rp_optionscob').is(':checked');
      options.openAps = $('#rp_optionsopenaps').is(':checked');
      options.predicted = $('#rp_optionspredicted').is(':checked');
      options.predictedTruncate = $('#rp_optionsPredictedTruncate').is(':checked');
      options.basal = $('#rp_optionsbasal').is(':checked');
      options.notes = $('#rp_optionsnotes').is(':checked');
      options.food = $('#rp_optionsfood').is(':checked');
      options.insulin = $('#rp_optionsinsulin').is(':checked');
      options.insulindistribution = $('#rp_optionsdistribution').is(':checked');
      options.carbs = $('#rp_optionscarbs').is(':checked');
      options.scale = ($('#rp_linear').is(':checked') ? report_plugins.consts.SCALE_LINEAR : report_plugins.consts.SCALE_LOG);
      options.weekscale = ($('#wrp_linear').is(':checked') ? report_plugins.consts.SCALE_LINEAR : report_plugins.consts.SCALE_LOG);
      options.order = ($('#rp_oldestontop').is(':checked') ? report_plugins.consts.ORDER_OLDESTONTOP : report_plugins.consts.ORDER_NEWESTONTOP);
      options.width = parseInt($('#rp_size :selected').attr('x'));
      options.weekwidth = parseInt($('#wrp_size :selected').attr('x'));
      options.height = parseInt($('#rp_size :selected').attr('y'));
      options.weekheight = parseInt($('#wrp_size :selected').attr('y'));
      options.bgcheck = $('#rp_optionsbgcheck').is(':checked');
      options.othertreatments = $('#rp_optionsothertreatments').is(':checked');
      options.enableeventtype = $('#rp_enableeventtype').is(':checked');
      options.eventtype = $('#rp_eventtype').val();
      
      const reportStorage = require('./reportstorage');
      reportStorage.saveProps(options);
      var matchesneeded = 0;

      // date range
      function datefilter () {
        if ($('#rp_enabledate').is(':checked')) {
          matchesneeded++;
          var from = moment.tz(moment($('#rp_from').val()).startOf('day'), zone).startOf('day');
          var to = moment.tz(moment($('#rp_to').val()).endOf('day'), zone).endOf('day');
          timerange = '&find[created_at][$gte]=' + from.toISOString() + '&find[created_at][$lt]=' + to.toISOString();

          while (from <= to) {
            if (daystoshow[from.format('YYYY-MM-DD')]) {
              daystoshow[from.format('YYYY-MM-DD')]++;
            } else {
              daystoshow[from.format('YYYY-MM-DD')] = 1;
            }
            from.add(1, 'days');
          }
        }
        //console.log('Dayfilter: ',daystoshow);
        foodfilter();
      }

      //food filter
      function foodfilter () {
        if ($('#rp_enablefood').is(':checked')) {
          matchesneeded++;
          var _id = $('#rp_food').val();
          if (_id) {
            var treatmentData;
            var tquery = '?find[boluscalc.foods._id]=' + _id + timerange;
            $.ajax('/api/v1/treatments.json' + tquery, {
              headers: client.headers()
              , success: function(xhr) {
                treatmentData = xhr.map(function(treatment) {
                  return moment.tz(treatment.created_at, zone).format('YYYY-MM-DD');
                });
                // unique it
                treatmentData = $.grep(treatmentData, function(v, k) {
                  return $.inArray(v, treatmentData) === k;
                });
                treatmentData.sort(function(a, b) { return a > b; });
              }
            }).done(function() {
              //console.log('Foodfilter: ',treatmentData);
              for (var d = 0; d < treatmentData.length; d++) {
                if (daystoshow[treatmentData[d]]) {
                  daystoshow[treatmentData[d]]++;
                } else {
                  daystoshow[treatmentData[d]] = 1;
                }
              }
              notesfilter();
            });
          }
        } else {
          notesfilter();
        }
      }

      //notes filter
      function notesfilter () {
        if ($('#rp_enablenotes').is(':checked')) {
          matchesneeded++;
          var notes = $('#rp_notes').val();
          if (notes) {
            var treatmentData;
            var tquery = '?find[notes]=/' + notes + '/i';
            $.ajax('/api/v1/treatments.json' + tquery + timerange, {
              headers: client.headers()
              , success: function(xhr) {
                treatmentData = xhr.map(function(treatment) {
                  return moment.tz(treatment.created_at, zone).format('YYYY-MM-DD');
                });
                // unique it
                treatmentData = $.grep(treatmentData, function(v, k) {
                  return $.inArray(v, treatmentData) === k;
                });
                treatmentData.sort(function(a, b) { return a > b; });
              }
            }).done(function() {
              //console.log('Notesfilter: ',treatmentData);
              for (var d = 0; d < treatmentData.length; d++) {
                if (daystoshow[treatmentData[d]]) {
                  daystoshow[treatmentData[d]]++;
                } else {
                  daystoshow[treatmentData[d]] = 1;
                }
              }
              eventtypefilter();
            });
          }
        } else {
          eventtypefilter();
        }
      }

      //event type filter
      function eventtypefilter () {
        if ($('#rp_enableeventtype').is(':checked')) {
          matchesneeded++;
          var eventtype = $('#rp_eventtype').val();
          if (eventtype) {
            var treatmentData;
            var tquery = '?find[eventType]=/' + eventtype + '/i';
            $.ajax('/api/v1/treatments.json' + tquery + timerange, {
              headers: client.headers()
              , success: function(xhr) {
                treatmentData = xhr.map(function(treatment) {
                  return moment.tz(treatment.created_at, zone).format('YYYY-MM-DD');
                });
                // unique it
                treatmentData = $.grep(treatmentData, function(v, k) {
                  return $.inArray(v, treatmentData) === k;
                });
                treatmentData.sort(function(a, b) { return a > b; });
              }
            }).done(function() {
              //console.log('Eventtypefilter: ',treatmentData);
              for (var d = 0; d < treatmentData.length; d++) {
                if (daystoshow[treatmentData[d]]) {
                  daystoshow[treatmentData[d]]++;
                } else {
                  daystoshow[treatmentData[d]] = 1;
                }
              }
              daysfilter();
            });
          }
        } else {
          daysfilter();
        }
      }

      function daysfilter () {
        matchesneeded++;
        Object.keys(daystoshow).forEach(function eachDay (d) {
          var day = moment.tz(d, zone).day();
          if (day === 0 && $('#rp_su').is(':checked')) { daystoshow[d]++; }
          if (day === 1 && $('#rp_mo').is(':checked')) { daystoshow[d]++; }
          if (day === 2 && $('#rp_tu').is(':checked')) { daystoshow[d]++; }
          if (day === 3 && $('#rp_we').is(':checked')) { daystoshow[d]++; }
          if (day === 4 && $('#rp_th').is(':checked')) { daystoshow[d]++; }
          if (day === 5 && $('#rp_fr').is(':checked')) { daystoshow[d]++; }
          if (day === 6 && $('#rp_sa').is(':checked')) { daystoshow[d]++; }
        });
        countDays();
        addPreviousDayTreatments();
        display();
      }

      function display () {
        sorteddaystoshow = [];
        var realDaysCount = 0;
        for (var rd in daystoshow) {
          if (typeof daystoshow[rd] !== 'object') realDaysCount++;
        }
        options.suppressProgress = (realDaysCount <= 1);
        if (!options.suppressProgress) {
          showProgressPopup(translate('Loading data') + '...', 0);
        }
        // Batch all per-day network fetches into a few ranged queries, then load
        // each day from the prefetched buckets (see prefetchRange / loadData).
        prefetchRange(options, function afterPrefetch () {
          var daysToLoad = [];
          for (var d in daystoshow) {
            if (daysToLoad.length < maxdays) {
              daysToLoad.push(d);
            } else {
              delete daystoshow[d];
            }
          }
          if (daysToLoad.length === 0) {
            hideProgressPopup(0);
            $('#rp_show').css('display', '');
            return;
          }
          // When prefetch populated the buckets, loadData serves each day from cache with
          // no network. When prefetch failed it falls back to per-day AJAX (up to 3
          // requests/day), so cap how many days load concurrently to avoid a request burst.
          var LOAD_CONCURRENCY = 2;
          var loadTasks = daysToLoad.map(function (day) {
            return function () {
              var deferred = $.Deferred();
              loadData(day, options, function (loadedDay) {
                dataLoadedCallback(loadedDay);
                deferred.resolve();
              });
              return deferred;
            };
          });
          runWithConcurrency(loadTasks, LOAD_CONCURRENCY, function () {}, function () {});
        });
      }

      var dayscount = 0;
      var loadeddays = 0;

      function countDays () {
        for (var d in daystoshow) {
          if (Object.prototype.hasOwnProperty.call(daystoshow, d)) {
            if (daystoshow[d] === matchesneeded) {
              if (dayscount < maxdays) {
                dayscount++;
              }
            } else {
              delete daystoshow[d];
            }
          }
        }
        //console.log('Total: ', daystoshow, 'Matches needed: ', matchesneeded, 'Will be loaded: ', dayscount);
      }

      function addPreviousDayTreatments () {
        for (var d in daystoshow) {
          if (Object.prototype.hasOwnProperty.call(daystoshow, d)) {
            var day = moment.tz(d, zone);
            var previous = day.subtract(1, 'days');
            var formated = previous.format('YYYY-MM-DD');
            if (!daystoshow[formated]) {
              daystoshow[formated] = { treatmentsonly: true };
              dayscount++;
            }
          }
        }
        //console.log('Total: ', daystoshow, 'Matches needed: ', matchesneeded, 'Will be loaded: ', dayscount);
      }

      function dataLoadedCallback (day) {
        loadeddays++;
        if (!daystoshow[day].treatmentsonly) {
          sorteddaystoshow.push(day);
        }
        
        if (!options.suppressProgress) {
          // Data loading occupies 0-20%; glucosedistribution gets the larger 55-100% slice
          var progress = Math.round((loadeddays / dayscount) * 20);
          updateProgressPopup(translate('Loading data') + '...', progress);
        }

        if (loadeddays === dayscount) {
          sorteddaystoshow.sort();
          var dFrom = sorteddaystoshow[0];
          var dTo = sorteddaystoshow[(sorteddaystoshow.length - 1)];

          if (options.order === report_plugins.consts.ORDER_NEWESTONTOP) {
            sorteddaystoshow.reverse();
          }

          if (!options.suppressProgress) {
            // Profile loading occupies 20-35%
            updateProgressPopup(translate('Loading profiles') + '...', 20);
          }

          // Track profile loading progress (4 phases: switch, core, previous, next)
          var profilePhases = 0;
          var totalProfilePhases = 4;

          function updateProfileProgress() {
            profilePhases++;
            if (!options.suppressProgress) {
              var progress = 20 + Math.round((profilePhases / totalProfilePhases) * 15);
              updateProgressPopup(translate('Loading profiles') + '...', progress);
            }
          }

          loadProfileSwitch(dFrom, function loadProfileSwitchCallback () {
            updateProfileProgress();
            loadProfilesRange(dFrom, dTo, sorteddaystoshow.length, function loadProfilesCallback () {
              if (!options.suppressProgress) {
                // Data preparation occupies 35-55%
                updateProgressPopup(translate('Preparing data display') + '...', 35);
              }
              window.setTimeout(function() {
                showreports(options);
              }, 0);
            }, updateProfileProgress);
          });
        }
      }

      $('#rp_show').css('display', 'none');
      daystoshow = {};

      datefilter();
      return maybePrevent(event);
    }

    function showreports (options) {
      // Data prep sub-phases span 35-55%; maps 10→37, 25→40, 50→45, 70→49, 85→52, 100→55
      function updateRenderProgress(percent) {
        if (!options.suppressProgress) {
          updateProgressPopup(translate('Preparing data display') + '...', 35 + Math.round(percent * 0.2));
        }
      }
      
      updateRenderProgress(10);
      
      // Split processing into async chunks to allow progress updates to render
      setTimeout(function() {
        // prepare some data used in more reports
        datastorage.allstatsrecords = [];
        datastorage.alldays = 0;
        sorteddaystoshow.forEach(function eachDay (day) {
          if (!daystoshow[day].treatmentsonly) {
            datastorage.allstatsrecords = datastorage.allstatsrecords.concat(datastorage[day].statsrecords);
            datastorage.alldays++;
          }
        });
        
        updateRenderProgress(25);
        
        setTimeout(function() {
          options.maxInsulinValue = maxInsulinValue;
          options.maxCarbsValue = maxCarbsValue;
          options.maxDailyCarbsValue = maxDailyCarbsValue;

          datastorage.treatments = [];
          datastorage.devicestatus = [];
          datastorage.combobolusTreatments = [];
          datastorage.tempbasalTreatments = [];
          Object.keys(daystoshow).forEach(function eachDay (day) {
            datastorage.treatments = datastorage.treatments.concat(datastorage[day].treatments);
            datastorage.devicestatus = datastorage.devicestatus.concat(datastorage[day].devicestatus);
            datastorage.combobolusTreatments = datastorage.combobolusTreatments.concat(datastorage[day].combobolusTreatments);
            datastorage.tempbasalTreatments = datastorage.tempbasalTreatments.concat(datastorage[day].tempbasalTreatments);
          });
          
          updateRenderProgress(50);
          
          setTimeout(function() {
            datastorage.tempbasalTreatments = Nightscout.client.ddata.processDurations(datastorage.tempbasalTreatments);
            
            updateRenderProgress(70);
            
            setTimeout(function() {
              datastorage.treatments.sort(function sort (a, b) { return a.mills - b.mills; });

              updateRenderProgress(85);

              setTimeout(function() {
                for (var d in daystoshow) {
                  if (Object.prototype.hasOwnProperty.call(daystoshow, d)) {
                    if (daystoshow[d].treatmentsonly) {
                      delete daystoshow[d];
                      delete datastorage[d];
                    }
                  }
                }
                
                updateRenderProgress(100);
                
                // Continue with plugin rendering after a brief pause
                setTimeout(continueWithPluginRendering, 50);
              }, 0);
            }, 0);
          }, 0);
        }, 0);
      }, 0);
      
      function continueWithPluginRendering() {

      // Render plugins asynchronously to avoid blocking UI
      var pluginsList = [];
      report_plugins.eachPlugin(function(plugin) {
        pluginsList.push(plugin);
      });
      
      var currentIndex = 0;
      
      function renderNextPlugin() {
        if (currentIndex >= pluginsList.length) {
          // All plugin report() calls have returned, but glucosedistribution defers its
          // real work to setTimeout and removes the popup when it finishes — don't touch it here.
          $('#rp_show').css('display', '');
          return;
        }
        
        var plugin = pluginsList[currentIndex];
        currentIndex++;
        
        // jquery plot doesn't draw to hidden div
        $('#' + plugin.name + '-placeholder').css('display', '');

        var skipRender = false;

        if (plugin.name == 'daytoday' && !$('#daytoday').hasClass('selected')) skipRender = true;
        if (plugin.name == 'treatments' && !$('#treatments').hasClass('selected')) skipRender = true;
        if (plugin.name == 'weektoweek' && !$('#weektoweek').hasClass('selected')) skipRender = true;
        if (!skipRender) {
          try {
            plugin.report(datastorage, sorteddaystoshow, options);
          } catch (error) {
            console.error('Error rendering report plugin ' + plugin.name + ':', error);
            $('#' + plugin.name + '-placeholder').html('<div style="color: red; padding: 20px;">Error loading report. Check console for details.</div>');
          }
        }

        if (!$('#' + plugin.name).hasClass('selected')) {
          $('#' + plugin.name + '-placeholder').css('display', 'none');
        }
        
        // Schedule next plugin rendering
        requestAnimationFrame(renderNextPlugin);
      }
      
      // Start rendering
      renderNextPlugin();
      }
    }

    function setDateRange (start, end, preset) {
      $('#rp_from').val(start.format('YYYY-MM-DD'));
      $('#rp_to').val(end.format('YYYY-MM-DD'));
      activeRangePreset = preset || null;
      updateNextButtonVisibility();
    }

    function setDataRange (event, days) {
      var today = moment();
      var start;
      var end;
      var preset = 'days';

      if (days === 7) {
        preset = 'week';
        start = today.clone().startOf('week').subtract(1, 'week');
        end = start.clone().endOf('week');
      } else if (days === 31) {
        preset = 'month';
        start = today.clone().startOf('month').subtract(1, 'month');
        end = start.clone().endOf('month');
      } else if (days === 90) {
        preset = 'threeMonths';
        end = today.clone().startOf('month').subtract(1, 'day');
        start = end.clone().subtract(2, 'month').startOf('month');
      } else {
        end = today.clone();
        start = today.clone().add(-days + 1, 'days');
      }

      setDateRange(start, end, preset);
      return maybePrevent(event);
    }

    function navigatePrev (event) {
      var from = moment($('#rp_from').val());
      var to = moment($('#rp_to').val());
      var duration = to.diff(from, 'days');
      var start;
      var end;

      if (activeRangePreset === 'week') {
        start = from.clone().startOf('week').subtract(1, 'week');
        end = start.clone().endOf('week');
      } else if (activeRangePreset === 'month') {
        start = from.clone().startOf('month').subtract(1, 'month');
        end = start.clone().endOf('month');
      } else if (activeRangePreset === 'threeMonths') {
        start = from.clone().startOf('month').subtract(3, 'month');
        end = start.clone().add(2, 'month').endOf('month');
      } else {
        // Move the range backward by the duration
        start = from.clone().subtract(duration + 1, 'days');
        end = to.clone().subtract(duration + 1, 'days');
      }

      setDateRange(start, end, activeRangePreset);
      
      // Clear preset date selection since we're using custom navigation
      $('.presetdates').removeClass('selected');
      $('#rp_enabledate').prop('checked', true);
      
      // Update NEXT button visibility
      updateNextButtonVisibility();
      
      // Automatically trigger show
      show(event);
      return maybePrevent(event);
    }

    function navigateNext (event) {
      var from = moment($('#rp_from').val());
      var to = moment($('#rp_to').val());
      var duration = to.diff(from, 'days');
      var today = moment().startOf('day');
      var start;
      var end;

      if (activeRangePreset === 'week') {
        start = from.clone().startOf('week').add(1, 'week');
        end = start.clone().endOf('week');
      } else if (activeRangePreset === 'month') {
        start = from.clone().startOf('month').add(1, 'month');
        end = start.clone().endOf('month');
      } else if (activeRangePreset === 'threeMonths') {
        start = from.clone().startOf('month').add(3, 'month');
        end = start.clone().add(2, 'month').endOf('month');
      } else {
        // Move the range forward by the duration
        start = from.clone().add(duration + 1, 'days');
        end = to.clone().add(duration + 1, 'days');
      }

      if (end.isAfter(today)) {
        end = today.clone();
      }

      setDateRange(start, end, activeRangePreset);
      
      // Clear preset date selection since we're using custom navigation
      $('.presetdates').removeClass('selected');
      $('#rp_enabledate').prop('checked', true);
      
      // Update NEXT button visibility
      updateNextButtonVisibility();
      
      // Automatically trigger show
      show(event);
      return maybePrevent(event);
    }

    function switchreport_handler (event) {
      var id = $(this).attr('id');

      $('.menutab').removeClass('selected');
      $('#' + id).addClass('selected');

      $('.tabplaceholder').css('display', 'none');
      $('#' + id + '-placeholder').css('display', '');
      updateActiveReportTitle();
      
      // Show/hide preset date buttons based on report type
      if (id === 'daytoday' || id === 'dailystats') {
        // For day to day and daily stats, hide 3 months button
        $('.presetdates[days="90"]').hide();
        $('.presetdates').not('[days="90"]').show();
      } else if (id === 'distribution') {
        // For weekly distribution, hide Today, Last 2 days, Last 3 days, and 3 months buttons
        $('.presetdates[days="1"]').hide();
        $('.presetdates[days="2"]').hide();
        $('.presetdates[days="3"]').hide();
        $('.presetdates[days="90"]').hide();
        $('.presetdates').not('[days="1"], [days="2"], [days="3"], [days="90"]').show();
      } else if (id === 'treatments') {
        // For treatments, hide 2 weeks, month, and 3 months buttons
        $('.presetdates[days="14"]').hide();
        $('.presetdates[days="31"]').hide();
        $('.presetdates[days="90"]').hide();
        $('.presetdates').not('[days="14"], [days="31"], [days="90"]').show();
      } else {
        // For other reports, show all preset buttons
        $('.presetdates').show();
      }
      
      // Set appropriate date range based on selected report
      if (id === 'glucosedistribution') {
        // AGP Report: select previous calendar month
        $('.presetdates').removeClass('selected');
        setDataRange(null, 31);
        $('#rp_enabledate').prop('checked', true);
        // Load data if not already available
        window.setTimeout(function() {
          show();
        }, 100);
      } else if (id === 'daytoday') {
        // Day to day: select today and set size to 1000x300
        $('.presetdates').removeClass('selected');
        $('.presetdates[days="1"]').addClass('selected');
        setDataRange(null, 1);
        $('#rp_enabledate').prop('checked', true);
        $('#rp_size').val('1000x300').find('option').each(function() {
          if ($(this).attr('x') === '1000' && $(this).attr('y') === '300') {
            $(this).prop('selected', true);
          }
        });
        // Trigger show automatically for day to day
        window.setTimeout(function() {
          show();
        }, 100);
      } else if (id === 'treatments') {
        // Treatments: select today
        $('.presetdates').removeClass('selected');
        $('.presetdates[days="1"]').addClass('selected');
        setDataRange(null, 1);
        $('#rp_enabledate').prop('checked', true);
        // Load data if not already available
        window.setTimeout(function() {
          show();
        }, 100);
      } else if (id === 'weektoweek' || id === 'profiles' || id === 'calibrations') {
        // Week to week, Profiles, Calibrations: select 1 month
        $('.presetdates').removeClass('selected');
        $('.presetdates[days="31"]').addClass('selected');
        setDataRange(null, 31);
        $('#rp_enabledate').prop('checked', true);
        // Load data if not already available
        window.setTimeout(function() {
          show();
        }, 100);
      }
      
      return maybePrevent(event);
    }

    // Prefetched, per-day raw record buckets populated by prefetchRange() so that
    // loadData() can serve a whole report range from a handful of ranged queries
    // instead of 3 AJAX calls per day. prefetchDays[day] marks days the prefetch
    // covered (so empty days are served as empty rather than re-fetched per day).
    var prefetched = {};
    var prefetchDays = {};

    // devicestatus is large (openaps/iob/cob/predBGs) and the single heaviest report
    // collection. Only the 'daytoday' report actually consumes it (loopalyzer isn't
    // registered; AGP/weektoweek/profiles/treatments/calibrations never read it), and
    // daytoday hides the long-range presets. So only pull devicestatus when the daytoday
    // tab is the active report — long reports (e.g. 90-day AGP) then skip it entirely.
    function activeReportNeedsDevicestatus () {
      return $('#daytoday').hasClass('selected');
    }

    // Run an array of task factories (each returns a jQuery promise) with at most
    // `limit` in flight at once, so a long report can't unleash a burst of heavy
    // concurrent queries on a small VPS. Calls onDone() when all succeed; on the first
    // failure calls onFail() once and stops scheduling new tasks.
    function runWithConcurrency (tasks, limit, onDone, onFail) {
      if (!tasks.length) { onDone(); return; }
      var i = 0, active = 0, failed = false;
      function next () {
        if (failed) return;
        if (i >= tasks.length && active === 0) { onDone(); return; }
        while (active < limit && i < tasks.length) {
          var task = tasks[i++];
          active++;
          task().done(function () {
            active--;
            next();
          }).fail(function () {
            if (failed) return;
            failed = true;
            onFail();
          });
        }
      }
      next();
    }

    function reportDayStartMs (day) {
      var tz = client.sbx.data.profile.getTimezone();
      if (tz) {
        return parseInt(moment(day).tz(tz).startOf('day').format('x'));
      }
      return parseInt(moment(day).startOf('day').format('x'));
    }

    // Fetch entries/treatments/(devicestatus) for the full span of not-yet-cached
    // days in a few 7-day chunks, bucketing each record into prefetched[day]. On
    // any failure we clear the prefetch so loadData transparently falls back to its
    // original per-day AJAX path. Always invokes callback().
    function prefetchRange (options, callback) {
      prefetched = {};
      prefetchDays = {};
      var tz = client.sbx.data.profile.getTimezone();
      var needDevicestatus = !!(options.iob || options.cob || options.openAps || options.predicted) && activeReportNeedsDevicestatus();
      var today = moment().format('YYYY-MM-DD');

      // Mirror loadData()'s cache-skip logic: only fetch days not already in
      // datastorage (today always refreshes; a cached day still needs fetching if
      // devicestatus is now required but was not previously loaded).
      var days = [];
      Object.keys(daystoshow).forEach(function eachDay (d) {
        var cached = datastorage[d];
        if (cached && d !== today) {
          if (needDevicestatus && (!cached.devicestatus || !cached.devicestatus.length)) {
            days.push(d);
          }
          return;
        }
        days.push(d);
      });

      if (!days.length) { callback(); return; }

      days.sort();
      days.forEach(function (d) {
        prefetched[d] = { entries: [], treatments: [], devicestatus: [] };
        prefetchDays[d] = true;
      });

      var spanStart = reportDayStartMs(days[0]);
      var spanEnd = reportDayStartMs(days[days.length - 1]) + 24 * 60 * 60 * 1000;

      var CHUNK_MS = 7 * 24 * 60 * 60 * 1000;
      var chunks = [];
      for (var s = spanStart; s < spanEnd; s += CHUNK_MS) {
        chunks.push({ from: s, to: Math.min(s + CHUNK_MS, spanEnd) });
      }

      function bucket (collection, mills, record) {
        if (typeof mills !== 'number' || !isFinite(mills)) return;
        var key = tz ? moment.tz(mills, tz).format('YYYY-MM-DD') : moment(mills).format('YYYY-MM-DD');
        if (!prefetched[key]) prefetched[key] = { entries: [], treatments: [], devicestatus: [] };
        prefetched[key][collection].push(record);
      }

      var perfStart = (window.performance && performance.now) ? performance.now() : 0;

      // Build request *factories* (not live requests) so runWithConcurrency can keep at
      // most PREFETCH_CONCURRENCY heavy queries in flight against the single-process
      // server instead of firing every chunk at once.
      var PREFETCH_CONCURRENCY = 2;
      var tasks = [];
      chunks.forEach(function (c) {
        tasks.push(function () {
          return $.ajax('/api/v1/entries.json?find[date][$gte]=' + c.from + '&find[date][$lt]=' + c.to + '&count=20000', {
            headers: client.headers()
            , success: function (xhr) {
              xhr.forEach(function (e) { if (e && e.date !== undefined) bucket('entries', e.date, e); });
            }
          });
        });
        tasks.push(function () {
          return $.ajax('/api/v1/treatments.json?find[created_at][$gte]=' + new Date(c.from).toISOString() + '&find[created_at][$lt]=' + new Date(c.to).toISOString() + '&count=5000', {
            headers: client.headers()
            , cache: false
            , success: function (xhr) {
              xhr.forEach(function (t) { bucket('treatments', new Date(t.timestamp || t.created_at).getTime(), t); });
            }
          });
        });
        if (needDevicestatus) {
          tasks.push(function () {
            return $.ajax('/api/v1/devicestatus.json?find[created_at][$gte]=' + new Date(c.from).toISOString() + '&find[created_at][$lt]=' + new Date(c.to).toISOString() + '&count=20000', {
              headers: client.headers()
              , success: function (xhr) {
                xhr.forEach(function (ds) { bucket('devicestatus', new Date(ds.timestamp || ds.created_at).getTime(), ds); });
              }
            });
          });
        }
      });

      runWithConcurrency(tasks, PREFETCH_CONCURRENCY, function () {
        if (window.reportPerf && perfStart) {
          var rows = 0;
          Object.keys(prefetched).forEach(function (k) {
            rows += prefetched[k].entries.length + prefetched[k].treatments.length + prefetched[k].devicestatus.length;
          });
          console.log('[reportPerf] prefetch:', tasks.length, 'requests,', days.length, 'days,', rows, 'rows in', Math.round(performance.now() - perfStart) + 'ms');
        }
        callback();
      }, function () {
        prefetched = {};
        prefetchDays = {};
        callback();
      });
    }

    function loadData (day, options, callback) {
      // check for loaded data
      if ((options.openAps || options.predicted || options.iob || options.cob) && datastorage[day] && !datastorage[day].devicestatus.length) {
        // OpenAPS requested but data not loaded. Load anyway ...
      } else if (datastorage[day] && day !== moment().format('YYYY-MM-DD')) {
        callback(day);
        return;
      }
      // patientData = [actual, predicted, mbg, treatment, cal, devicestatusData];
      var data = {};
      var cgmData = []
        , mbgData = []
        , treatmentData = []
        , calData = [];
      var from;
      if (client.sbx.data.profile.getTimezone()) {
        from = moment(day).tz(client.sbx.data.profile.getTimezone()).startOf('day').format('x');
      } else {
        from = moment(day).startOf('day').format('x');
      }
      from = parseInt(from);
      var to = from + 1000 * 60 * 60 * 24;

      function processCGM (xhr) {
        xhr.forEach(function(element) {
          if (element) {
            if (element.mbg) {
              mbgData.push({
                y: element.mbg
                , mills: element.date
                , d: element.dateString
                , device: element.device
              });
            } else if (element.sgv) {
              cgmData.push({
                y: element.sgv
                , mills: element.date
                , d: element.dateString
                , device: element.device
                , filtered: element.filtered
                , unfiltered: element.unfiltered
                , noise: element.noise
                , rssi: element.rssi
                , sgv: element.sgv
              });
            } else if (element.type === 'cal') {
              calData.push({
                mills: element.date + 1
                , d: element.dateString
                , scale: element.scale
                , intercept: element.intercept
                , slope: element.slope
              });
            }
          }
        });
        // sometimes cgm contains duplicates.  uniq it.
        data.sgv = cgmData.slice();
        data.sgv.sort(function(a, b) { return a.mills - b.mills; });
        var lastDate = 0;
        data.sgv = data.sgv.filter(function(d) {
          var ok = (lastDate + ONE_MIN_IN_MS) <= d.mills;
          lastDate = d.mills;
          return ok;
        });
        data.mbg = mbgData.slice();
        data.mbg.sort(function(a, b) { return a.mills - b.mills; });
        data.cal = calData.slice();
        data.cal.sort(function(a, b) { return a.mills - b.mills; });
      }

      function loadCGMData () {
        if (daystoshow[day].treatmentsonly) {
          data.sgv = [];
          data.mbg = [];
          data.cal = [];
          return $.Deferred().resolve();
        }
        if (prefetchDays[day]) {
          processCGM(prefetched[day].entries);
          return $.Deferred().resolve();
        }
        var query = '?find[date][$gte]=' + from + '&find[date][$lt]=' + to + '&count=10000';
        return $.ajax('/api/v1/entries.json' + query, {
          headers: client.headers()
          , success: processCGM
        });
      }

      function processTreatments (xhr) {
        treatmentData = xhr.map(function(treatment) {
          var timestamp = new Date(treatment.timestamp || treatment.created_at);
          treatment.mills = timestamp.getTime();
          return treatment;
        });
        data.treatments = treatmentData.slice();
        data.treatments.sort(function(a, b) { return a.mills - b.mills; });
        // filter 'Combo Bolus' events
        data.combobolusTreatments = data.treatments.filter(function filterComboBoluses (t) {
          return t.eventType === 'Combo Bolus';
        });
        // filter temp basal treatments
        data.tempbasalTreatments = data.treatments.filter(function filterTempBasals (t) {
          return t.eventType === 'Temp Basal';
        });
        // filter profile switch treatments
        var profileSwitch = data.treatments.filter(function filterProfileSwitch (t) {
          return t.eventType === 'Profile Switch';
        });
        datastorage.profileSwitchTreatments = datastorage.profileSwitchTreatments.concat(profileSwitch);
      }

      function loadTreatmentData () {
        if (!datastorage.profileSwitchTreatments)
          datastorage.profileSwitchTreatments = [];
        if (prefetchDays[day]) {
          processTreatments(prefetched[day].treatments);
          return $.Deferred().resolve();
        }
        var tquery = '?find[created_at][$gte]=' + new Date(from).toISOString() + '&find[created_at][$lt]=' + new Date(to).toISOString() + '&count=1000';
        return $.ajax('/api/v1/treatments.json' + tquery, {
          headers: client.headers()
          , cache: false
          , success: processTreatments
        });
      }

      function processDevicestatus (xhr) {
        data.devicestatus = xhr.map(function(devicestatus) {
          devicestatus.mills = new Date(devicestatus.timestamp || devicestatus.created_at).getTime();
          return devicestatus;
        });
      }

      function loadDevicestatusData () {
        if (daystoshow[day].treatmentsonly) {
          data.devicestatus = [];
          return $.Deferred().resolve();
        }
        if (options.iob || options.cob || options.openAps || options.predicted) {
          if (prefetchDays[day]) {
            processDevicestatus(prefetched[day].devicestatus);
            return $.Deferred().resolve();
          }
          var tquery = '?find[created_at][$gte]=' + new Date(from).toISOString() + '&find[created_at][$lt]=' + new Date(to).toISOString() + '&count=10000';
          return $.ajax('/api/v1/devicestatus.json' + tquery, {
            headers: client.headers()
            , success: processDevicestatus
          });
        } else {
          data.devicestatus = [];
          return $.Deferred().resolve();
        }
      }

      $.when(loadCGMData(), loadTreatmentData(), loadDevicestatusData()).done(function() {
        processData(data, day, options, callback);
      });
    }

    function loadProfileSwitch (from, callback) {
      $('#info > b').html('<b>' + translate('Loading profile switch data') + ' ...</b>');
      var tquery = '?find[eventType]=Profile Switch' + '&find[created_at][$lte]=' + new Date(from).toISOString() + '&count=1';
      $.ajax('/api/v1/treatments.json' + tquery, {
        headers: client.headers()
        , success: function(xhr) {
          var treatmentData = xhr.map(function(treatment) {
            var timestamp = new Date(treatment.timestamp || treatment.created_at);
            treatment.mills = timestamp.getTime();
            return treatment;
          });
          if (!datastorage.profileSwitchTreatments)
            datastorage.profileSwitchTreatments = [];
          datastorage.profileSwitchTreatments = datastorage.profileSwitchTreatments.concat(treatmentData);
          datastorage.profileSwitchTreatments.sort(function(a, b) { return a.mills - b.mills; });
        }
      }).done(function() {
        callback();
      });
    }

    function loadProfilesRange (dateFrom, dateTo, dayCount, callback, progressCallback) {
      $('#info > b').html('<b>' + translate('Loading profile range') + ' ...</b>');

      $.when(
          loadProfilesRangeCore(dateFrom, dateTo, dayCount)
          , loadProfilesRangePrevious(dateFrom)
          , loadProfilesRangeNext(dateTo)
        )
        .done(function() {
          if (progressCallback) {
            progressCallback(); // Core profiles loaded
            progressCallback(); // Previous profile loaded
            progressCallback(); // Next profile loaded
          }
          callback();
        })
        .fail(function() {
          datastorage.profiles = [];
        });
    }

    function loadProfilesRangeCore (dateFrom, dateTo) {
      $('#info > b').html('<b>' + translate('Loading core profiles') + ' ...</b>');

      //The results must be returned in descending order to work with key logic in routines such as getCurrentProfile
      var tquery = '?find[startDate][$gte]=' + new Date(dateFrom).toISOString() + '&find[startDate][$lte]=' + new Date(dateTo).toISOString() + '&sort[startDate]=-1&count=1000';

      return $.ajax('/api/v1/profiles' + tquery, {
        headers: client.headers()
        , async: false
        , success: function(records) {
          datastorage.profiles = records;
        }
      });
    }

    function loadProfilesRangePrevious (dateFrom) {
      $('#info > b').html('<b>' + translate('Loading previous profile') + ' ...</b>');

      //Find first one before the start date and add to datastorage.profiles
      var tquery = '?find[startDate][$lt]=' + new Date(dateFrom).toISOString() + '&sort[startDate]=-1&count=1';

      return $.ajax('/api/v1/profiles' + tquery, {
        headers: client.headers()
        , async: false
        , success: function(records) {
          records.forEach(function(r) {
            datastorage.profiles.push(r);
          });
        }
      });
    }

    function loadProfilesRangeNext (dateTo) {
      $('#info > b').html('<b>' + translate('Loading data. Please wait.') + '</b>');

      //Find first one after the end date and add to datastorage.profiles
      var tquery = '?find[startDate][$gt]=' + new Date(dateTo).toISOString() + '&sort[startDate]=1&count=1';

      return $.ajax('/api/v1/profiles' + tquery, {
        headers: client.headers()
        , async: false
        , success: function(records) {
          records.forEach(function(r) {
            //must be inserted as top to maintain profiles being sorted by date in descending order
            datastorage.profiles.unshift(r);
          });
        }
      });
    }

    function processData (data, day, options, callback) {
      if (daystoshow[day].treatmentsonly) {
        datastorage[day] = data;
        $('#info-' + day).html('');
        callback(day);
        return;
      }
      // treatments
      data.dailyCarbs = 0;
      data.dailyProtein = 0;
      data.dailyFat = 0;

      data.treatments.forEach(function(d) {
        if (parseFloat(d.insulin) > maxInsulinValue) {
          maxInsulinValue = parseFloat(d.insulin);
        }
        if (parseFloat(d.carbs) > maxCarbsValue) {
          maxCarbsValue = parseFloat(d.carbs);
        }
        if (d.carbs) {
          data.dailyCarbs += Number(d.carbs);
        }
        if (d.protein) {
          data.dailyProtein += Number(d.protein);
        }
        if (d.fat) {
          data.dailyFat += Number(d.fat);
        }
      });
      if (data.dailyCarbs > maxDailyCarbsValue) {
        maxDailyCarbsValue = data.dailyCarbs;
      }

      var cal = data.cal[data.cal.length - 1];
      var temp1 = [];
      var rawbg = client.rawbg;
      if (cal) {
        temp1 = data.sgv.map(function(entry) {
          entry.mgdl = entry.y; // value names changed from enchilada
          var rawBg = rawbg.calc(entry, cal);
          return { mills: entry.mills, date: new Date(entry.mills - 2 * 1000), y: rawBg, sgv: client.utils.scaleMgdl(rawBg), color: 'gray', type: 'rawbg', filtered: entry.filtered, unfiltered: entry.unfiltered };
        }).filter(function(entry) { return entry.y > 0 });
      }
      var temp2 = data.sgv.map(function(obj) {
        return { mills: obj.mills, date: new Date(obj.mills), y: obj.y, sgv: client.utils.scaleMgdl(obj.y), color: sgvToColor(client.utils.scaleMgdl(obj.y), options), type: 'sgv', noise: obj.noise, filtered: obj.filtered, unfiltered: obj.unfiltered };
      });
      data.sgv = [].concat(temp1, temp2);

      //Add MBG's also, pretend they are SGV's
      data.sgv = data.sgv.concat(data.mbg.map(function(obj) { return { date: new Date(obj.mills), y: obj.y, sgv: client.utils.scaleMgdl(obj.y), color: 'red', type: 'mbg', device: obj.device } }));

      // make sure data range will be exactly 24h
      var from;
      if (client.sbx.data.profile.getTimezone()) {
        from = moment(day).tz(client.sbx.data.profile.getTimezone()).startOf('day').toDate();
      } else {
        from = moment(day).startOf('day').toDate();
      }
      var to = new Date(from.getTime() + 1000 * 60 * 60 * 24);
      data.sgv.push({ date: from, y: 40, sgv: 40, color: 'transparent', type: 'rawbg' });
      data.sgv.push({ date: to, y: 40, sgv: 40, color: 'transparent', type: 'rawbg' });

      // clear error data. we don't need it to display them
      data.sgv = data.sgv.filter(function(d) {
        if (d.y < 39) {
          return false;
        }
        return true;
      });

      // Attach the matching devicestatus.openaps to each sgv. Replaces an O(n*m)
      // _.find-per-point scan with a one-time sort + binary search (O(n log m)):
      // for each sgv pick the earliest devicestatus within the next 5 minutes.
      var sortedStatus = data.devicestatus.filter(function (d) {
        return typeof d.mills === 'number' && isFinite(d.mills);
      }).slice().sort(function (a, b) { return a.mills - b.mills; });
      var statusMills = sortedStatus.map(function (d) { return d.mills; });
      function findStatusFor (t) {
        var lo = 0, hi = statusMills.length;
        while (lo < hi) {
          var mid = (lo + hi) >> 1;
          if (statusMills[mid] < t) lo = mid + 1; else hi = mid;
        }
        if (lo < statusMills.length && statusMills[lo] < t + 5 * 60 * 1000) return sortedStatus[lo];
        return null;
      }
      data.sgv = data.sgv.map(function eachSgv (sgv) {
        if (sgv.mills !== undefined) {
          var status = findStatusFor(sgv.mills);
          if (status && status.openaps) {
            sgv.openaps = status.openaps;
          }
        }
        return sgv;
      });

      // for other reports
      data.statsrecords = data.sgv.filter(function(r) {
        if (r.type) {
          return r.type === 'sgv';
        } else {
          return true;
        }
      }).map(function(r) {
        var ret = {};
        ret.sgv = parseFloat(r.sgv);
        ret.bgValue = parseInt(r.y);
        ret.displayTime = r.date;
        return ret;
      });

      datastorage[day] = data;
      callback(day);
    }

    function maybePrevent (event) {
      if (event) {
        event.preventDefault();
      }
      return false;
    }
  });
};

module.exports = init;
