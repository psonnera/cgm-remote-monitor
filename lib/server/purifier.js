'use strict';

/**
 * lib/server/purifier.js
 *
 * Server-side scrubber applied to free-text fields on inbound writes
 * (treatments, profiles, devicestatus, entries, food, activity) before
 * they are persisted.
 *
 * Implementation: sanitize-html (pure JS, no DOM dependency).
 *
 * Previously this module loaded `dompurify` and instantiated a full `jsdom`
 * window per process purely to give DOMPurify a DOM to operate on. jsdom is
 * a complete browser polyfill and every CVE in any of its subsystems became
 * a runtime CVE here. Nightscout's need is "strip dangerous markup from user
 * strings"; sanitize-html does exactly that with a pure-JS tokenizer and no
 * JS execution surface. (linkedom was tried earlier and rejected: DOMPurify
 * refuses its window and silently passes HTML through.)
 *
 * This sanitizer is NOT the sole barrier: client renderers escape free-text
 * fields before inserting them with .html(), and report tables use .text().
 */

const sanitizeHtml = require('sanitize-html');
const { decodeHTML } = require('entities/decode');

// sanitize-html builds a serialized copy of its input and can temporarily use
// considerably more memory than the source string. Nightscout text fields are
// normally tiny, so bound only strings that actually contain a possible HTML
// token. Large plain-text values retain the API's existing behavior without
// paying the parser's allocation cost.
const MAX_SANITIZED_STRING_LENGTH = 64 * 1024;
const POSSIBLE_HTML_MARKUP = /<[!/?A-Za-z]/;
// Keep hostile but valid JSON from turning the sanitizer itself into a heap
// exhaustion primitive. These limits are far above real Nightscout documents
// (including full profile stores) while still bounding traversal state.
const MAX_TRAVERSED_OBJECTS = 10 * 1024;
const MAX_TRAVERSED_PROPERTIES = 50 * 1024;
const MAX_TRAVERSED_DEPTH = 1024;

// sanitize-html defaults: a curated allow-list of inert formatting tags and
// http/https/mailto/tel/ftp URL schemes. Matches DOMPurify's default posture
// (strip scripts/handlers/dangerous URLs, keep safe formatting) without a DOM.
const SANITIZE_OPTIONS = {
  // `img` is added because DOMPurify preserved the <img> shell while stripping
  // dangerous src/onerror attributes, and existing notes in the wild may carry
  // inline images. javascript:/vbscript:/data: schemes are still rejected via
  // allowedSchemes and event handlers are dropped (not in allowedAttributes).
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
  allowedAttributes: sanitizeHtml.defaults.allowedAttributes,
  allowedSchemes: sanitizeHtml.defaults.allowedSchemes,
  allowedSchemesByTag: sanitizeHtml.defaults.allowedSchemesByTag,
  // Disallowed-tag bodies are dropped entirely: '<script>alert(1)</script>safe' -> 'safe'.
  disallowedTagsMode: 'discard'
};

function sanitizeStringWithBudget (s, budget) {
  // In the HTML data state a tag can only start with "<" followed by an ASCII
  // letter, !, /, or (conservatively) ?. Plain text such as "BG < 70" is left
  // untouched, and character references that decode to "<" are text.
  if (!POSSIBLE_HTML_MARKUP.test(s)) return s;

  if (s.length > budget.remaining) {
    throw new RangeError('HTML-containing text field exceeds the sanitization limit');
  }
  budget.remaining -= s.length;

  const clean = sanitizeHtml(s, SANITIZE_OPTIONS);

  // sanitize-html serializes harmless text characters as entities. Keep the
  // original value when decoding shows that sanitization did not remove or
  // rewrite anything, so identifiers and profile names are never corrupted.
  return decodeHTML(clean) === decodeHTML(s) ? s : clean;
}

function sanitizeString (s) {
  return sanitizeStringWithBudget(s, { remaining: MAX_SANITIZED_STRING_LENGTH });
}

// Object.keys() creates a complete key array before a complexity limit can be
// checked. Iterating own enumerable keys lazily lets us reject very wide input
// without retaining another request-sized allocation.
function * ownEnumerableKeys (node) {
  for (const key in node) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      yield key;
    }
  }
}

/**
 * Walks the object and rewrites any string-valued leaves with their sanitized
 * form. Mutates in place AND returns the input.
 *
 * Hardening over the previous implementation:
 *   - Object.prototype.hasOwnProperty.call (Object.create(null) inputs no longer throw)
 *   - no isNaN() heuristic that mis-classified booleans / null / undefined
 *   - arrays are walked explicitly so numeric-indexed string leaves are scrubbed
 *   - cycle detection, and traversal state kept on the heap (no stack overflow)
 *   - Date / Buffer / typed-array leaves are skipped
 */
function purifyObject (root) {
  const seen = new WeakSet();
  const stack = [];
  // Bound aggregate parser work as well as individual fields, otherwise a
  // large request could split markup across many individually small strings.
  const sanitizeBudget = { remaining: MAX_SANITIZED_STRING_LENGTH };
  const traversalBudget = { objects: 0, properties: 0 };

  function enter (node) {
    if (node === null || typeof node !== 'object') return false;
    if (seen.has(node)) return false;
    if (node instanceof Date) return false;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(node)) return false;
    if (ArrayBuffer.isView(node)) return false;
    seen.add(node);

    traversalBudget.objects += 1;
    if (traversalBudget.objects > MAX_TRAVERSED_OBJECTS || stack.length >= MAX_TRAVERSED_DEPTH) {
      throw new RangeError('Object exceeds the sanitization complexity limit');
    }

    stack.push({ node: node, keys: ownEnumerableKeys(node) });
    return true;
  }

  enter(root);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const next = frame.keys.next();

    if (next.done) {
      stack.pop();
      continue;
    }

    traversalBudget.properties += 1;
    if (traversalBudget.properties > MAX_TRAVERSED_PROPERTIES) {
      throw new RangeError('Object exceeds the sanitization complexity limit');
    }

    const key = next.value;
    const value = frame.node[key];
    if (typeof value === 'string') {
      const clean = sanitizeStringWithBudget(value, sanitizeBudget);
      if (clean !== value) frame.node[key] = clean;
    } else if (value && typeof value === 'object') {
      enter(value);
    }
  }

  return root;
}

function init () {
  return {
    purifyObject: purifyObject
    , sanitizeString: sanitizeString
  };
}

module.exports = init;
