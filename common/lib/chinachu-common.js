/*!
 *  Chinachu Common Module (node-chinachu-common)
 *
 *  Copyright (c) 2012 Yuki KAN and Chinachu Project Contributors
 *  http://chinachu.akkar.in/
**/
/*jslint node:true, nomen:true, plusplus:true, regexp:true, vars:true, continue:true */
'use strict';

var fs         = require('fs');
var path       = require('path');
var crypto     = require('crypto');
var dateFormat = require('dateformat').default;
var child_process = require('child_process');

var execSync   = function (command) {
	try {
		return child_process.execSync(command, { encoding: 'utf8' });
	} catch (e) {
	}
};

exports.jsonWatcher = function (filepath, callback, option) {
	if (typeof option === 'undefined') { option = {}; }

	option.wait = option.wait || 1000;

	if (!fs.existsSync(filepath)) {
		if (option.create) {
			fs.writeFileSync(filepath, JSON.stringify(option.create));
		} else {
			callback('FATAL: `' + filepath + '` is not exists.', null, null);
			return;
		}
	}

	var data = null;

	var parse = function (err, json) {
		if (err) {
			callback('WARN: Failed to read `' + filepath + '`. (' + err + ')', null, null);
		} else {
			data = null;

			try {
				data = JSON.parse(json);
				callback(null, data, 'READ: `' + filepath + '` is updated.');
			} catch (e) {
				callback('WARN: `' + filepath + '` is invalid. (' + e + ')', null, null);
			}
		}
	};

	var timer = null;

	var read = function () {
		timer = null;

		fs.readFile(filepath, { encoding: 'utf8' }, parse);
	};

	if (option.now) { read(); }

	var onUpdated = function () {
		if (timer !== null) { clearTimeout(timer); }
		timer = setTimeout(read, option.wait);
	};
	var watcher = fs.watch(filepath, onUpdated);
	watcher.once('close', function () {
		if (timer !== null) { clearTimeout(timer); }
	});
	return watcher;
};

exports.getProgramById = function (id, array) {
	if (!array || array.length === 0) {
		return null;
	}

	if (array[0].programs) {
		array = (function () {
			var programs = [];

			array.forEach(function (ch) {
				programs = programs.concat(ch.programs);
			});

			return programs;
		}());
	}

	return (function () {
		var x = null;

		array.forEach(function (a) {
			if (a.id === id) { x = a; }
		});

		return x;
	}());
};

exports.existsTuner = function (tuners, type, callback) {
	console.error("existsTuner() has no longer used.");
	callback(false);
};

exports.existsTunerSync = function (tuners, type) {
	console.error("existsTunerSync() has no longer used.");
	return false;
};

exports.getFreeTunerSync = function (tuners, type, isEpg, priority) {
	console.error("getFreeTunerSync() has no longer used.");
	return null;
};

exports.lockTunerSync = function (tuner, priority) {
	console.error("lockTunerSync() has no longer used.");
};

exports.unlockTuner = function (tuner, callback) {
	console.error("unlockTuner() has no longer used.");
	callback();
};

exports.unlockTunerSync = function (tuner, safe) {
	console.error("unlockTunerSync() has no longer used.");
};

exports.writeTunerPidSync = function (tuner, pid, priority) {
	console.error("writeTunerPidSync() has no longer used.");
};

var Countdown = function (count, callback) {
	this.c = count;
	this.f = callback;
};

Countdown.prototype = {
	tick: function () {

		--this.c;

		if (this.c === 0) {
			this.f();
		}

		return this;
	}
};

exports.createCountdown = function (a, b) {
	return new Countdown(a, b);
};

exports.createTimeout = function (a, b) {
	return function () {
		return setTimeout(a, b);
	};
};

