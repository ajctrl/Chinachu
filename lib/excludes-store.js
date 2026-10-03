'use strict';

const fs = require('node:fs');
const configStore = require('./config-store');

function read(filename, config, io = fs) {
	let rules, revision = null;
	try {
		const text = io.readFileSync(filename, 'utf8');
		rules = JSON.parse(text);
		revision = configStore.revision(text);
	} catch (error) {
		// Only a missing file permits fallback; damaged files must be repaired.
		if (error.code !== 'ENOENT') throw error;
		rules = config.autoExclusionRules === undefined ? [] : config.autoExclusionRules;
	}
	if (!Array.isArray(rules) || !rules.every(rule => rule && typeof rule === 'object' && !Array.isArray(rule))) {
		throw new Error('共通除外ルールはJSONオブジェクトの配列にしてください。');
	}
	return { rules, revision };
}

function save(filename, rules, expectedRevision, configFile) {
	const text = JSON.stringify(rules, null, '  ');
	return expectedRevision === null ? configStore.create(filename, text, configFile) :
		configStore.save(filename, text, expectedRevision);
}

module.exports = { read, save };
