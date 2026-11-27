/*!
 *  Chinachu Task Scheduler (chinachu-scheduler)
 *
 *  Copyright (c) 2016 Yuki KAN and Chinachu Project Contributors
 *  https://chinachu.moe/
**/
'use strict';

const PID_FILE = __dirname + '/data/scheduler.pid';

const CONFIG_FILE = __dirname + '/config.json';
// 標準モジュールのロード
const fs = require('fs');
const child_process = require('child_process');
const { log } = require('./lib/logger');
const { configureMirakurunClient } = require('./lib/mirakurun-client');

// ディレクトリチェック
if (!fs.existsSync('./data/') || !fs.existsSync('./log/') || !fs.existsSync('./web/')) {
	console.error('必要なディレクトリが存在しないか、カレントワーキングディレクトリが不正です。');
	process.exit(1);
}

// 追加モジュールのロード
const opts = require('opts');
const { default: dateFormat } = require('dateformat');
const chinachu = require('chinachu-common');
const { buildCandidates, markDuplicates } = require('./lib/reservation-planner');
const { StateStore } = require('./lib/state-store');
const { runSchedulerHook } = require('./lib/scheduler-hook');
const mirakurun = new (require("mirakurun").default)();

// 引数
opts.parse([
	{
		short: 's',
		long: 'simulation',
		description: 'シミュレーション。実際には保存されません',
		value: false,
		required: false
	}
], true);

// 設定の読み込み
const pkg = require("./package.json");
const config = require(CONFIG_FILE);
const simulation = !!opts.get('s');
const store = new StateStore(__dirname, { simulation });
let tuners = null;

// Mirakurun Client
const mirakurunPath = config.mirakurunPath || config.schedulerMirakurunPath || "http+unix://%2Fvar%2Frun%2Fmirakurun.sock/";
configureMirakurunClient(mirakurun, mirakurunPath);

mirakurun.userAgent = `Chinachu/${pkg.version} (scheduler)`;

console.info(mirakurun);

// PID file operation
function createPidFile() {
	fs.writeFileSync(PID_FILE, process.pid.toString(10));
}

function deletePidFile() {
	fs.unlinkSync(PID_FILE);
}

// scheduler is running?
function isRunning(callback) {

	if (fs.existsSync(PID_FILE) === true) {
		var pid = fs.readFileSync(PID_FILE, { encoding: 'utf8' });
		pid = pid.trim();

		child_process.exec('ps h -p ' + pid, function (err, stdout) {

			if (stdout === '') {
				deletePidFile();
				callback(false);
			} else {
				callback(true);
			}
		});
	} else {
		callback(false);
	}

	return void 0;
}

// Run user hooks outside the write transaction; they may invoke the CLI.
function scheduler(schedule) {
	log('RUNNING SCHEDULER.');
	const hasStartHook = !simulation && Boolean(config.schedulerStartCommand);
	if (hasStartHook) {
		// The hook can reserve newly fetched programs through a separate CLI or API connection.
		store.replace('schedule', schedule);
		runSchedulerHook(store, config.schedulerStartCommand, { sync: true, schedule });
	}
	const { counts, conflicts } = store.transaction(() => {
		if (!simulation && !hasStartHook) store.replace('schedule', schedule);
		return planReservations(schedule);
	}, !simulation);
	if (!simulation) log('WRITE: schedule, reserves');
	if (config.conflictCommand) {
		for (const program of conflicts) {
			const child = child_process.spawn(config.conflictCommand, [process.pid, program.id, dateFormat(new Date(program.start), 'isoDateTime'), program.channel.name, program.title, JSON.stringify(program)], { stdio: 'ignore' });
			child.once('error', error => log('ERROR: ' + config.conflictCommand + ': ' + error.message));
			child.unref();
			log('SPAWN: ' + config.conflictCommand + ' (pid=' + child.pid + ')');
		}
	}
	if (!simulation && config.schedulerEndCommand) {
		runSchedulerHook(store, config.schedulerEndCommand, { counts });
	}
}

