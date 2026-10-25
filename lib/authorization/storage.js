'use strict';

var _ = require('lodash');
var crypto = require('crypto');
var shiroTrie = require('shiro-trie');
var ObjectId = require('mongodb').ObjectId;
var toObjectId = require('../server/objectid');
var idForms = require('../server/object-id-forms');

var find_options = require('../server/query');
var countParam = require('../server/count');

function init (env, ctx) {
  var storage = { };

  var rolesCollection = ctx.store.collection(env.authentication_collections_prefix + 'roles');
  var subjectsCollection = ctx.store.collection(env.authentication_collections_prefix + 'subjects');

  storage.queryOpts = {
    dateField: 'created_at'
    , noDateFilter: true
  };

  function query_for (opts) {
    return find_options(opts, storage.queryOpts);
  }

  // The fields a stored document owns.
  //
  // A subject's accessToken, accessTokenDigest and digest are not in this list
  // on purpose. reload() derives all three from the subject's _id, its name and
  // the enclave key, and they have to stay derived: a database that does not
  // contain the token is a database an attacker cannot mint one from. Writing
  // whatever the request body contained put the token on disk, because
  // GET /subjects serves it to the admin UI and the edit dialog sends the whole
  // object back.
  var SUBJECT_FIELDS = ['name', 'roles', 'notes', 'created_at'];
  var ROLE_FIELDS = ['name', 'permissions', 'notes', 'created_at'];

  // A subject's derived fields, which reload() recomputes on every load. Listed
  // here so a document that already has them stored -- written by a version of
  // this file that replaced the document wholesale -- cannot supply them.
  var DERIVED_SUBJECT_FIELDS = ['accessToken', 'accessTokenDigest', 'digest'];

  // reload() derives a subject's access token from its name and sorts the roles
  // by name, so a row whose name is not a string cannot be loaded. A write
  // without a usable name is refused with this error; a row already stored
  // without one is skipped when loading (see loadable()).
  storage.NAME_REQUIRED = 'A name is required';

  function hasUsableName (doc) {
    return typeof doc.name === 'string' && doc.name.trim() !== '';
  }

  function loadable (kind) {
    return function hasStringName (doc) {
      if (doc && typeof doc.name === 'string') {
        return true;
      }
      console.log('Skipping an authorization ' + kind + ' stored without a name', doc && String(doc._id));
      return false;
    };
  }

  function ownedFields (obj, fields) {
    var doc = { };
    fields.forEach(function eachField (field) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, field)) {
        doc[field] = obj[field];
      }
    });
    return doc;
  }

  // A save replaces the whole stored document, so a field the request did not
  // carry would be dropped. For notes and created_at, leaving a field out
  // means "unchanged", not "remove it": the admin page does not fetch a
  // subject's created_at and never sends it, and a tool that only changes a
  // subject's roles has no reason to send either one. A caller who wants the
  // notes gone sends notes: '' and gets that.
  //
  // This is deliberately not every owned field. The admin page form-encodes
  // its request, and form encoding leaves an empty list out entirely, so the
  // request that removes a subject's last role (or a role's last permission)
  // carries no roles field at all. Filling roles or permissions in from the
  // stored document would quietly keep access the operator had just removed.
  function keepStoredFields (collection, doc) {
    var keepNotes = !Object.prototype.hasOwnProperty.call(doc, 'notes');
    var keepCreatedAt = !doc.created_at;
    if (!keepNotes && !keepCreatedAt) {
      return Promise.resolve();
    }

    return collection.findOne({ _id: doc._id }, { projection: { notes: 1, created_at: 1 } })
      .then(function merge (stored) {
        if (!stored) { return; }
        if (keepNotes && Object.prototype.hasOwnProperty.call(stored, 'notes')) {
          doc.notes = stored.notes;
        }
        if (keepCreatedAt && stored.created_at) {
          doc.created_at = stored.created_at;
        }
      });
  }

  function create (collection, fields) {
    function doCreate(obj, fn) {
      var doc = ownedFields(obj, fields);

      if (!Object.prototype.hasOwnProperty.call(doc, 'created_at')) {
        doc.created_at = (new Date()).toISOString();
      }
      if (!hasUsableName(doc)) {
        return fn(storage.NAME_REQUIRED, null);
      }
      collection.insertOne(doc).then(function (result) {
        storage.reload(function loaded() {
          fn(null, [doc]);
        });
      }).catch(function (err) {
        console.log('Data insertion error', err.message);
        fn(err.message, null);
      });
    }
    return doCreate;
  }

  function list (collection) {
    function doList(opts, fn) {
      // these functions, find, sort, and limit, are used to
      // dynamically configure the request, based on the options we've
      // been given

      // determine sort options
      function sort() {
        return opts && opts.sort || {date: -1};
      }

      // configure the limit portion of the current query
      function limit() {
        return countParam.applyCount(this, opts);
      }

      // now just stitch them all together
      limit.call(collection
          .find(query_for(opts))
          .sort(sort())
      ).toArray().then(function (entries) { fn(null, entries); }).catch(fn);
    }

    return doList;
  }

  function remove (collection) {
    function doRemove (_id, callback) {
      var objId = toObjectId(_id);
      if (!objId) { return callback('Invalid id', null); }
      // Either form: up to 15.0.8 create stored a client's 24-hex _id as
      // the string. Create now keeps only the owned fields, so a client
      // _id is not stored at all, but those records remain.
      collection.deleteMany({ '_id': idForms.idFilter(_id) }).then(function () {
        storage.reload(function loaded() {
          callback(null, null);
        });
      }).catch(function (err) {
        storage.reload(function loaded() {
          callback(err, null);
        });
      });
    }
    return doRemove;
  }

  function save (collection, fields) {
    function doSave (obj, callback) {
      var doc = ownedFields(obj, fields);
      if (obj == null || obj._id == null) {
        doc._id = new ObjectId();
      } else {
        var objId = toObjectId(obj._id);
        if (!objId) { return callback('Invalid id', obj); }
        doc._id = objId;
      }
      if (!hasUsableName(doc)) {
        return callback(storage.NAME_REQUIRED, null);
      }
      keepStoredFields(collection, doc).then(function () {
        if (!doc.created_at) {
          doc.created_at = (new Date()).toISOString();
        }
        return collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
      }).then(function (result) {
        //id should be added for new docs
        storage.reload(function loaded() {
          callback(null, doc);
        });
      }).catch(function (err) {
        storage.reload(function loaded() {
          callback(err, doc);
        });
      });
    }
    return doSave;
  }

  storage.createSubject = create(subjectsCollection, SUBJECT_FIELDS);
  storage.saveSubject = save(subjectsCollection, SUBJECT_FIELDS);
  storage.removeSubject = remove(subjectsCollection);
  storage.listSubjects = list(subjectsCollection);

  storage.createRole = create(rolesCollection, ROLE_FIELDS);
  storage.saveRole = save(rolesCollection, ROLE_FIELDS);
  storage.removeRole = remove(rolesCollection);
  storage.listRoles = list(rolesCollection);

  storage.defaultRoles = [
    { name: 'admin', permissions: ['*'] }
    , { name: 'denied', permissions: [ ] }
    , { name: 'status-only', permissions: [ 'api:status:read' ] }
    , { name: 'readable', permissions: [ '*:*:read' ] }
    , { name: 'careportal', permissions: [ 'api:treatments:create' ] }
    , { name: 'devicestatus-upload', permissions: [ 'api:devicestatus:create' ] }
    , { name: 'activity', permissions: [ 'api:activity:create' ] }
  ];

  storage.ensureIndexes = function ensureIndexes() {
    ctx.store.ensureIndexes(rolesCollection, ['name']);
    ctx.store.ensureIndexes(subjectsCollection, ['name']);
  }

  storage.getSHA1 = function getSHA1 (message) {
    var shasum = crypto.createHash('sha1');
    shasum.update(message);
    return shasum.digest('hex');
  }

  storage.reload = function reload (callback) {

    storage.listRoles({sort: {name: 1}}, function listResults (err, results) {
      if (err) {
        return callback && callback(err);
      }

      storage.roles = (results || [ ]).filter(loadable('role'));

      _.forEach(storage.defaultRoles, function eachRole (role) {
        if (_.isEmpty(_.find(storage.roles, {name: role.name}))) {
          storage.roles.push(role);
        }
      });

      storage.roles = _.sortBy(storage.roles, 'name');

      storage.listSubjects({sort: {name: 1}}, function listResults (err, results) {
        if (err) {
          return callback && callback(err);
        }

        storage.subjects = _.map((results || [ ]).filter(loadable('subject')), function eachSubject (subject) {
          // Drop anything a stored document is carrying under a derived name
          // before deriving it, so a row written before these fields were kept
          // out of the collection cannot supply one of them.
          DERIVED_SUBJECT_FIELDS.forEach(function eachField (field) {
            delete subject[field];
          });

          if (env.enclave.isApiKeySet()) {
            subject.digest = env.enclave.getSubjectHash(subject._id.toString());
            var abbrev = subject.name.toLowerCase().replace(/[\W]/g, '').substring(0, 10);
            subject.accessToken = abbrev + '-' + subject.digest.substring(0, 16);
            subject.accessTokenDigest = storage.getSHA1(subject.accessToken);
          }

          return subject;
        });

        if (callback) {
          callback( );
        }
      });
    });

  };

  storage.findRole = function findRole (roleName) {
    return _.find(storage.roles, {name: roleName});
  };

  storage.roleToShiro = function roleToShiro (roleName) {
    var shiro = null;

    var role = storage.findRole(roleName);
    if (role) {
      shiro = shiroTrie.new();
      shiro.add(role.permissions);
    }

    return shiro;
  };

  storage.rolesToShiros = function roleToShiro (roleNames) {
    return _.chain(roleNames)
      .map(storage.roleToShiro)
      .reject(_.isEmpty)
      .value();
  };

  storage.roleToPermissions = function roleToPermissions (roleName) {
    var permissions = [ ];

    var role = storage.findRole(roleName);
    if (role) {
      permissions = role.permissions;
    }

    return permissions;
  };

  storage.findSubject = function findSubject (accessToken) {

    if (!accessToken) return null;

    function checkToken(accessToken) {
      var split_token = accessToken.split('-');
      var prefix = split_token ? _.last(split_token) : '';

      if (prefix.length < 16) {
        return null;
      }

      return _.find(storage.subjects, function matches (subject) {
        return subject.accessTokenDigest.indexOf(accessToken) === 0 || subject.digest.indexOf(prefix) === 0;
      });
   }

   if (!Array.isArray(accessToken)) accessToken = [accessToken];

   for (let i=0; i < accessToken.length; i++) {
     const subject = checkToken(accessToken[i]);
     if (subject) return subject;
   }

   return null;
  };

  storage.doesAccessTokenExist = function doesAccessTokenExist(accessToken) {
    if (storage.findSubject(accessToken)) {
      return true;
    }
    return false;
  }

  storage.resolveSubjectAndPermissions = function resolveSubjectAndPermissions (accessToken) {
    var shiros = [];

    var subject = storage.findSubject(accessToken);
    if (subject) {
      shiros = storage.rolesToShiros(subject.roles);
    }

    return {
      subject: subject
      , shiros: shiros
    };
  };

  return storage;

}

module.exports = init;
