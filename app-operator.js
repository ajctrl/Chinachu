/*!
 *  Chinachu Task Operator Service (chinachu-operator)
 *
 *  Copyright (c) 2016 Yuki KAN and Chinachu Project Contributors
 *  https://chinachu.moe/
**/
'use strict';

const CONFIG_FILE = __dirname + '/config.json';
const RESERVES_DATA_FILE  = __dirname + '/data/reserves.json';
const RECORDING_DATA_FILE = __dirname + '/data/recording.json';
const RECORDED_DATA_FILE  = __dirname + '/data/recorded.json';

// 標準モジュールのロード
const fs = require('fs');
const child_process = require('child_process');
const { log } = require('./lib/logger');
const { createGotifyNotifier } = require('./lib/gotify-notifier');
const { configureMirakurunClient } = require('./lib/mirakurun-client');

// ディレクトリチェック
if (!fs.existsSync('./data/') || !fs.existsSync('./log/') || !fs.existsSync('./web/')) {
	console.error('必要なディレクトリが存在しないか、カレントワーキングディレクトリが不正です。');
	process.exit(1);
}

// 終了処理
process.on('SIGQUIT', () => {
	setTimeout(() => {
		process.exit(0);
	}, 0);
});

// 例外処理
process.on('uncaughtException', (err) => {
	console.error('uncaughtException: ' + err.stack);
});

// 追加モジュールのロード
const { default: dateFormat } = require('dateformat');
const mkdirp = require('mkdirp');
const disk = require('diskusage');
const nodemailer = require("nodemailer");
const chinachu = require('chinachu-common');
const mirakurun = new (require("mirakurun").default)();

//
let reserves = [];
let recorded = [];
let recording = [];

// 設定の読み込み
const pkg = require("./package.json");
const config = require(CONFIG_FILE);

// settings
const schedulerIntervalTime = 1000 * 60 * 10;// 最長10分毎
const notifyIntervalTime = 1000 * 60 * 60 * 3;// 3時間毎
const prepTime = 1000 * 15;// 15秒前
const recordingPriority = config.recordingPriority || 2;
const conflictedPriority = config.conflictedPriority || 1;
const storageLowSpaceThresholdMB = config.storageLowSpaceThresholdMB || 3000;// 3 GB
const storageLowSpaceAction = config.storageLowSpaceAction || "remove"; // "none" | "stop" | "remove"
const storageLowSpaceNotifyTo = config.storageLowSpaceNotifyTo;// e-mail address
const storageLowSpaceCommand = config.storageLowSpaceCommand || null;// command

// setuid
if (process.platform !== "win32") {
	if (process.getuid() === 0) {
		if (typeof config.gid === "string" || typeof config.gid === "number") {
			process.setgid(config.gid);
		} else {
			process.setgid('video');
		}
		if (typeof config.uid === "string" || typeof config.uid === "number") {
			process.setuid(config.uid);
		} else {
			console.error("[fatal] 'uid' required in config.");
			process.exit(1);
		}
	}
}

// Mirakurun Client
const mirakurunPath = config.mirakurunPath || config.schedulerMirakurunPath || "http+unix://%2Fvar%2Frun%2Fmirakurun.sock/";
configureMirakurunClient(mirakurun, mirakurunPath);

mirakurun.userAgent = `Chinachu/${pkg.version} (operator)`;
mirakurun.priority = recordingPriority;

console.info(mirakurun);

// sendmail
const transporter = nodemailer.createTransport({ sendmail: true });

// 録画中リストをクリア
fs.writeFileSync(RECORDING_DATA_FILE, '[]');

// 保存先ディレクトリが存在しない場合には作成
if (!fs.existsSync(config.recordedDir)) {
	log('MKDIR: ' + config.recordedDir);
	mkdirp.sync(config.recordedDir);
}

// Gotify
let gotifyNotifier;
if (config.operGotify && config.operGotifyUrl && config.operGotifyToken && config.operGotifyFormat) {
	gotifyNotifier = createGotifyNotifier({
		url: config.operGotifyUrl,
		token: config.operGotifyToken,
		title: config.operGotifyTitle,
		priority: config.operGotifyPriority,
		timeout: config.operGotifyTimeout
	});
}

function notifyGotify(message) {
	gotifyNotifier(message)
		.then(() => log('[Gotify] Sent: ' + message))
		.catch(err => log('[Gotify] Error: ' + err.message));
}

let clock = Date.now();
let scheduler = null;
let scheduled = 0;
let stChecked = 0;
let stNotified = 0;