function planReservations(schedule) {
	var i, j, k, l, a;
	const rules = store.read('rules');
	const excludes = store.read('excludes');
	// IDが重複しているかチェックするだけ
	var idMap = {};
	schedule.forEach(function (ch) {
		ch.programs.forEach(function (p) {
			if (idMap[p.id]) {
				log('**WARNING**: ' + p.id + ' is duplicated!');
				console.log(JSON.stringify(idMap[p.id], null, '  '), JSON.stringify(p, null, '  '));
			} else {
				idMap[p.id] = p;
			}
		});
	});

	const previousReserves = store.read('reserves');

	var typeNum = {};

	tuners.forEach(tuner => {
		tuner.types.forEach(type => {
			if (typeof typeNum[type] === 'undefined') {
				typeNum[type] = 1;
			} else {
				typeNum[type]++;
			}
		});
	});

	log('TUNERS: ' + JSON.stringify(typeNum));

	// 予約対象を集めてから共通除外を判定し、保存済みの操作状態を引き継ぐ。
	var matches = buildCandidates(schedule, rules, previousReserves, config, excludes);

	// sort
	matches.sort(function (a, b) {
		return a.start - b.start;
	});

	// Resolve duplicate groups before tuner allocation.
	var duplicateCount = markDuplicates(matches);
	for (i = 0; i < matches.length; i++) {
		a = matches[i];
		if (!a.isDuplicate) { continue; }
		log('DUPLICATE: ' + a.id + ' ' + dateFormat(new Date(a.start), 'isoDateTime') + ' [' + a.channel.name + '] ' + a.title);
	}

	// check conflict
	const conflicts = [];
	var tunerThreads  = [];
	for (i = 0; i < tuners.length; i++) {
		tunerThreads.push([]);
	}
	for (i = 0; i < matches.length; i++) {
		a = matches[i];

		if (a.isDuplicate || a.isSkip) { continue; }

		a.isConflict = true;

		for (k = 0; k < tuners.length; k++) {
			if (tuners[k].types.indexOf(a.channel.type) !== -1) {
				var aIsConflictInTuner = false;
				for (l = 0; l < tunerThreads[k].length; l++) {
					if (!((tunerThreads[k][l].end <= a.start) || (tunerThreads[k][l].start >= a.end))) {
						aIsConflictInTuner = true;
						break;
					}
				}

				if (aIsConflictInTuner) {
					continue;
				} else {
					tunerThreads[k].push(a);
					a.isConflict = false;
					break;
				}
			}
		}

		if (!a.isConflict) {
			continue;
		} else {
			log('!CONFLICT: ' + a.id + ' ' + dateFormat(new Date(a.start), 'isoDateTime') + ' [' + a.channel.name + '] ' + a.title);

			conflicts.push(a);
		}
	}

	// reserve
	const reserves = [];
	var reservedCount = 0;
	var skipCount     = 0;
	for (i = 0; i < matches.length; i++) {
		a = matches[i];

		if (!a.isDuplicate) {
			reserves.push(a);

			if (a.isSkip) {
				log('!!!SKIP: ' + a.id + ' ' + dateFormat(new Date(a.start), 'isoDateTime') + ' [' + a.channel.name + '] ' + a.title);
				++skipCount;
			} else if (!a.isConflict) {
				log('RESERVE: ' + a.id + ' ' + dateFormat(new Date(a.start), 'isoDateTime') + ' [' + a.channel.name + '] ' + a.title);
				++reservedCount;
			} else {
				// 競合したときのログは既に出力済み
			}
		}
	}

	// ruleにもしあればreserveにrecordedFormatを追加
	reserves.forEach(function (reserve) {
		rules.forEach(function (rule) {
			if (typeof rule.recorded_format !== 'undefined' && chinachu.programMatchesRule(rule, reserve, config.normalizationForm)) {
				reserve.recordedFormat = rule.recorded_format;
			}
		});
	});

	// results
	log('MATCHES: ' + matches.length.toString(10));
	log('DUPLICATES: ' + duplicateCount.toString(10));
	log('CONFLICTS: ' + conflicts.length.toString(10));
	log('SKIPS: ' + skipCount.toString(10));
	log('RESERVES: ' + reservedCount.toString(10));

	if (!simulation) {
		store.replace('reserves', reserves.filter(reserve => reserve.end >= Date.now()));
	}
	return { counts: [matches.length, duplicateCount, conflicts.length, skipCount, reservedCount].map(String), conflicts };
}