exports.formatRecordedName = function (program, name) {
	name = name.replace(/<([^>]+)>/g, function (z, a) {

		// date:
		if (a.match(/^date:.+$/) !== null) { return dateFormat(new Date(program.start), a.match(/:(.+)$/)[1]); }

		// id
		if (a.match(/^id$/) !== null) { return program.id; }

		// type
		if (a.match(/^type$/) !== null) { return program.channel.type; }

		// channel
		if (a.match(/^channel$/) !== null) { return program.channel.channel; }

		// channel-id
		if (a.match(/^channel-id$/) !== null) { return program.channel.id; }

		// channel-sid
		if (a.match(/^channel-sid$/) !== null) { return program.channel.sid; }

		// channel-name
		if (a.match(/^channel-name$/) !== null) { return exports.stripFilename(program.channel.name); }

		// tuner
		if (a.match(/^tuner$/) !== null) { return program.tuner.name; }

		// title
		if (a.match(/^title$/) !== null) { return exports.stripFilename(program.title); }

		// fulltitle
		if (a.match(/^fulltitle$/) !== null) { return exports.stripFilename(program.fullTitle || ''); }

		// subtitle
		if (a.match(/^subtitle$/) !== null) { return exports.stripFilename(program.subTitle || ''); }

		// episode (zero-padded)
		if (a.match(/^episode:\d+$/) !== null) {
			var digit = a.match(/\d+/)[0];
			if (isNaN(digit)) {
				digit = 1;
			}
			return program.episode === null ? 'n' : program.episode.toString(10).padStart(Number(digit), '0');
		}

		// episode
		if (a.match(/^episode$/) !== null) { return program.episode || 'n'; }

		// category
		if (a.match(/^category$/) !== null) { return program.category; }
	});

	var info = path.parse(name);
	var limit = 255 - Buffer.byteLength(info.ext);
	var basename = info.name;
	while (Buffer.byteLength(basename) > limit) {
		basename = basename.slice(0, -1);
	}
	name = path.join(info.dir, basename + info.ext);

	return name;
};

