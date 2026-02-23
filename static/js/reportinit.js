'use strict';

$(document).ready(function() {
	// Ensure window.Nightscout exists
	if (!window.Nightscout) {
		window.Nightscout = {};
	}
	
	if (window.Nightscout.reportclient && typeof window.Nightscout.reportclient === 'function') {
		window.Nightscout.reportclient();
	}
	
	// Handler for SHOW button
	$('#rp_show').on('click', function() {
		// Find selected plugin tab
		var selectedTab = $('#tabnav > li.selected');
		if (selectedTab.length === 0) {
			selectedTab = $('#tabnav > li').first();
		}
		var pluginName = selectedTab.attr('id');
		// Find plugin placeholder
		var pluginPlaceholder = $('#' + pluginName + '-placeholder');
		// Show plugin placeholder
		$('.tabplaceholder').css('display', 'none');
		pluginPlaceholder.css('display', '');
	});

	// Ensure SHOW button is always enabled and visible
	$('#rp_show').prop('disabled', false).show();

	// Handle preset date selection
	$('.presetdates').on('click', function(e) {
		e.preventDefault();
		$('.presetdates').removeClass('selected');
		$(this).addClass('selected');
		// Optionally update date fields here
	});

	// On page load, AGP uses previous calendar month (not a preset)
	// So no preset button should be selected initially
	// Preset selection is handled when user clicks a preset or switches reports

	// Tab click handling is done by switchreport_handler in reportclient.js
	// Removed duplicate handler that was causing double show() calls

	// AGP Report tab selection is handled by reportclient.js
	// Removed duplicate initialization that was causing double data loading
});
