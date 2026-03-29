
'use strict';

var should = require('should');
var inithelper = require('./inithelper')();


describe('ddata', function ( ) {
  // var sandbox = require('../lib/sandbox')();
  // var env = require('../lib/server/env')();
  var ctx = {};
  ctx.ddata = require('../lib/data/ddata')();

  it('should be a module', function (done) {
    var libddata = require('../lib/data/ddata');
    var ddata = libddata( );
    should.exist(ddata);
    should.exist(libddata);
    should.exist(libddata.call);
    ddata = ctx.ddata.clone( );
    should.exist(ddata);
    done( );
  });

  it('has #clone( )', function (done) {
    should.exist(ctx.ddata.treatments);
    should.exist(ctx.ddata.sgvs);
    should.exist(ctx.ddata.mbgs);
    should.exist(ctx.ddata.cals);
    should.exist(ctx.ddata.profiles);
    should.exist(ctx.ddata.devicestatus);
    should.exist(ctx.ddata.lastUpdated);
    var ddata = ctx.ddata.clone( );
    should.exist(ddata);
    should.exist(ddata.treatments);
    should.exist(ddata.sgvs);
    should.exist(ddata.mbgs);
    should.exist(ddata.cals);
    should.exist(ddata.profiles);
    should.exist(ddata.devicestatus);
    should.exist(ddata.lastUpdated);
    done( );
  });

  // TODO: ensure partition function gets called via:
  // Properties
  // * ddata.devicestatus
  // * ddata.mbgs
  // * ddata.sgvs
  // * ddata.treatments
  // * ddata.profiles
  // * ddata.lastUpdated
  // Methods
  // * ddata.processTreatments
  // * ddata.processDurations
  // * ddata.clone
  // * ddata.split

  it('should synthesize an AAPS restore note into a profile switch treatment', function (done) {
    var ddata = require('../lib/data/ddata')();

    ddata.treatments = ddata.processRawDataForRuntime([
      {
        _id: 'profile-switch-start'
        , eventType: 'Profile Switch'
        , profile: 'Normal (125%)'
        , originalProfileName: 'Normal'
        , percentage: 125
        , duration: 30
        , created_at: '2026-03-29T13:10:19.000Z'
      }
      , {
        _id: 'profile-switch-end-note'
        , eventType: 'Note'
        , notes: 'Normal'
        , originalCustomizedName: 'Normal'
        , originalDuration: 0
        , originalEnd: 1774791619000
        , originalPercentage: 100
        , originalProfileName: 'Normal'
        , originalTimeshift: 0
        , profileJson: '{"units":"mg/dl"}'
        , created_at: '2026-03-29T13:40:30.086Z'
      }
    ]);

    ddata.processTreatments(true);

    ddata.profileTreatments.should.have.length(2);
    ddata.profileTreatments[1].eventType.should.equal('Profile Switch');
    ddata.profileTreatments[1].profile.should.equal('Normal');
    ddata.profileTreatments[1].syntheticAapsProfileRestore.should.equal(true);
    ddata.profileTreatments[1].duration.should.equal(0);
    done();
  });
 

});