// strip
exports.stripFilename = function (a) {

	a = a.replace(/\//g, '／').replace(/\\/g, '＼').replace(/:/g, '：').replace(/\*/g, '＊').replace(/\?/g, '？');
	a = a.replace(/"/g, '”').replace(/</g, '＜').replace(/>/g, '＞').replace(/\|/g, '｜').replace(/≫/g, '＞＞');
	a = a.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');

	return a;
};

// 全ルールとのマッチ判定
exports.isMatchedProgram = function (rules, program, nf) {
	var i;

	// fullTitle, detailを正規化しておく。
	var fullTitle_norm, detail_norm;
	if (nf) {
		fullTitle_norm = program.fullTitle.normalize(nf);
		if (program.detail) {
			detail_norm = program.detail.normalize(nf);
		}
	}
	else {
		fullTitle_norm = program.fullTitle;
		if (program.detail) {
			detail_norm = program.detail;
		}
	}
	for (i = 0; i < rules.length; i++) {
		if (exports.programMatchesRule(rules[i], program, nf, fullTitle_norm, detail_norm)) {
			return true;
		}
	}

	return false;
};

// 条件をすべて満たしたルールから、一致したキーワードと対象チャンネルを収集する。
exports.getProgramMatchInfo = function (rules, program, nf) {
	var keywords = new Set();
	var channels = new Set();
	var isMatched = false;
	rules.forEach(function (rule) {
		if (!exports.programMatchesRule(rule, program, nf)) { return; }
		isMatched = true;
		if (rule.channels && rule.channels.length) { channels.add(program.channel.id); }
		[['reserve_titles', program.fullTitle], ['reserve_descriptions', program.detail]].forEach(function (field) {
			var text = field[1] || '';
			if (nf) { text = text.normalize(nf); }
			(rule[field[0]] || []).forEach(function (keyword) {
				if (text.match(nf ? keyword.normalize(nf) : keyword) !== null) {
					keywords.add(keyword);
				}
			});
		});
	});
	return { isMatched: isMatched, keywords: Array.from(keywords), channels: Array.from(channels) };
};

// Positive keyword conditions shared by the scheduler and CLI search.
exports.matchesRuleKeywords = function (rule, title, detail, nf) {
	var results = [];
	[['reserve_titles', title], ['reserve_descriptions', detail]].forEach(function (field) {
		var keywords = rule[field[0]];
		if (!keywords) { return; }
		// Preserve explicit empty arrays in legacy rules; forms omit empty fields.
		if (!keywords.length) {
			if (!rule.reserve_fields_operator && !rule.reserve_titles_operator && !rule.reserve_descriptions_operator) {
				results.push(false);
			}
			return;
		}
		var text = field[1];
		if (typeof text !== 'string' || (field[0] === 'reserve_descriptions' && !text)) { results.push(false); return; }
		if (nf) { text = text.normalize(nf); }
		var matches = function (keyword) {
			return text.match(nf ? keyword.normalize(nf) : keyword) !== null;
		};
		results.push(rule[field[0] + '_operator'] === 'and' ? keywords.every(matches) : keywords.some(matches));
	});
	return results.length === 0 || (rule.reserve_fields_operator === 'or' ?
		results.some(function (value) { return value; }) : results.every(function (value) { return value; }));
};

// 単体のルールとのマッチ判定
exports.programMatchesRule = function (rule, program, nf, fullTitle_norm, detail_norm) {
	var i, j, l, m, isFound;

	// 引数に互換性を持たせるため、追加した分はチェック
	// タイトル、詳細
	if (nf) {
		if (!fullTitle_norm) {
			fullTitle_norm = program.fullTitle.normalize(nf);
		}
		if (!detail_norm) {
			detail_norm = (program.detail || '').normalize(nf);
		}
	}

	// isDisabled
	if (rule.isDisabled) { return false; }

	// sid
	if (rule.sid && rule.sid !== program.channel.sid) { return false; }

	// types
	if (rule.types) {
		if (rule.types.indexOf(program.channel.type) === -1) { return false; }
	}

	// channels
	if (rule.channels) {
		if (rule.channels.indexOf(program.channel.id) === -1) {
			if (rule.channels.indexOf(program.channel.channel) === -1) {
				if (rule.channels.indexOf(program.channel.type+'_'+program.channel.sid) === -1) {
					return false;
				}
			}
		}
	}

	// ignore_channels
	if (rule.ignore_channels) {
		if (rule.ignore_channels.indexOf(program.channel.id) !== -1) {
			return false;
		}
		if (rule.ignore_channels.indexOf(program.channel.channel) !== -1) {
			return false;
		}
		if (rule.ignore_channels.indexOf(program.channel.type+'_'+program.channel.sid) !== -1) {
			return false;
		}
	}

	// category
	if (rule.category && rule.category !== program.category) { return false; }

	// categories
	if (rule.categories) {
		if (rule.categories.indexOf(program.category) === -1) { return false; }
	}

	// hour
	if (rule.hour && (typeof rule.hour.start === 'number') && (typeof rule.hour.end === 'number') && !(rule.hour.start === 0 && rule.hour.end === 24)) {
		var ruleStart = rule.hour.start;
		var ruleEnd   = rule.hour.end;

		var progStart = new Date(program.start).getHours();
		var progEnd   = new Date(program.end).getHours();
		var progEndMinute = new Date(program.end).getMinutes();

		if (progStart > progEnd) {
			progEnd += 24;
		}
		if (progEndMinute === 0) {
			progEnd -= 1;
		}

		if (ruleStart > ruleEnd) {
			if ((ruleStart > progStart) && (ruleEnd < progEnd)) { return false; }
		} else {
			if ((ruleStart > progStart) || (ruleEnd < progEnd)) { return false; }
		}
	}

	// duration
	if (rule.duration && (typeof rule.duration.min !== 'undefined') && (typeof rule.duration.max !== 'undefined')) {
		if ((rule.duration.min > program.seconds) || (rule.duration.max < program.seconds)) { return false; }
	}

	if (!exports.matchesRuleKeywords(rule, program.fullTitle, program.detail, nf)) { return false; }

	// ignore_titles
	if (rule.ignore_titles) {
		for (i = 0; i < rule.ignore_titles.length; i++) {
			if (nf) {
				if (fullTitle_norm.match(rule.ignore_titles[i].normalize(nf)) !== null) { return false; }
			}
			else {
				if (program.fullTitle.match(rule.ignore_titles[i]) !== null) { return false; }
			}
		}
	}

	// ignore_descriptions
	if (rule.ignore_descriptions && program.detail) {
		for (i = 0; i < rule.ignore_descriptions.length; i++) {
			if (nf) {
				if (detail_norm.match(rule.ignore_descriptions[i].normalize(nf)) !== null) { return false; }
			}
			else {
				if (program.detail.match(rule.ignore_descriptions[i]) !== null) { return false; }
			}
		}
	}

	// ignore_flags
	if (rule.ignore_flags) {
		for (i = 0; i < rule.ignore_flags.length; i++) {
			for (j = 0; j < program.flags.length; j++) {
				if (rule.ignore_flags[i] === program.flags[j]) { return false; }
			}
		}
	}

	// reserve_flags
	if (rule.reserve_flags) {
		if (!program.flags) { return false; }

		isFound = false;

		for (i = 0; i < rule.reserve_flags.length; i++) {
			for (j = 0; j < program.flags.length; j++) {
				if (rule.reserve_flags[i] === program.flags[j]) { isFound = true; }
			}
		}

		if (!isFound) { return false; }
	}

	return true;
};
