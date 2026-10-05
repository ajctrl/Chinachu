'use strict';

const fs = require('node:fs');
const path = require('node:path');
const excludesStore = require('./excludes-store');

function watchExclusionRules(excludesFile, configFile, onChange, onError = console.error, wait = 100) {
	let previous, timer;
	const names = new Set([path.basename(excludesFile), path.basename(configFile)]);
	function check(notify) {
		try {
			const settings = JSON.parse(fs.readFileSync(configFile, 'utf8'));
			const rules = excludesStore.read(excludesFile, settings).rules;
			const current = JSON.stringify(rules);
			const changed = current !== previous;
			previous = current;
			if (notify && changed) onChange();
		} catch (error) {
			onError(error);
		}
	}
	// Watch the directory so initial creation and subsequent atomic replacements
	// keep working. Do not create excludes.json: missing files use legacy settings.
	const watcher = fs.watch(path.dirname(excludesFile), (event, filename) => {
		if (filename != null && !names.has(String(filename))) return;
		clearTimeout(timer);
		timer = setTimeout(() => check(true), wait);
	});
	watcher.on('error', onError);
	watcher.once('close', () => clearTimeout(timer));
	check(false);
	return watcher;
}

module.exports = { watchExclusionRules };