// メインループ
setInterval(() => {

	clock = Date.now();

	for (let i = 0, l = reserves.length; i < l; i++) {
		reservesChecker(reserves[i]);
	}
}, 1000 * 3);

// 裏ループ
setInterval(() => {

	if ((scheduler === null) && (clock - scheduled > schedulerIntervalTime)) {
		startScheduler();
		scheduled = clock;
	}

	if (clock - stChecked > 1000 * 20) {
		storageChecker();
		stChecked = clock;
	}
}, 1000 * 6);

// 予約時間チェック
function reservesChecker(program) {

	// スキップする
	if (program.isSkip) {
		return;
	}

	// 予約時間超過
	if (clock > program.end) {
		return;
	}

	// 予約準備時間内
	if (program.start - clock < prepTime) {
		if (isRecording(program) === false) {
			prepRecord(program);
		}
	}
}

// 録画中か
function isRecording(program) {

	for (let i = 0, l = recording.length; i < l; i++) {
		if (recording[i].id === program.id) {
			return true;
		}
	}

	return false;
}

// 録画したか
function isRecorded(program) {

	for (let i = 0, l = recorded.length; i < l; i++) {
		if (recorded[i].id === program.id && clock < recorded[i].end) {
			return true;
		}
	}

	return false;
}

// 録画中の番組を更新
function recordingUpdater(program) {

	for (let i = 0, l = recording.length; i < l; i++) {
		if (recording[i].id === program.id) {
			for (let k in program) {
				if (program.hasOwnProperty(k)) {
					recording[i][k] = program[k];
				}
			}
			return;
		}
	}
}

// スケジューラーを停止
function stopScheduler() {
	process.removeListener('SIGINT',  stopScheduler);
	process.removeListener('SIGQUIT', stopScheduler);
	process.removeListener('SIGTERM', stopScheduler);

	if (scheduler === null) { return; }

	scheduler.kill('SIGQUIT');
	log('KILL: SIGQUIT -> Scheduler (pid=' + scheduler.pid + ')');
}

// スケジューラーを開始
function startScheduler() {
	if (scheduler !== null) { return; }

	var output, finalize;

	scheduler = child_process.spawn('./chinachu', [ 'update' ]);
	log('SPAWN: ./chinachu update (pid=' + scheduler.pid + ')');

	// ログ用
	output = fs.createWriteStream('./log/scheduler', { flags: 'a' });
	log('STREAM: ./log/scheduler');

	finalize = function () {

		log('EXIT: node app-scheduler.js (pid=' + scheduler.pid + ')');

		try {
			process.removeListener('SIGINT', stopScheduler);
			process.removeListener('SIGQUIT', stopScheduler);
			process.removeListener('SIGTERM', stopScheduler);
		} catch (e) {}

		try { output.end(); } catch (ee) {}

		scheduler = null;
	};

	scheduler.stdout.on('data', function (data) {
		try {
			output.write(data);
		} catch (e) {
			log('ERROR: Scheduler -> Abort (' + e + ')');
			finalize();
		}
	});

	scheduler.once('exit', finalize);

	process.once('SIGINT', stopScheduler);
	process.once('SIGQUIT', stopScheduler);
	process.once('SIGTERM', stopScheduler);
}

// 番組ログ用
function printProgram(program) {
	return `#${program.id} ${dateFormat(new Date(program.start), "isoDateTime")} [${program.channel.name}] ${program.title}`
}

// 録画準備
function prepRecord(program) {

	if (clock > program.end) {
		return;
	}

	log('PREPARE: ' + printProgram(program));

	// set priority
	mirakurun.priority = program.priority = program.priority || (program.isConflict ? conflictedPriority : recordingPriority);

	const abortController = new AbortController();
	Object.defineProperty(program, "_abortController", {
		configurable: true,
		enumerable: false,
		value: abortController
	});

	// get stream
	mirakurun.getProgramStream({
		id: parseInt(program.id, 36),
		decode: true,
		priority: program.priority,
		signal: abortController.signal
	})
		.then(stream => doRecord(program, stream))
		.catch(err => {

			if (program._stream) {
				// 既に録画開始
				return;
			}

			if (abortController.signal.aborted) {
				log('ABORT: ' + printProgram(program));
			} else if (err.req) {
				log("ERROR: " + printProgram(program), err.req.path, err.statusCode, err.statusMessage);
			} else {
				log("ERROR: " + printProgram(program), err);
			}

			// リトライ
			setTimeout(() => {
				const index = recording.indexOf(program);
				if (index !== -1) {
					recording.splice(index, 1);
				}
				delete program._abortController;
				fs.writeFileSync(RECORDING_DATA_FILE, JSON.stringify(recording));
			}, 5000);
		});

	recording.push(program);
	fs.writeFileSync(RECORDING_DATA_FILE, JSON.stringify(recording));
	log('WRITE: ' + RECORDING_DATA_FILE);
}

