"use strict";

var os     = require('os');
var fs     = require('fs');
var should = require('should');

var chinachu = require('chinachu-common');

var testDataPath = os.tmpdir() + '/chinachu-test-' + new Date().getTime() + '.json';
var watcher = null;
var onUpdate = function() {};

describe('(init)', function() {
	
	var testData = {
		a: 0,
		b: 1,
		c: '',
		d: 'string',
		e: null,
		f: {},
		g: { a: 0, b: 1, c: '', d: 'string', e: null, f: {}, h: [] },
		h: [],
		i: [ 0, 1, '', 'string', null, {}, [], , ]
	};
	
	it('create test data file', function() {
		fs.writeFileSync(testDataPath, JSON.stringify(testData));
	});
});

describe('jsonWatcher', function() {
	
	var test = null;
	
	it('read', function(done) {
		onUpdate = function(err, data) {
			onUpdate = function() {};
			should.strictEqual(null, err);
			test = data;
			should.exist(test);
			done();
		};

		watcher = chinachu.jsonWatcher(testDataPath, function(err, data, msg) {
			onUpdate(err, data, msg);
		}, { now: true });
	});
	
	it('validate', function() {
		
		should.strictEqual(test.a, 0);
		should.strictEqual(test.b, 1);
		should.strictEqual(test.c, '');
		should.strictEqual(test.d, 'string');
		should.strictEqual(test.e, null);
	});
	
	it('watch', function(done) {
		onUpdate = function(err, data) {
			onUpdate = function() {};
			should.strictEqual(null, err);
			should.strictEqual(data.a, 2);
			done();
		};
		fs.writeFileSync(testDataPath, JSON.stringify({ a: 2 }));
	});
});

describe('(clean up)', function() {
	
	it('remove test data file', function() {
		watcher.close();
		fs.unlinkSync(testDataPath);
	});
});