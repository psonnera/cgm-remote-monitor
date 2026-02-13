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

	// On page load, mark the default selected preset date
	function markDefaultPreset() {
		var days = 31; // Default to 1 month
		var found = false;
		$('.presetdates').each(function() {
			if ($(this).attr('days') == days) {
				$(this).addClass('selected');
				found = true;
			}
		});
		if (!found) {
			$('.presetdates').first().addClass('selected');
		}
	}
	markDefaultPreset();

	// Trigger SHOW button on plugin tab selection
	$('#tabnav').on('click', '.menutab', function() {
		$('#tabnav > li').removeClass('selected');
		$(this).addClass('selected');
		// Hide all plugin placeholders
		$('.tabplaceholder').css('display', 'none');
		// Show selected plugin placeholder
		$('#' + $(this).attr('id') + '-placeholder').css('display', '');
		// Trigger report load
		$('#rp_show').prop('disabled', false).show().click();
	});

	// Force AGP Report to be the default report on page load
	setTimeout(function() {
		var agpTab = $('#tabnav > li#glucosedistribution');
		if (agpTab.length) {
			$('#tabnav > li').removeClass('selected');
			agpTab.addClass('selected');
			$('.tabplaceholder').css('display', 'none');
			$('#glucosedistribution-placeholder').css('display', '');
			$('#rp_show').prop('disabled', false).show().click();
		}
	}, 100);
});