// 録画実行
function doRecord(program, stream) {
	const abortController = program._abortController;

	log('RECORD: ' + printProgram(program));

	// dummy
	program.tuner = {
		name: `Mirakurun (${mirakurun.host ? mirakurun.host : "UnixSocket"})`,
		command: "*",
		isScrambling: false
	};
	program.command = `mirakurun type=${program.channel.type} url=${stream.req.path} priority=${program.priority}`;// dummy
	program.pid = -1;// dummy

	// 保存先パス
	const recPath = config.recordedDir + chinachu.formatRecordedName(program, program.recordedFormat || config.recordedFormat);
	program.recorded = recPath;

	// 保存先ディレクトリ
	const recDirPath = recPath.replace(/^(.+)\/.+$/, '$1');
	if (!fs.existsSync(recDirPath)) {
		log('MKDIR: ' + recDirPath);
		mkdirp.sync(recDirPath);
	}

	// 保存ストリーム
	const recFile = fs.createWriteStream(recPath, { flags: 'a' });
	log('STREAM: ' + recPath);
	Object.defineProperty(program, "_stream", {
		configurable: true,
		enumerable: false,
		value: stream
	});
	stream.pipe(recFile);

	// 録画プロセス終了時処理
	stream.once('end', finalize);
	stream.once('close', finalize);
	stream.once('error', err => {
		if (!abortController.signal.aborted) {
			log('ERROR: ' + printProgram(program), err);
		}
		finalize();
	});

	// 終了シグナル時処理
	process.on('SIGINT', finalize);
	process.on('SIGQUIT', finalize);
	process.on('SIGTERM', finalize);

	// 状態更新
	fs.writeFileSync(RECORDING_DATA_FILE, JSON.stringify(recording));
	log('WRITE: ' + RECORDING_DATA_FILE);

	// Gotify
	if (gotifyNotifier && config.operGotifyFormat.start) {
		notifyGotify(
			config.operGotifyFormat.start
				.replace('<id>', program.id)
				.replace('<type>', program.channel.type)
				.replace('<channel>', ((program.channel.type === 'CS') ? program.channel.sid : program.channel.channel))
				.replace('<title>',   program.title)
				.replace('<fullTitle>', program.fullTitle)
				.replace('<channelname>', program.channel.name)
				.replace('<date>', dateFormat(new Date(program.start), "mm/dd"))
				.replace('<starttime>', dateFormat(new Date(program.start), "h:MM"))
				.replace('<endtime>', dateFormat(new Date(program.end), "h:MM"))
		);
	}

	// お片付け
	let finalized = false;
	function finalize() {
		if (finalized) {
			return;
		}
		finalized = true;

		stream.unpipe();
		if (!abortController.signal.aborted) {
			abortController.abort();
		}

		process.removeListener('SIGINT', finalize);
		process.removeListener('SIGQUIT', finalize);
		process.removeListener('SIGTERM', finalize);

		// 書き込みストリームを閉じる
		recFile.end();

		// 状態を更新
		delete program.pid;
		for (let i = 0, l = recorded.length; i < l; i++) {
			if (recorded[i].id === program.id) {
				if (recorded[i].recorded === program.recorded) {
					recorded.splice(i, 1);
				} else {
					recorded[i].id += '-' + recorded[i].start.toString(36);
				}
				break;
			}
		}
		recorded.push(program);
		const recordingIndex = recording.indexOf(program);
		if (recordingIndex !== -1) {
			recording.splice(recordingIndex, 1);
		}
		delete program._stream;
		delete program._abortController;
		fs.writeFileSync(RECORDED_DATA_FILE, JSON.stringify(recorded));
		fs.writeFileSync(RECORDING_DATA_FILE, JSON.stringify(recording));
		log('WRITE: ' + RECORDED_DATA_FILE);
		log('WRITE: ' + RECORDING_DATA_FILE);
		if (program.isManualReserved) {
			for (let i = 0, l = reserves.length; i < l; i++) {
				if (reserves[i].id === program.id) {
					reserves.splice(i, 1);
					fs.writeFileSync(RESERVES_DATA_FILE, JSON.stringify(reserves));
					log('WRITE: ' + RESERVES_DATA_FILE);
					break;
				}
			}
		}

		// ポストプロセス
		if (config.recordedCommand) {
			const postProcess = child_process.spawn(config.recordedCommand, [recPath, JSON.stringify(program)]);
			log('SPAWN: ' + config.recordedCommand + ' (pid=' + postProcess.pid + ')');
		}

		// Gotify
		if (gotifyNotifier && config.operGotifyFormat.end) {
			notifyGotify(
				config.operGotifyFormat.end
					.replace('<id>', program.id)
					.replace('<type>', program.channel.type)
					.replace('<channel>', ((program.channel.type === 'CS') ? program.channel.sid : program.channel.channel))
					.replace('<title>', program.title)
					.replace('<fullTitle>', program.fullTitle)
					.replace('<channelname>', program.channel.name)
					.replace('<date>', dateFormat(new Date(program.start), "mm/dd"))
					.replace('<starttime>', dateFormat(new Date(program.start), "h:MM"))
					.replace('<endtime>', dateFormat(new Date(program.end), "h:MM"))
			);
		}

		log('FIN: ' + printProgram(program));
	}
}

