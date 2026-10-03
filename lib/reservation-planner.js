'use strict';

const chinachu = require('chinachu-common');

// Keep pending reservations through time changes, but do not revive expired
// state when a broadcaster reuses an event ID for a later airing.
function sameReservation(previous, program) {
	return previous && previous.id === program.id &&
		(previous.end > Date.now() ||
			(previous.start < program.end && program.start < previous.end));
}

function applyExclusion(program, previous, rules, nf) {
	delete program.isSkip;
	delete program.isAutoSkip;
	delete program.autoSkipOverride;
	delete program.isExcluded;
	program.excludedKeywords = [];
	if (program.isManualReserved) {
		if (sameReservation(previous, program) && previous.isManualReserved && previous.isSkip && !previous.isAutoSkip) {
			program.isSkip = true;
		}
		return;
	}

	const match = chinachu.getProgramMatchInfo(rules, program, nf);
	program.isExcluded = match.isMatched;
	program.excludedKeywords = match.keywords;
	if (sameReservation(previous, program)) {
		if (previous.autoSkipOverride) { program.autoSkipOverride = true; }
		// Legacy isSkip values are manual skips and must remain manual.
		if (previous.isSkip && !previous.isAutoSkip) { program.isSkip = true; }
	}
	if (match.isMatched && !program.autoSkipOverride && !program.isSkip) {
		program.isSkip = true;
		program.isAutoSkip = true;
	}
}

exports.buildCandidates = function (schedule, rules, previousReserves, config, excludes = []) {
	const candidates = new Map();
	const previousById = new Map(previousReserves.map(program => [program.id, program]));
	const scheduledById = new Map();
	schedule.forEach(channel => channel.programs.forEach(program => {
		scheduledById.set(program.id, program);
		const match = chinachu.getProgramMatchInfo(rules, program, config.normalizationForm);
		if (match.isMatched) {
			candidates.set(program.id, Object.assign({}, program, { matchedKeywords: match.keywords }));
		}
	}));

	previousReserves.forEach(previous => {
		if (!previous.isManualReserved || previous.start + 86400000 <= Date.now()) { return; }
		const scheduled = scheduledById.get(previous.id);
		// Keep manual reservations manual even when a recording rule also matches.
		if (scheduled && !sameReservation(previous, scheduled)) { return; }
		const program = Object.assign({}, scheduled || previous, {
			isManualReserved: true,
			matchedKeywords: []
		});
		if (previous['1seg'] === true) { program['1seg'] = true; }
		candidates.set(program.id, program);
	});

	const matches = Array.from(candidates.values());
	matches.forEach(program => {
		delete program.isDuplicate;
		delete program.isConflict;
		applyExclusion(program, previousById.get(program.id), excludes, config.normalizationForm);
	});
	return matches;
};

exports.skip = function (program) {
	const wasOverridden = program.autoSkipOverride;
	delete program.autoSkipOverride;
	delete program.isAutoSkip;
	if (wasOverridden) {
		// Re-skipping an override hands control back to automatic exclusion.
		delete program.isSkip;
		if (program.isExcluded) {
			program.isSkip = true;
			program.isAutoSkip = true;
		}
	} else {
		program.isSkip = true;
	}
};

exports.unskip = function (program) {
	if (program.isAutoSkip || program.isExcluded) { program.autoSkipOverride = true; }
	delete program.isSkip;
	delete program.isAutoSkip;
};
