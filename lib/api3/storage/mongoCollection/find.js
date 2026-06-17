'use strict';

const utils = require('./utils')
  , _ = require('lodash')
  ;


/**
 * Find single document by identifier
 * @param {Object} col
 * @param {string} identifier
 * @param {Object} projection
 * @param {Object} options
 */
function findOne (col, identifier, projection, options) {

  const filter = utils.filterForOne(identifier);

  return col.find(filter)
    .project(projection)
    .sort({ identifier: -1 }) // document with identifier first (not the fallback one)
    .toArray()
    .then(function mongoDone (result) {
      if (!options || options.normalize !== false) {
        _.each(result, utils.normalizeDoc);
      }
      return result;
    });
}


/**
 * Find single document by query filter
 * @param {Object} col
 * @param {Object} filter specific filter
 * @param {Object} projection
 * @param {Object} options
 */
function findOneFilter (col, filter, projection, options) {

  return col.find(filter)
    .project(projection)
    .sort({ identifier: -1 }) // document with identifier first (not the fallback one)
    .toArray()
    .then(function mongoDone (result) {
      if (!options || options.normalize !== false) {
        _.each(result, utils.normalizeDoc);
      }
      return result;
    });
}


/**
 * Find many documents matching the filtering criteria
 */
function findMany (col, args) {
  const logicalOperator = args.logicalOperator || 'and';

  const filter = utils.parseFilter(args.filter, logicalOperator, args.onlyValid);

  return col.find(filter)
    .sort(args.sort)
    .limit(args.limit)
    .skip(args.skip)
    .project(args.projection)
    .toArray()
    .then(function mongoDone (result) {
      if (!args.options || args.options.normalize !== false) {
        _.each(result, utils.normalizeDoc);
      }
      return result;
    });
}


module.exports = {
  findOne,
  findOneFilter,
  findMany
};
