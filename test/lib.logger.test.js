'use strict';

const assert = require('node:assert/strict');
const { timestamp } = require('../lib/logger');

describe('logger', function() {
	it('formats the legacy timestamp consistently', function() {
		assert.equal(timestamp(new Date(2026, 7, 1, 3, 4, 5)), '1 Aug 03:04:05');
	});
});