// (function) program converter
const flagBracketsRE = /\[.{1,2}\]|【.】|\(.{1,2}\)/g;
const flagExtractRE = /(?:【|\[|\()(.{1,2})(?:】|\]|\))/;
const flagRE = /新|終|再|字|デ|解|無|二|S|SS|初|生|Ｎ|映|多|双/;
const flagUniRE = /🈟|🈡|🈞|🈑|🈓|🈖|🈚|🈔|🅂|🅍|🈠|🈢|🄽|🈙|🈕|🈒/g;
const subtitleRE = /.{3,}([「【]([^」】]+)[」】]).*/;
const subtitleExRE = /(?:[#＃♯][0-9０-９]{1,3}|[第][0-9０-９]{1,3}[話回])(?:[ 　「]+)([^「」]+)(?:[」]?)/;
const subtitleExExRE = /[「【][^」】]+[」】]/g;
const epinumRE = /[#＃♯][0-9０-９]{1,3}|[第][0-9０-９]{1,3}[話回]|（[0-9０-９]{1,3}）/g;
const epinumExRE = /[#＃♯][0-9０-９]{1,3}|[第][0-9０-９]{1,3}[話回]/;

function convertPrograms(p, ch) {
	const programs = [];

	for (const c of p) {
		if (c.title === "") {
			continue;
		}

		let title = "";
		let subtitle = "";
		let epinum = null;
		const flags = new Set();

		// 理題 (title)
		{
			title = c.title.replace(flagBracketsRE, "").replace(flagUniRE, "").trim();
		}

		// 理題 (flag)
		{
			const flagsSource = c.title
				.replace(/\[無料\]/g, "[無]")
				.replace(/\[生放送\]/g, "[生]");

			const matchedFlags = flagsSource.match(flagBracketsRE) || [];
			for (const matchedFlag of matchedFlags) {
				const flag = matchedFlag.match(flagExtractRE)[1];
				if (flagRE.test(flag) === true) {
					flags.add(flag);
				}
			}
		}

		// 理題 (flag) Unicode ARIB外字対応
		{
			const matchedFlags = c.title.match(flagUniRE) || [];
			for (const matchedFlag of matchedFlags) {
				flags.add(matchedFlag.normalize("NFKC"));
			}
		}

		// 理題 (subtitle)
		{
			const title = c.title.replace(flagBracketsRE, "");
			const detail = c.detail.split("\n")[0];

			const matchedSubtitleExInTitle = title.match(subtitleExRE);
			if (matchedSubtitleExInTitle) {
				subtitle = matchedSubtitleExInTitle[1];
			}

			if (subtitle === "") {
				const matchedSubtitleExInDetail = detail.match(subtitleExRE);
				if (matchedSubtitleExInDetail && matchedSubtitleExInDetail[1].length < 30) {
					subtitle = matchedSubtitleExInDetail[1];
				}
			}

			if (subtitle === "") {
				const matchedSubtitleInTitle = title.match(subtitleRE);
				if (matchedSubtitleInTitle) {
					subtitle = matchedSubtitleInTitle[2];
				}
			}

			if (subtitle === "") {
				const matchedSubtitleExExInDetail = detail.match(subtitleExExRE);
				if (matchedSubtitleExExInDetail && matchedSubtitleExExInDetail.length === 1) {
					subtitle = matchedSubtitleExExInDetail[0];
				}
			}

			if (subtitle !== "") {
				subtitle = subtitle
					.trim()
					.replace(/^[「【]/, "")
					.replace(/[」】]$/, "")
					.trim();
			}
		}

		// 理題 (epinum)
		{
			let epinumStr = "";

			const matchedEpinumInTitle = c.title.match(epinumRE);
			if (matchedEpinumInTitle) {
				epinumStr = matchedEpinumInTitle[0];
			}

			if (epinumStr === "") {
				const detail = c.detail.split("\n")[0];
				const matchedEpinumExInDetail = detail.match(epinumExRE);
				if (matchedEpinumExInDetail) {
					epinumStr = matchedEpinumExInDetail[0];
				}
			}

			if (epinumStr !== "") {
				epinumStr = epinumStr.match(/[0-9０-９]+/)[0];
				epinumStr = epinumStr
					.replace(/０/g, "0")
					.replace(/１/g, "1")
					.replace(/２/g, "2")
					.replace(/３/g, "3")
					.replace(/４/g, "4")
					.replace(/５/g, "5")
					.replace(/６/g, "6")
					.replace(/７/g, "7")
					.replace(/８/g, "8")
					.replace(/９/g, "9");

				epinum = parseInt(epinumStr, 10);
			}

			if (epinum === null && flags.has('新') !== -1) {
				epinum = 1;
			}
		}

		// オブジェクト作成
		const programData = c;
		programData.channel = ch;
		programData.title = title;
		programData.subTitle = subtitle;
		programData.episode = epinum;
		programData.flags = [...flags];

		programs.push(programData);
	}

	return programs;
}

function scheduleChannels(schedule) {

	schedule.sort(function (a, b) {
		if (a.n === b.n) {
			return a.sid - b.sid;
		} else {
			return a.n - b.n;
		}
	});

	scheduler(schedule);
}

// experimental
function getEpgFromMirakurun(path) {

	child_process.execSync('renice -n 19 -p ' + process.pid);

	log('GETTING EPG from Mirakurun.');

	// new schedule
	const s = [];

	let channels = [];

	mirakurun.getServices()
		.then(services => {

			log('Mirakurun is OK.');
			log('Mirakurun -> services: ' + services.length);

			const excludeServices = config.excludeServices || [];
			for (let i = 0; i < services.length; i++) {
				if (excludeServices.indexOf(services[i].id) !== -1) {
					services.splice(i, 1);
					i--;
				}
			}

			log('Mirakurun -> services: ' + services.length + ' (excluded)');

			const serviceOrder = config.serviceOrder || [];
			let insertCount = 0;
			serviceOrder.forEach((id) => {
				const i = services.findIndex(service => service.id === id);
				if (i !== -1) {
					const [service] = services.splice(i, 1);
					services.splice(insertCount, 0, service);
					++insertCount;
				}
			});

			log('Mirakurun -> sorted services: ' + insertCount);

			channels = services.map((service, i) => {
				return {
					type: service.channel.type,
					channel: service.channel.channel,
					name: service.name,
					id: service.id.toString(36),
					sid: service.serviceId,
					nid: service.networkId,
					hasLogoData: service.hasLogoData
				};
			});

			for (let i = 0, l = channels.length; i < l; i++) {
				channels[i].n = i;
			}

			return mirakurun.getPrograms();
		})
		.then(programs => {

			log('Mirakurun -> programs: ' + programs.length);

			channels.forEach(channel => {
				mirakurunProgramsToLegacyPrograms(channel, programs);
			});

			return mirakurun.getTuners();
		})
		.then(_tuners => {

			tuners = _tuners;

			log('Mirakurun -> tuners: ' + tuners.length);

			scheduleChannels(channels);
		})
		.catch(e => {

			log('Mirakurun -> Error:');
			console.error(e);
			process.exitCode = 1;
		});
}

const genreTable = {
	0x0: 'news',
	0x1: "sports",
	0x2: "information",
	0x3: "drama",
	0x4: "music",
	0x5: "variety",
	0x6: "cinema",
	0x7: "anime",
	0x8: "documentary",// new
	0x9: "theater",// new
	0xA: "hobby",// new
	0xB: "welfare",// new
	0xC: "etc",
	0xD: "etc",
	0xE: "etc",
	0xF: "etc"
};

function mirakurunProgramsToLegacyPrograms(ch, programs) {

	const programme = programs
		.filter(program => program.networkId === ch.nid && program.serviceId === ch.sid)
		.map(program => {

			const ret = {
				id: program.id.toString(36),
				category: program.genres ? genreTable[program.genres[0].lv1] : "etc",
				title: program.name || "",
				fullTitle: program.name || "",
				detail: program.description || "",
				start: program.startAt,
				end: program.startAt + program.duration,
				seconds: program.duration / 1000
			};

			if (program.extended) {
				ret.description = program.description;
				ret.extra = program.extended;

				for (let key in program.extended) {
					ret.detail += `\n◇${key}\n${program.extended[key]}`;
				}

				ret.detail = ret.detail.trim();
			}

			return ret;
		});

	ch.programs = convertPrograms(programme, JSON.parse(JSON.stringify(ch)));
}

// 既に実行中か
isRunning(running => {

	if (running) {
		console.error('ERROR: Scheduler is already running.');
		process.exit(1);
	} else {
		createPidFile();

		process.on('exit', () => deletePidFile());

		// EPGデータを取得または番組表を読み込む
		if (config.epgStartCommand) {
			runSchedulerHook(store, config.epgStartCommand, { sync: true });
		}

		getEpgFromMirakurun(mirakurunPath);

		if (config.epgEndCommand) {
			runSchedulerHook(store, config.epgEndCommand);
		}
	}
});
