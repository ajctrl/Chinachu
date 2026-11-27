/*!
 *  Chinachu Task Operator Service (chinachu-operator)
 *
 *  Copyright (c) 2016 Yuki KAN and Chinachu Project Contributors
 *  https://chinachu.moe/
**/
'use strict';

const CONFIG_FILE = __dirname + '/config.json';
// 標準モジュールのロード
const fs = require('fs');
const child_process = require('child_process');
const { log } = require('./lib/logger');
const { StateStore } = require('./lib/state-store');
const { RecordingJournal } = require('./lib/recording-journal');
const { saveRecording, finishRecording, sameAiring } = require('./lib/program-state');
const { createGotifyNotifier } = require('./lib/gotify-notifier');
const { configureMirakurunClient } = require('./lib/mirakurun-client');

// ディレクトリチェック
if (!fs.existsSync('./data/') || !fs.existsSync('./log/') || !fs.existsSync('./web/')) {
	console.error('必要なディレクトリが存在しないか、カレントワーキングディレクトリが不正です。');
	process.exit(1);
}

// 追加モジュールのロード
const { default: dateFormat } = require('dateformat');
const nodemailer = require("nodemailer");
const chinachu = require('chinachu-common');
const mirakurun = new (require("mirakurun").default)();

//
let reserves = [];
let recording = [];
let recordingSaveRetry = null;
let recordingPublished = false;
let startupRecordingRevision;
let journal;
let recovering = [];
let shuttingDown = false;

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

let store;

// 例外処理
process.on('uncaughtException', (err) => {
	console.error('uncaughtException: ' + err.stack);
});

// 保存先ディレクトリが存在しない場合には作成
if (!fs.existsSync(config.recordedDir)) {
	log('MKDIR: ' + config.recordedDir);
	fs.mkdirSync(config.recordedDir, { recursive: true });
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
function checkReserves() {
	if (shuttingDown) return;

	clock = Date.now();

	for (let i = 0, l = reserves.length; i < l; i++) {
		reservesChecker(reserves[i]);
	}
}

// 裏ループ
function checkServices() {
	if (shuttingDown) return;

	if ((scheduler === null) && (clock - scheduled > schedulerIntervalTime)) {
		startScheduler();
		scheduled = clock;
	}

	if (clock - stChecked > 1000 * 20) {
		storageChecker();
		stChecked = clock;
	}
}

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
		if (!isRecording(program) && !recovering.some(entry => sameAiring(entry.program, program))) {
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

// 録画中の番組を更新
function recordingUpdater(program) {

	for (let i = 0, l = recording.length; i < l; i++) {
		if (recording[i]._abortController && recording[i].id === program.id) {
			for (let k in program) {
				if (program.hasOwnProperty(k)) {
					recording[i][k] = program[k];
				}
			}
			return;
		}
	}
}

function exitWhenDrained() {
	if (shuttingDown && recording.length === 0 && recovering.length === 0 && recordingSaveRetry === null) process.exit(0);
}

function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	if (scheduler) {
		scheduler.kill('SIGQUIT');
		log('KILL: SIGQUIT -> Scheduler (pid=' + scheduler.pid + ')');
	}

	let cancelledPreparation = false;
	for (let i = recording.length - 1; i >= 0; i--) {
		const { _abortController, _stream } = recording[i];
		if (!_abortController) continue; // Already closing its file or retrying its commit.
		_abortController.abort();
		if (_stream) {
			_stream.destroy();
		} else {
			recording.splice(i, 1);
			cancelledPreparation = true;
		}
	}
	if (cancelledPreparation) persistRecording();
	else exitWhenDrained();
}

for (const signal of ['SIGQUIT', 'SIGTERM', 'SIGINT']) process.on(signal, shutdown);

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
}

// 番組ログ用
function printProgram(program) {
	return `#${program.id} ${dateFormat(new Date(program.start), "isoDateTime")} [${program.channel.name}] ${program.title}`
}

// Retry against the current list so a delayed save cannot restore a finished recording.
function persistRecording() {
	if (recordingSaveRetry !== null) return;
	try {
		saveRecording(store, recording, startupRecordingRevision);
		recordingPublished = true;
		log('WRITE: recording');
	} catch (error) {
		log('ERROR: recording metadata save failed: ' + error.message);
		recordingSaveRetry = setTimeout(() => {
			recordingSaveRetry = null;
			persistRecording();
		}, 1000);
		return;
	}
	exitWhenDrained();
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
		.then(stream => {
			if (shuttingDown) { stream.destroy(); return; }
			try { doRecord(program, stream); }
			catch (error) { stream.destroy(); throw error; }
		})
		.catch(err => {

			if (shuttingDown || program._stream) {
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
				if (shuttingDown) return;
				const index = recording.indexOf(program);
				if (index !== -1) {
					recording.splice(index, 1);
				}
				delete program._abortController;
				persistRecording();
			}, 5000);
		});

	recording.push(program);
	persistRecording();
}

