(function () {
	// Always merge into the current file, not the WUI's startup config snapshot.
	var settings;
	try {
		settings = JSON.parse(fs.readFileSync(define.CONFIG_FILE, 'utf8'));
	} catch (error) {
		return response.error(500);
	}
	var rules = settings.autoExclusionRules || [];
	if (!Array.isArray(rules)) return response.error(500);
	var hasNum = typeof request.param.num !== 'undefined';
	var num = Number(request.param.num);
	if (hasNum && (!/^\d+$/.test(request.param.num) || !Number.isSafeInteger(num) || !rules[num])) {
		return response.error(404);
	}
	if (request.method === 'GET') {
		response.head(200);
		return response.end(JSON.stringify(hasNum ? rules[num] : rules, null, '  '));
	}

	var rule;
	if (request.method === 'POST' || request.method === 'PUT') {
		if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return response.error(400);
		rule = request.query;
		if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).length === 0) return response.error(400);
		// Reject malformed conditions and regular expressions before they reach the scheduler.
		var arrays = ['types', 'categories', 'channels', 'ignore_channels', 'reserve_flags', 'ignore_flags',
			'reserve_titles', 'ignore_titles', 'reserve_descriptions', 'ignore_descriptions'];
		for (var i = 0; i < arrays.length; i++) {
			var key = arrays[i];
			if (typeof rule[key] === 'undefined') continue;
			if (!Array.isArray(rule[key]) || !rule[key].every(function (value) { return typeof value === 'string'; })) return response.error(400);
			if (/titles$|descriptions$/.test(key)) {
				try {
					rule[key].forEach(function (value) { new RegExp(settings.normalizationForm ? value.normalize(settings.normalizationForm) : value); });
				} catch (error) { return response.error(400); }
			}
		}
		for (var field of ['hour', 'duration']) {
			if (typeof rule[field] === 'undefined') continue;
			if (!rule[field] || typeof rule[field] !== 'object' || Array.isArray(rule[field]) ||
				!Object.keys(rule[field]).every(function (key) { return typeof rule[field][key] === 'number' && Number.isFinite(rule[field][key]); })) return response.error(400);
		}
		if (typeof rule.sid !== 'undefined' && !Number.isSafeInteger(rule.sid)) return response.error(400);
		if (typeof rule.category !== 'undefined' && typeof rule.category !== 'string') return response.error(400);
		for (var flag of ['isEnabled', 'isDisabled']) {
			if (typeof rule[flag] !== 'undefined' && typeof rule[flag] !== 'boolean') return response.error(400);
		}
		if (typeof rule.isEnabled === 'boolean') rule.isDisabled = !rule.isEnabled;
		delete rule.isEnabled;
		if (request.method === 'POST') rules.push(rule);
		else rules[num] = rule;
	} else if (request.method === 'DELETE') {
		rules.splice(num, 1);
	} else {
		return response.error(405);
	}
	settings.autoExclusionRules = rules;
	try {
		fs.writeFileSync(define.CONFIG_FILE, JSON.stringify(settings, null, '  '));
	} catch (error) {
		return response.error(500);
	}
	response.head(request.method === 'POST' ? 201 : 200);
	response.end(JSON.stringify(rule || {}));
})();
