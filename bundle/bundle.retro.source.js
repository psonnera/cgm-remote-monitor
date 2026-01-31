import '../static/css/drawer.css';
import '../static/css/dropdown.css';
import '../static/css/sgv.css';

$ = require("jquery");

require('jquery-ui-bundle');

window._ = require('lodash');
window.d3 = require('d3');

require('jquery.tooltips');

window.Storage = require('js-storage');

require('flot');
require('../node_modules/flot/jquery.flot.time');
require('../node_modules/flot/jquery.flot.pie');
require('../node_modules/flot/jquery.flot.fillbetween');

const moment = require('moment-timezone');

window.moment = moment;

window.Nightscout = window.Nightscout || {};

var ctx = {
    moment: moment
};

window.Nightscout = {
    retro: require('../lib/client/retro'),
    units: require('../lib/units')()
};

console.info('Nightscout retro bundle ready');

// Needed for Hot Module Replacement
if(typeof(module.hot) !== 'undefined') {
    module.hot.accept()
}
