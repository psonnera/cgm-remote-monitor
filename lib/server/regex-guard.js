'use strict';

/* Lightweight guard against ReDoS from user-supplied regular expressions.
 *
 * Two cheap, dependency-free checks:
 *  1. a hard length cap on the pattern string, and
 *  2. a "star height" analysis that rejects nested unbounded repetition
 *     (e.g. (a+)+, (a*)*, (a+){2,}) which is the classic catastrophic
 *     backtracking shape.
 *
 * Legitimate search terms (plain text, simple anchors, single quantifiers)
 * pass unchanged; only pathological patterns are refused.
 */

const MAX_LENGTH = 256;

/**
 * Compute the maximum nesting depth of unbounded repetition in a regex source.
 * A star height > 1 indicates a repetition applied to a sub-expression that
 * itself repeats, the hallmark of exponential backtracking.
 * @param {string} re
 * @returns {number}
 */
function maxStarHeight (re) {
  let i = 0;
  const n = re.length;

  function parseGroup () {
    let maxHeight = 0;
    let lastAtomHeight = 0; // star height of the most recent atom

    while (i < n) {
      const c = re[i];

      if (c === '\\') { // escaped char — single atom
        i += 2;
        lastAtomHeight = 0;
        continue;
      }

      if (c === '[') { // character class — single atom
        i++;
        while (i < n && re[i] !== ']') {
          if (re[i] === '\\') i++;
          i++;
        }
        i++; // skip ']'
        lastAtomHeight = 0;
        continue;
      }

      if (c === '(') {
        i++;
        const innerHeight = parseGroup();
        lastAtomHeight = innerHeight;
        if (innerHeight > maxHeight) maxHeight = innerHeight;
        continue;
      }

      if (c === ')') {
        i++;
        return maxHeight;
      }

      if (c === '*' || c === '+') {
        const h = lastAtomHeight + 1;
        if (h > maxHeight) maxHeight = h;
        lastAtomHeight = h;
        i++;
        continue;
      }

      if (c === '{') {
        const close = re.indexOf('}', i);
        if (close === -1) { i++; lastAtomHeight = 0; continue; }
        const body = re.slice(i + 1, close);
        // treat open-ended quantifiers ({m,}) as unbounded repetition
        if (/^\d*,\s*$/.test(body)) {
          const h = lastAtomHeight + 1;
          if (h > maxHeight) maxHeight = h;
          lastAtomHeight = h;
        } else {
          lastAtomHeight = 0;
        }
        i = close + 1;
        continue;
      }

      // ordinary atom
      i++;
      lastAtomHeight = 0;
    }

    return maxHeight;
  }

  return parseGroup();
}

/**
 * @param {*} pattern
 * @returns {boolean} true when the pattern is short enough and free of nested
 *                    unbounded repetition.
 */
function isSafe (pattern) {
  if (typeof pattern !== 'string') return false;
  if (pattern.length > MAX_LENGTH) return false;
  return maxStarHeight(pattern) <= 1;
}

/**
 * Throws an Error when the pattern is unsafe; otherwise returns it unchanged.
 * @param {string} pattern
 * @returns {string}
 */
function assertSafe (pattern) {
  if (!isSafe(pattern)) {
    throw new Error('Unsafe or overly long regular expression rejected');
  }
  return pattern;
}

module.exports = {
  MAX_LENGTH,
  isSafe,
  assertSafe
};
