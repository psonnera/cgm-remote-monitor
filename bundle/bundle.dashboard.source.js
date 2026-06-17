// Lean entry for the main dashboard (index.html). It includes only what the
// live client needs — NOT the food/profile/report editors or admin plugins,
// which live on their own pages and stay in bundle.app.js. lib/client is
// independent of those modules, so the dashboard ships less code.
import '../static/css/drawer.css';
import '../static/css/dropdown.css';
import '../static/css/sgv.css';

$ = require("jquery");

require('jquery-ui-bundle');

window._ = require('lodash');
window.d3 = require('d3');

require('jquery.tooltips');

window.Storage = require('js-storage');

// NOTE: flot is intentionally omitted here — only the report plugins use it.

const moment = require('moment-timezone');

window.moment = moment;

window.Nightscout = window.Nightscout || {};

window.Nightscout = {
    client: require('../lib/client'),
    units: require('../lib/units')()
};

console.info('Nightscout dashboard bundle ready');

// Needed for Hot Module Replacement
if(typeof(module.hot) !== 'undefined') {
    module.hot.accept()
}