// 録画実行
function doRecord(program, stream) {
	const abortController = program._abortController;
	let completedProgram;

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
	const recPath = chinachu.resolveRecordingPath(config.recordedDir, chinachu.formatRecordedName(program, program.recordedFormat || config.recordedFormat));
	program.recorded = recPath;

	// 保存先を安全に開き、以降はパスを再解決しない。
	const recFd = chinachu.openRecordingFile(config.recordedDir, recPath, true);
	let recFile;
	try { recFile = fs.createWriteStream(null, { fd: recFd, autoClose: true }); }
	catch (error) { fs.closeSync(recFd); throw error; }
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

	// An input can end before buffered writes and the file descriptor have drained.
	recFile.once('error', err => log('ERROR: ' + recPath, err));
	recFile.once('close', () => {
		finalize();
		if (recFile.errored || !recFile.writableFinished) {
			// Keep the reservation so an ongoing broadcast can resume on the next tick.
			recording = recording.filter(item => item !== program);
			persistRecording();
			return;
		}
		persistCompletion(completedProgram, program);
	});

	// 状態更新
	persistRecording();

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
	function finalize() {
		if (completedProgram) return;
		delete program.pid;
		delete program._stream;
		delete program._abortController;
		completedProgram = { ...program };

		stream.unpipe();
		if (!abortController.signal.aborted) {
			abortController.abort();
		}

		if (!recFile.destroyed) recFile.end();
	}
}

function persistCompletion(completedProgram, liveProgram, sequence) {
	try {
		sequence ??= journal.append(completedProgram);
		const remainingReserves = journal.finish(sequence, () => finishRecording(store, completedProgram));
		if (completedProgram.isManualReserved) reserves = remainingReserves;
	} catch (error) {
		log('ERROR: recording metadata save failed: ' + error.message);
		setTimeout(() => persistCompletion(completedProgram, liveProgram, sequence), 1000);
		return;
	}
	if (liveProgram) recording = recording.filter(item => item !== liveProgram);
	else recovering = recovering.filter(entry => entry.sequence !== sequence);
	log('WRITE: recorded, recording');

	// ポストプロセス
	if (config.recordedCommand) {
		const postProcess = child_process.spawn(config.recordedCommand, [completedProgram.recorded, JSON.stringify(completedProgram)]);
		log('SPAWN: ' + config.recordedCommand + ' (pid=' + postProcess.pid + ')');
	}

	// Gotify
	if (gotifyNotifier && config.operGotifyFormat.end) {
		notifyGotify(
			config.operGotifyFormat.end
				.replace('<id>', completedProgram.id)
				.replace('<type>', completedProgram.channel.type)
				.replace('<channel>', ((completedProgram.channel.type === 'CS') ? completedProgram.channel.sid : completedProgram.channel.channel))
				.replace('<title>', completedProgram.title)
				.replace('<fullTitle>', completedProgram.fullTitle)
				.replace('<channelname>', completedProgram.channel.name)
				.replace('<date>', dateFormat(new Date(completedProgram.start), "mm/dd"))
				.replace('<starttime>', dateFormat(new Date(completedProgram.start), "h:MM"))
				.replace('<endtime>', dateFormat(new Date(completedProgram.end), "h:MM"))
		);
	}

	log('FIN: ' + printProgram(completedProgram));
	exitWhenDrained();
}

// 録画中止
function stopRecording(request) {

	const program = recording.find(item => sameAiring(item, request));

	if (program && program._abortController) {
		program._abortController.abort();
	}
}

// ストレージチェック
function storageChecker() {

	fs.statfs(config.recordedDir, (err, info) => {
		if(err) {
			return;
		}

		const freeMB = info.bavail * info.bsize / 1024 / 1024;
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
				recording.forEach(stopRecording);
			} else if (storageLowSpaceAction === "remove") {
				// 削除
				try {
					store.transaction(() => {
						const history = store.read('recorded');
						for (const [index, program] of history.entries()) {
							try { chinachu.removeRecordingFile(config.recordedDir, program.recorded); }
							catch (error) {
								log('ERROR: recording removal failed: ' + error.message);
								continue;
							}
							history.splice(index, 1);
							store.replace('recorded', history);
							log('WRITE: recorded');
							break; // Check free space again before deleting another file.
						}
					});
				} catch (error) { log('ERROR: recording metadata save failed: ' + error.message); }
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

// データ更新監視
function onStateChange(name) {
	if (shuttingDown) return;
	if (name === 'reserves') {
		reserves = store.read('reserves');
		if (recording.length > 0) {
			reserves.forEach(recordingUpdater);
			persistRecording();
		}
	} else if (name === 'recording' && recordingPublished) {
		store.read('recording').filter(program => program.abort).forEach(stopRecording);
	}
}

function startOperator() {
	try {
		store ??= new StateStore(__dirname);
		store.db.exec('PRAGMA busy_timeout = 0');
		journal ??= new RecordingJournal(store, __dirname);
		store.transaction(() => {
			reserves = store.read('reserves');
			startupRecordingRevision = store.revision('recording').revision;
			recovering = journal.pending();
			store.watch(onStateChange);
		}, false);
	} catch (error) {
		if ((error.errcode & 255) !== 5) {
			console.error(error);
			process.exit(1);
			return;
		}
		log('Waiting to read reservations: ' + error.message);
		setTimeout(startOperator, 1000);
		return;
	}
	for (const { program, sequence } of recovering) persistCompletion(program, null, sequence);
	persistRecording();
	setInterval(checkReserves, 3000);
	setInterval(checkServices, 6000);
}

startOperator();
