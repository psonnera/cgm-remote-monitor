'use strict';

var profiles = {
  name: 'profiles'
  , label: 'Profiles'
  , pluginType: 'report'
};

function init () {
  return profiles;
}

module.exports = init;

profiles.html = function html (client) {
  var translate = client.translate;
  var ret =
    '<h2>' + translate('Profiles') + '</h2>' +
    '<div style="display:none;">' +
    '<br>' + translate('Database records') + '&nbsp' +
    '<br><select id="profiles-databaserecords"></select>' +
    '</div>' +
    '<div style="margin: 20px 0; padding: 15px; background-color: #e8f4f8; border: 2px solid #4a90e2; border-radius: 8px;">' +
    '<label style="font-size: 14pt; font-weight: bold; color: #333; margin-right: 10px;">' + translate('Profile') + ':</label>' +
    '<select id="profiles-selector" style="padding: 8px 12px; font-size: 13pt; font-weight: bold; border: 2px solid #4a90e2; border-radius: 5px; background-color: white; cursor: pointer; min-width: 200px;"></select>' +
    '<span id="profiles-default" style="margin-left: 20px; font-style: italic; color: #666;"></span>' +
    '</div>' +
    '<div id="profiles-chart">' +
    '</div>';
  return ret;
};

profiles.css =
  '#profiles-chart {' +
  '  width: 100%;' +
  '  height: 100%;' +
  '}' +
  '.profile-general-info {' +
  '  margin: 20px 0;' +
  '  padding: 15px;' +
  '  background-color: #f5f5f5;' +
  '  border: 1px solid #ddd;' +
  '  border-radius: 5px;' +
  '}' +
  '.profile-section {' +
  '  margin: 20px 0;' +
  '  padding: 15px;' +
  '  border: 1px solid #ddd;' +
  '  border-radius: 5px;' +
  '  background-color: #fff;' +
  '}' +
  '.profile-section-title {' +
  '  font-weight: bold;' +
  '  font-size: 14pt;' +
  '  margin-bottom: 10px;' +
  '  color: #333;' +
  '}' +
  '.profile-data-container {' +
  '  display: flex;' +
  '  gap: 20px;' +
  '  align-items: flex-start;' +
  '}' +
  '.profile-table {' +
  '  border-collapse: collapse;' +
  '  width: auto;' +
  '}' +
  '.profile-table th, .profile-table td {' +
  '  border: 1px solid #ddd;' +
  '  padding: 8px 12px;' +
  '  text-align: left;' +
  '  white-space: nowrap;' +
  '}' +
  '.profile-table th {' +
  '  background-color: #f0f0f0;' +
  '  font-weight: bold;' +
  '  width: 1%;' +
  '}' +
  '.profile-graph {' +
  '  width: 400px;' +
  '  height: 150px;' +
  '  border: 1px solid #ddd;' +
  '  flex-shrink: 0;' +
  '}';

