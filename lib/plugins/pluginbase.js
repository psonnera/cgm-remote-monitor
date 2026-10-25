'use strict';

var _map = require('lodash/map');
var _each = require('lodash/each');

var TOOLTIP_WIDTH = 275;  //min-width + padding

// plain text for a title attribute: a translated label may carry markup
function toTextContent (value) {
  return String(value == null ? '' : value).replace(/<[^>]*>/g, '');
}

function init (majorPills, minorPills, statusPills, bgStatus, tooltip, storage, translate) {

  var pluginBase = { };

  pluginBase.forecastInfos = [];
  pluginBase.forecastPoints = {};

  function findOrCreatePill (plugin) {
    var container = null;

    if (plugin.pluginType === 'pill-major') {
      container = majorPills;
    } else if (plugin.pluginType === 'pill-status') {
      container = statusPills;
    } else if (plugin.pluginType === 'bg-status') {
      container = bgStatus;
    } else {
      container = minorPills;
    }

    var pillName = 'span.pill.' + plugin.name;
    var pill = container.find(pillName);

    var classes = 'pill ' + plugin.name;

    if (!pill || pill.length === 0) {
      pill = $('<span class="' + classes + '">');
      var pillLabel = $('<label></label>');
      var pillValue = $('<em></em>');
      if (plugin.pillFlip) {
        pill.append(pillValue);
        pill.append(pillLabel);
      } else {
        pill.append(pillLabel);
        pill.append(pillValue);
      }

      container.append(pill);
    } else {
      //reset in case a pill class was added and needs to be removed
      pill.attr('class', classes);
    }

    return pill;
  }

  pluginBase.updatePillText = function updatePillText (plugin, options) {

    var pill = findOrCreatePill(plugin);

    if (options.hide) {
      pill.addClass('hidden');
    } else {
      pill.removeClass('hidden');
    }

    pill.addClass(options.pillClass);

    if (options.directHTML) {
      pill.html(options.label);
    } else {
      if (options.directText) {
        pill.text(options.label);
      } else {
        pill.find('label').attr('class', options.labelClass).text(options.label);
        pill.find('em')
          .attr('class', options.valueClass)
          .toggle(options.value != null)
          .text(options.value)
        ;
      }
    }

    if (options.info  && options.info.length) {
      // a pill that builds its own tooltip must not also carry a (stale) title
      pill.removeAttr('title');
      var html = _map(options.info, function mapInfo (i) {
        return '<strong>' + i.label + '</strong> ' + i.value;
      }).join('<br/>\n');

      pill.mouseover(function pillMouseover (event) {
        tooltip.style('display', 'block');

        var windowWidth = $(tooltip.node()).parent().parent().width();
        var left = event.pageX + TOOLTIP_WIDTH < windowWidth ? event.pageX : windowWidth - TOOLTIP_WIDTH - 10;
        tooltip.html(html)
          .style('left', left + 'px')
          .style('top', (event.pageY + 15) + 'px');
      });

      pill.mouseout(function pillMouseout ( ) {
        tooltip.style('display', 'none');
      });
    } else {
      // a pill with no info of its own gets a title from the label its plugin
      // declares, resolved the way browser-settings.js resolves the same field
      if (typeof translate === 'function') {
        pill.attr('title', toTextContent(translate(plugin.label || plugin.name)));
      }
      pill.off('mouseover');
    }
  };

  pluginBase.addForecastPoints = function addForecastPoints (points, info) {
    _each(points, function eachPoint (point) {
      point.type = 'forecast';
      point.info = info;
      if (point.mgdl < 13) {
        point.color = 'transparent';
      }
    });

    pluginBase.forecastInfos.push(info);
    pluginBase.forecastPoints[info.type] = points;
  };

  return pluginBase;
}

module.exports = init;
