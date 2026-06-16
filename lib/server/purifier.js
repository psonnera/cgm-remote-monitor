'use strict';

const createDOMPurify = require('dompurify');
// NOTE: jsdom is required here (not a lighter DOM like linkedom): DOMPurify's
// feature-detection rejects linkedom's window (isSupported is false) and would
// silently pass HTML through unsanitized. jsdom is heavy but stays for safety.
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function init (env, ctx) {

  const purifier = {};

  function iterate (obj) {
    for (var property in obj) {
      if (obj.hasOwnProperty(property)) {
        if (typeof obj[property] == 'object')
          iterate(obj[property]);
        else
        if (isNaN(obj[property])) {
          const clean = DOMPurify.sanitize(obj[property]);
          if (obj[property] !== clean) {
            obj[property] = clean;
          }
        }
      }
    }
  }

  purifier.purifyObject = function purifyObject (obj) {
    return iterate(obj);
  }

  return purifier;

}

module.exports = init;
