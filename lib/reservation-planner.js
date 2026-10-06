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
	program.excludedChannels = [];
	if (program.isManualReserved) {
		if (sameReservation(previous, program) && previous.isManualReserved && previous.isSkip && !previous.isAutoSkip) {
			program.isSkip = true;
		}
		return;
	}

	const match = chinachu.getProgramMatchInfo(rules, program, nf);
	program.isExcluded = match.isMatched;
	program.excludedKeywords = match.keywords;
	program.excludedChannels = match.channels;
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

// Resolve each simultaneous broadcast as a group. First suppress automatic
// alternatives to a manual skip, then choose among the remaining candidates.
// A candidate that will be suppressed must never eliminate a manual reservation.
exports.markDuplicates = function (programs) {
	const groups = new Map();
	programs.forEach(program => {
		delete program.isDuplicate;
		const key = JSON.stringify([
			program.channel.type, program.channel.channel, program.start, program.end, program.title
		]);
		if (!groups.has(key)) { groups.set(key, []); }
		groups.get(key).push(program);
	});

	groups.forEach(group => {
		const hasManualSkip = group.some(program => program.isSkip && !program.isAutoSkip);
		const eligible = group.filter(program => !program.isSkip &&
			(!hasManualSkip || program.isManualReserved || program.autoSkipOverride));
		const overrides = eligible.filter(program => program.autoSkipOverride);
		eligible.sort((a, b) => {
			const aSid = parseInt(a.channel.sid, 10), bSid = parseInt(b.channel.sid, 10);
			const difference = (Number.isNaN(aSid) ? Infinity : aSid) - (Number.isNaN(bSid) ? Infinity : bSid);
			if (difference) { return difference; }
			// Stable selection even when services have equal or missing SIDs.
			return String(a.id).localeCompare(String(b.id), 'en');
		});
		const winners = new Set(overrides.length ? overrides : eligible.slice(0, 1));
		group.forEach(program => {
			if (!program.isSkip && !winners.has(program)) { program.isDuplicate = true; }
		});
	});
	return programs.filter(program => program.isDuplicate).length;
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