// 録画中止
function stopRecording(programId) {

	const program = recording.find(program => program.id === programId);

	if (program && program._abortController) {
		program._abortController.abort();
	}
}

// ストレージチェック
function storageChecker() {

	disk.check(config.recordedDir, (err, info) => {
		if(err) {
			return;
		}

		const freeMB = info.available / 1024 / 1024;
		if (freeMB < storageLowSpaceThresholdMB) {
			stChecked = 0;// すぐに再チェックするため
			log(`ALERT: Storage Low Space! (${freeMB} MB < ${storageLowSpaceThresholdMB} MB)`);

			// 1. 指定コマンド実行
			if (storageLowSpaceCommand) {
				const command = child_process.spawn(storageLowSpaceCommand);
				log('SPAWN: ' + storageLowSpaceCommand + ' (pid=' + command.pid + ')');
			}

			// 2. アクション
			if (storageLowSpaceAction === "stop") {
				// 録画停止
				recording.forEach(program => stopRecording(program.id));
			} else if (storageLowSpaceAction === "remove") {
				// 削除
				if (recorded.length > 0) {
					const program = recorded.shift();
					if (fs.existsSync(program.recorded) === true) {
						fs.unlinkSync(program.recorded);
					}
					fs.writeFileSync(RECORDED_DATA_FILE, JSON.stringify(recorded));
					log('WRITE: ' + RECORDED_DATA_FILE);
				}
			}

			// 3. メール通知
			if (storageLowSpaceNotifyTo && clock - stNotified > notifyIntervalTime) {
				stNotified = clock;

				transporter.sendMail({
					from: "Chinachu <chinachu@localhost>",
					to: storageLowSpaceNotifyTo,
					subject: "[Chinachu] ALERT: Storage Low Space!",
					text: `Current Free Space is ${freeMB} MB.\nThreshold is ${storageLowSpaceThresholdMB} MB.`
				}, (err, info) => {
					if (err) {
						console.log(err);
					}
				});
			}
		}
	});
}

// ファイル更新監視: ./data/reserves.json
chinachu.jsonWatcher(
	RESERVES_DATA_FILE,
	(err, data, mes) => {
		if (err) {
			console.error(err);
			return;
		}

		reserves = data;
		log(mes);

		if (recording.length > 0) {
			reserves.forEach(recordingUpdater);

			fs.writeFileSync(RECORDING_DATA_FILE, JSON.stringify(recording));
			log('WRITE: ' + RECORDING_DATA_FILE);
		}
	},
	{ create: [], now: true }
);

// ファイル更新監視: ./data/recorded.json
chinachu.jsonWatcher(
	RECORDED_DATA_FILE,
	(err, data, mes) => {
		if (err) {
			console.error(err);
			return;
		}

		recorded = data;
		log(mes);
	},
	{ create: [], now: true }
);

// ファイル更新監視: ./data/recording.json
chinachu.jsonWatcher(
	RECORDING_DATA_FILE,
	(err, data, mes) => {
		if (err) {
			console.error(err);
			return;
		}

		// 録画中止処理
		data.filter(program => !!program.abort).forEach(program => {
			stopRecording(program.id);
		});
	},
	{ create: [], now: false }
);