profiles.report = function report_profiles (datastorage) {
  var Nightscout = window.Nightscout;
  var client = Nightscout.client;
  var translate = client.translate;
  var $ = window.$;

  var profileRecords = datastorage.profiles;
  var databaseRecords = $('#profiles-databaserecords');
  var profileSelector = $('#profiles-selector');

  databaseRecords.empty();
  for (var r = 0; r < profileRecords.length; r++) {
    databaseRecords.append('<option value="' + r + '">' + translate('Valid from:') + ' ' + new Date(profileRecords[r].startDate).toLocaleString() + '</option>');
  }
  databaseRecords.unbind().bind('change', recordChange);

  recordChange();

  function recordChange (event) {
    if ($('#profiles-databaserecords option').length < 1)
      return;
    var currentindex = databaseRecords.val();
    var currentrecord = profileRecords[currentindex];

    $('#profiles-default').text(translate('Default profile') + ': ' + currentrecord.defaultProfile);

    // Populate profile selector
    profileSelector.empty();
    var profileNames = Object.keys(currentrecord.store);
    profileNames.forEach(function(profileName) {
      profileSelector.append('<option value="' + profileName + '">' + profileName + '</option>');
    });
    
    // Set default profile as selected if available
    if (currentrecord.defaultProfile && profileNames.includes(currentrecord.defaultProfile)) {
      profileSelector.val(currentrecord.defaultProfile);
    }
    
    profileSelector.unbind().bind('change', profileChange);
    profileChange();

    if (event) {
      event.preventDefault();
    }
  }

  function profileChange (event) {
    var currentindex = databaseRecords.val();
    var currentrecord = profileRecords[currentindex];
    var selectedProfile = profileSelector.val();
    var record = currentrecord.store[selectedProfile];

    if (!record) return;

    var container = $('<div>');

    // General profile information
    var generalInfo = $('<div class="profile-general-info">');
    generalInfo.append($('<div>').html('<b>' + selectedProfile + '</b>'));
    generalInfo.append($('<div>').html('<b>' + translate('Units') + '</b>: ' + record.units));
    generalInfo.append($('<div>').html('<b>' + translate('DIA') + '</b>: ' + record.dia));
    generalInfo.append($('<div>').html('<b>' + translate('Timezone') + '</b>: ' + record.timezone));
    generalInfo.append($('<div>').html('<b>' + translate('Carbs activity / absorption rate') + '</b>: ' + record.carbs_hr));
    container.append(generalInfo);

    // Basal rates section
    if (record.basal && record.basal.length > 0) {
      container.append(createDataSection(translate('Basal rates [unit/hour]'), record.basal, 'basal'));
    }

    // Carb ratio section
    if (record.carbratio && record.carbratio.length > 0) {
      container.append(createDataSection(translate('Insulin to carb ratio (I:C)'), record.carbratio, 'carbratio'));
    }

    // ISF section
    if (record.sens && record.sens.length > 0) {
      container.append(createDataSection(translate('Insulin Sensitivity Factor (ISF)'), record.sens, 'sens'));
    }

    // Target BG range section
    if (record.target_low && record.target_high && record.target_low.length > 0) {
      container.append(createTargetSection(translate('Target BG range [mg/dL,mmol/L]'), record.target_low, record.target_high));
    }

    $('#profiles-chart').empty().append(container);

    if (event) {
      event.preventDefault();
    }
  }

  function createDataSection(title, data, type) {
    var section = $('<div class="profile-section">');
    section.append($('<div class="profile-section-title">').text(title));
    
    var dataContainer = $('<div class="profile-data-container">');
    
    // Create table
    var table = $('<table class="profile-table">');
    table.append($('<tr>').append($('<th>').text(translate('Time'))).append($('<th>').text(translate('Value'))));
    
    data.forEach(function(item) {
      table.append($('<tr>').append($('<td>').text(item.time)).append($('<td>').text(item.value)));
    });
    
    dataContainer.append(table);
    
    // Create graph
    var graphId = 'profile-graph-' + type;
    var graphDiv = $('<div class="profile-graph">').attr('id', graphId);
    dataContainer.append(graphDiv);
    
    section.append(dataContainer);
    
    // Render graph after DOM insertion
    setTimeout(function() {
      renderGraph(graphId, data);
    }, 100);
    
    return section;
  }

  function createTargetSection(title, targetLow, targetHigh) {
    var section = $('<div class="profile-section">');
    section.append($('<div class="profile-section-title">').text(title));
    
    var dataContainer = $('<div class="profile-data-container">');
    
    // Create table
    var table = $('<table class="profile-table">');
    table.append($('<tr>').append($('<th>').text(translate('Time'))).append($('<th>').text(translate('Low'))).append($('<th>').text(translate('High'))));
    
    for (var i = 0; i < targetLow.length; i++) {
      table.append($('<tr>')
        .append($('<td>').text(targetLow[i].time))
        .append($('<td>').text(targetLow[i].value))
        .append($('<td>').text(targetHigh[i].value))
      );
    }
    
    dataContainer.append(table);
    
    // Create graph for target ranges
    var graphId = 'profile-graph-target';
    var graphDiv = $('<div class="profile-graph">').attr('id', graphId);
    dataContainer.append(graphDiv);
    
    section.append(dataContainer);
    
    // Render graph after DOM insertion
    setTimeout(function() {
      renderTargetGraph(graphId, targetLow, targetHigh);
    }, 100);
    
    return section;
  }

  function timeToMinutes(timeStr) {
    var parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }

  function renderGraph(graphId, data) {
    try {
      // Convert time-based data to 24-hour format
      var plotData = [];
      
      for (var i = 0; i < data.length; i++) {
        var startMinutes = timeToMinutes(data[i].time);
        var endMinutes = i < data.length - 1 ? timeToMinutes(data[i + 1].time) : 24 * 60;
        
        var startDate = new Date(2000, 0, 1, Math.floor(startMinutes / 60), startMinutes % 60);
        var endDate = new Date(2000, 0, 1, Math.floor(endMinutes / 60), endMinutes % 60);
        
        plotData.push([startDate, data[i].value]);
        plotData.push([endDate, data[i].value]);
      }

      $.plot('#' + graphId, [{
        data: plotData,
        color: '#4a90e2',
        lines: { show: true, lineWidth: 2, steps: true }
      }], {
        xaxis: {
          mode: 'time',
          timeBase: 'milliseconds',
          timezone: 'browser',
          timeformat: '%H:%M',
          min: new Date(2000, 0, 1, 0, 0).getTime(),
          max: new Date(2000, 0, 1, 23, 59).getTime()
        },
        yaxis: {
          min: 0
        },
        grid: {
          borderWidth: 1,
          borderColor: '#ddd'
        }
      });
    } catch (e) {
      console.error('Error rendering profile graph:', e);
      $('#' + graphId).html('<div style="color: red; padding: 10px;">Error rendering graph</div>');
    }
  }

  function renderTargetGraph(graphId, targetLow, targetHigh) {
    try {
      var plotDataLow = [];
      var plotDataHigh = [];
      
      for (var i = 0; i < targetLow.length; i++) {
        var startMinutes = timeToMinutes(targetLow[i].time);
        var endMinutes = i < targetLow.length - 1 ? timeToMinutes(targetLow[i + 1].time) : 24 * 60;
        
        var startDate = new Date(2000, 0, 1, Math.floor(startMinutes / 60), startMinutes % 60);
        var endDate = new Date(2000, 0, 1, Math.floor(endMinutes / 60), endMinutes % 60);
        
        plotDataLow.push([startDate, targetLow[i].value]);
        plotDataLow.push([endDate, targetLow[i].value]);
        plotDataHigh.push([startDate, targetHigh[i].value]);
        plotDataHigh.push([endDate, targetHigh[i].value]);
      }

      $.plot('#' + graphId, [{
        data: plotDataLow,
        color: '#e74c3c',
        lines: { show: true, lineWidth: 2, steps: true },
        label: translate('Low')
      }, {
        data: plotDataHigh,
        color: '#e67e22',
        lines: { show: true, lineWidth: 2, steps: true },
        label: translate('High')
      }], {
        xaxis: {
          mode: 'time',
          timeBase: 'milliseconds',
          timezone: 'browser',
          timeformat: '%H:%M',
          min: new Date(2000, 0, 1, 0, 0).getTime(),
          max: new Date(2000, 0, 1, 23, 59).getTime()
        },
        yaxis: {
          min: 0
        },
        grid: {
          borderWidth: 1,
          borderColor: '#ddd'
        },
        legend: {
          show: true,
          position: 'nw'
        }
      });
    } catch (e) {
      console.error('Error rendering target graph:', e);
      $('#' + graphId).html('<div style="color: red; padding: 10px;">Error rendering graph</div>');
    }
  }
};
