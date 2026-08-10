'use strict';

const util = require('util');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
	'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(value) {
	return value.toString(10).padStart(2, '0');
}

function timestamp(date) {
	return `${date.getDate()} ${MONTHS[date.getMonth()]} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function log() {
	console.log(`${timestamp(new Date())} - ${util.format.apply(util, arguments)}`);
}

module.exports = { log, timestamp };
