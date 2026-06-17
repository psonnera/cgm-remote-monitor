'use strict';

var mongodb = require('mongodb');
var env = require('./../env')();

var util = require('./util');

main();

function main() {
  var MongoClient = mongodb.MongoClient;

  console.log('Connecting to mongo...');
  MongoClient.connect(env.storageURI, {}).then(function connected(client) {

    var db = client.db();

    return populate_collection(db);
  }).catch(function (err) {
    console.log('Error occurred: ', err);
    throw err;
  });
}

function populate_collection(db) {
  var cgm_collection = db.collection(env.entries_collection);
  var new_cgm_record = util.get_cgm_record();

  return cgm_collection.insertOne(new_cgm_record).then(function () {
    process.exit(0);
  });
}
