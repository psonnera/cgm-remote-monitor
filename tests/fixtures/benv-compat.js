/**
 * benv compatibility shim for modern jsdom
 * Provides the same API as benv but uses jsdom 28.x
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let dom = null;
let window = null;

const benv = {
  setup: function(callback) {
    // Create a minimal DOM
    const html = '<!DOCTYPE html><html><head></head><body></body></html>';
    
    dom = new JSDOM(html, {
      url: 'http://localhost',
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true
    });
    
    window = dom.window;
    global.window = window;
    global.document = window.document;
    global.navigator = window.navigator;
    
    // Make commonly used globals available
    global.$ = global.jQuery = undefined; // Will be set by bundle
    
    if (callback) {
      callback();
    }
  },
  
  require: function(modulePath) {
    // Clear module cache for this file to force fresh load
    delete require.cache[path.resolve(modulePath)];
    
    // Execute the bundle in the jsdom context
    const code = fs.readFileSync(modulePath, 'utf8');
    const script = new window.Function(code);
    script.call(window);
    
    // Export globals that the bundle creates
    if (window.$) {
      global.$ = window.$;
      global.jQuery = window.jQuery;
    }
    
    return window;
  },
  
  teardown: function(leak) {
    if (!leak) {
      delete global.window;
      delete global.document;
      delete global.navigator;
      delete global.$;
      delete global.jQuery;
    }
    if (dom && dom.window) {
      dom.window.close();
    }
    dom = null;
    window = null;
  },
  
  expose: function(obj, name) {
    if (name) {
      global[name] = obj;
    }
  }
};

module.exports = benv;
