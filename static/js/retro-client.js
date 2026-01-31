'use strict';

$(document).ready(function() {
  console.log('Retro client got ready event');
  
  // Fetch server settings
  $.ajax({
    method: 'GET',
    url: '/api/v1/status.json?t=' + new Date().getTime()
  }).done(function(serverSettings) {
    $('#loadingMessageText').html('Starting Retro Mode...');
    
    // Initialize retro client
    var retro = window.Nightscout.retro;
    if (!retro) {
      $('#loadingMessageText').html('Error: Retro module not loaded');
      console.error('window.Nightscout.retro is not defined');
      return;
    }
    
    retro.init(serverSettings, function() {
      console.log('Retro client initialized');
      $('#centerMessagePanel').hide();
      
      // Load yesterday's data (midnight to midnight) by default
      var now = new Date();
      var yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      
      var todayMidnight = new Date(now);
      todayMidnight.setHours(0, 0, 0, 0);
      
      var from = yesterday.getTime();
      var to = todayMidnight.getTime();
      
      console.log('Loading yesterday from:', new Date(from).toISOString(), 'to:', new Date(to).toISOString());
      console.log('Time range in mills - from:', from, 'to:', to);
      
      retro.loadDataForTimeRange(from, to);
    });
    
    // Store retro instance globally for control handlers
    window.retroClient = retro;
    
    // Set up drawer controls
    $('#drawerToggle').click(function(e) {
      e.preventDefault();
      $('#retroControlsDrawer').toggleClass('open');
      $('#drawerOverlay').toggleClass('open');
    });
    
    $('#drawerOverlay').click(function() {
      $('#retroControlsDrawer').removeClass('open');
      $('#drawerOverlay').removeClass('open');
    });
    
    // Set up controls
    $('#quickRange').change(function() {
      var hours = parseInt($(this).val());
      var to = Date.now();
      var from = to - (hours * 60 * 60 * 1000);
      retro.loadDataForTimeRange(from, to);
    });
    
    $('#displayHours').change(function() {
      var hours = parseInt($(this).val());
      retro.setTimeRange(hours);
    });
    
    $('#loadCustomRange').click(function() {
      var from = new Date($('#fromDate').val()).getTime();
      var to = new Date($('#toDate').val()).getTime();
      if (from && to && from < to) {
        retro.loadDataForTimeRange(from, to);
      } else {
        alert('Please select valid date range');
      }
    });
    
    $('#backToLive').click(function() {
      window.location.href = '/';
    });
    
    // Set default dates to yesterday (midnight to midnight)
    var now = new Date();
    var yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    var todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);
    
    $('#fromDate').val(yesterday.toISOString().slice(0, 16));
    $('#toDate').val(todayMidnight.toISOString().slice(0, 16));
    
  }).fail(function(jqXHR, textStatus, errorThrown) {
    $('#loadingMessageText').html('Failed to connect to server: ' + textStatus);
    console.error('Failed to fetch server settings:', textStatus, errorThrown);
  });
});
