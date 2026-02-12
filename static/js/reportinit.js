'use strict';

$(document).ready(function() {
			// Manual plugin initialization if not already done
			if (!window.Nightscout) window.Nightscout = {};
			if (!window.Nightscout.report_plugins) {
				// Require plugin index and initialize with dummy context
				// This assumes index.js is bundled and available as window.Nightscout.report_plugins_init
				if (window.Nightscout.report_plugins_init) {
					window.Nightscout.report_plugins = window.Nightscout.report_plugins_init({ language: 'en' });
				}
			}
			if (window.Nightscout.report_plugins && typeof window.Nightscout.report_plugins.addHtmlFromPlugins === 'function') {
				window.Nightscout.report_plugins.addHtmlFromPlugins(window.Nightscout.client || {});
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
			// Optionally, call report function for plugin
			// This assumes plugins are registered globally in window.Nightscout.report_plugins
			if (window.Nightscout && window.Nightscout.report_plugins && window.Nightscout.report_plugins[pluginName]) {
				var plugin = window.Nightscout.report_plugins[pluginName];
				if (typeof plugin.report === 'function') {
					// Gather necessary arguments (datastorage, sorteddaystoshow, options)
					// These should be set up elsewhere in your app
					var datastorage = window.Nightscout.datastorage || {};
					var sorteddaystoshow = window.Nightscout.sorteddaystoshow || [];
					var options = window.Nightscout.options || {};
					plugin.report(datastorage, sorteddaystoshow, options);
				}
			}
			// Show plugin placeholder
			$('.tabplaceholder').css('display', 'none');
			pluginPlaceholder.css('display', '');
		});
	console.log('Application got ready event');
	window.Nightscout.reportclient();

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
		}
		$('#rp_show').prop('disabled', false).show().click();
	}, 100);
});
});
