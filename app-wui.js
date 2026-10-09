/*!
 *  Chinachu WebUI Server Service (chinachu-wui)
 *
 *  Copyright (c) 2016 Yuki KAN and Chinachu Project Contributors
 *  https://chinachu.moe/
**/
'use strict';

const CONFIG_FILE = __dirname + '/config.json';
const RULES_FILE = __dirname + '/rules.json';
const EXCLUDES_FILE = __dirname + '/excludes.json';
const RESERVES_DATA_FILE = __dirname + '/data/reserves.json';
const SCHEDULE_DATA_FILE = __dirname + '/data/schedule.json';
const RECORDING_DATA_FILE = __dirname + '/data/recording.json';
const RECORDED_DATA_FILE = __dirname + '/data/recorded.json';
const SCHEDULER_LOG_FILE = __dirname + '/log/scheduler';

// Load Config
const pkg = require("./package.json");
const config = require(CONFIG_FILE);

// Modules
const path = require('path');
const fs = require('fs');
const util = require('util');
const child_process = require('child_process');
const querystring = require('querystring');
const vm = require('vm');
const os = require('os');
const zlib = require('zlib');
const events = require('events');
const http = require('http');
const https = require('https');
const auth = require('http-auth');
const { Server } = require('socket.io');
const chinachu = require('chinachu-common');
const mirakurun = new (require("mirakurun").default)();
const configStore = require('./lib/config-store');
const excludesStore = require('./lib/excludes-store');
const { watchExclusionRules } = require('./lib/exclusion-rule-watcher');
const { log } = require('./lib/logger');
const { configureMirakurunClient } = require('./lib/mirakurun-client');
const { createBasicAuthMiddleware } = require('./lib/socket-auth');
const { createRequestGuard, listenAddress, readBody, isLoopback } = require('./lib/http-security');
const requestGuard = createRequestGuard(config);

// Directory Checking
if (!fs.existsSync('./data/') || !fs.existsSync('./log/') || !fs.existsSync('./web/')) {
	console.error('FATAL: Current working directory is invalid.');
	process.exit(1);
}

const apps = require("./processes.json").apps;

const WUI_LOG_FILE = !!process.env.pm_id ? apps[0].out_file : (__dirname + '/log/wui');
const OPERATOR_LOG_FILE = !!process.env.pm_id ? apps[1].out_file : (__dirname + '/log/operator');
const OPERATOR_PID_FILE = (() => {
	if (process.env.pm_id) {
		const jlist = JSON.parse(child_process.execSync("pm2 jlist"));
		const proc = jlist.find(_proc => _proc.name === "chinachu-operator");
		return proc.pm2_env.pm_pid_path;
	} else {
		return "/var/run/chinachu-operator.pid";
	}
})();

// SIGQUIT
process.on('SIGQUIT', () => { setTimeout(() => process.exit(0), 0); });

// Uncaught Exception
process.on('uncaughtException', err => {

	if (err.toString() === 'Error: read ECONNRESET') {
		log('ECONNRESET');
		return;
	}

	console.error('uncaughtException: ' + err);
});

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

mirakurun.userAgent = `Chinachu/${pkg.version} (wui)`;
mirakurun.priority = 0;

console.info(mirakurun);

// etc.
const timer = {};
const emptyFunction = function () {};
const status = {
	version: pkg.version,
	connectedCount: 0,
	feature: {
		previewer: true,
		streamer: true,
		filer: true,
		configurator: true,
		normalizationForm: config.normalizationForm
	},
	system: {
		core: os.cpus().length,
		platform: os.platform(),
		release: os.release(),
		arch: os.arch(),
		node: process.version
	},
	operator: {
		alive: false,
		pid: null
	},
	wui: {
		alive: false,
		pid: null
	}
};

// HTTPS
var tlsOption = null;
var tlsEnabled = !!config.wuiTlsKeyPath && !!config.wuiTlsCertPath;
if (tlsEnabled) {
	tlsOption = {
		key : fs.readFileSync(config.wuiTlsKeyPath),
		cert: fs.readFileSync(config.wuiTlsCertPath),
		secureProtocol: 'SSLv23_method',
		secureOptions: require('constants').SSL_OP_NO_SSLv2 | require('constants').SSL_OP_NO_SSLv3
	};

	// 秘密鍵または pfx のパスフレーズを表す文字列
	if (config.wuiTlsPassphrase) { tlsOption.passphrase = config.wuiTlsPassphrase; }

	if (config.wuiTlsRequestCert) { tlsOption.requestCert = config.wuiTlsRequestCert; }
	if (config.wuiTlsRejectUnauthorized) { tlsOption.rejectUnauthorized = config.wuiTlsRejectUnauthorized; }
	if (config.wuiTlsCaPath) { tlsOption.ca = [ fs.readFileSync(config.wuiTlsCaPath) ]; }
}

// Basic Auth
let basic = null;
const basicAuthEnabled = config.wuiUsers && (config.wuiUsers.length > 0);
if (basicAuthEnabled) {
	basic = auth.basic({
		realm: 'Authentication.'
	}, function (username, password, callback) {
		callback(config.wuiUsers.indexOf([username, password].join(':')) !== -1);
	});
}

// Open Server
// Keep the old port as a migration fallback, using the same authenticated server.
const legacyPort = config.wuiOpenServer === true ? (config.wuiOpenPort || 20772) : null;

var rules     = [];
var schedule  = [];
var reserves  = [];
var recording = [];
var recorded  = [];

// Init HTTP Server
let server;

if (tlsEnabled) {
	if (basicAuthEnabled) {
		server = https.createServer(tlsOption, basic.check(httpServer));
	} else {
		server = https.createServer(tlsOption, httpServer);
	}
} else {
	if (basicAuthEnabled) {
		server = http.createServer(basic.check(httpServer));
	} else {
		server = http.createServer(httpServer);
	}
}

if (config.wuiPort || legacyPort) {
	server.requestTimeout = 15000;
	server.headersTimeout = 10000;
	server.listen(config.wuiPort || legacyPort, listenAddress(config), function () {
		log((tlsEnabled ? 'HTTPS' : 'HTTP') + ' proxy backend listening on ' + util.inspect(server.address()));
	});
}

// HTTP Server
function httpServer(req, res) {
	const update = ['POST', 'PUT', 'DELETE'].includes(req.method);
	const error = requestGuard(req, update);
	if (error) {
		res.writeHead(error, { 'Content-Type': 'text/plain', Connection: 'close' });
		return res.end(error + '\n');
	}
	if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
		res.writeHead(405, { 'Content-Type': 'text/plain' });
		return res.end('405 Method Not Allowed\n');
	}
	function dispatch(text) {
		let query;
		try {
			query = /^\s*\{/.test(text) ? JSON.parse(text) : querystring.parse(text);
		} catch (_) {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			return res.end('400 Bad Request\n');
		}
		// Method overrides used to permit writes from images and cross-site GETs.
		if (Object.hasOwn(query, 'method') || Object.hasOwn(query, '_method')) {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			return res.end('400 Bad Request\n');
		}
		httpServerMain(req, res, query);
	}
	if (update) return readBody(req, res, dispatch);
	try {
		dispatch(new URL(req.url, 'http://localhost').search.slice(1));
	} catch (_) {
		if (res.headersSent) return res.destroy();
		res.writeHead(400, { 'Content-Type': 'text/plain' });
		res.end('400 Bad Request\n');
	}
}

function httpServerMain(req, res, query) {
	var remoteAddress = req.client.remoteAddress;

	if (config.wuiXFF === true && isLoopback(remoteAddress) && req.headers['x-forwarded-for']) {
		remoteAddress = req.headers['x-forwarded-for'].split(',')[0];
	}

	if (/^\:\:ffff\:[^\:]+/.test(remoteAddress) === true) {
		remoteAddress = remoteAddress.split(':')[3];
	}

	// http request logging
	var logRequest = function (statusCode) {
		log([
			statusCode,
			req.method + ':' + req.url,
			remoteAddress,
			'"' + (req.headers['user-agent'] || '-') + '"'
		].join(' '));
	};

	// serve static file
	var location = req.url;
	if (location.match(/(\?.*)$/) !== null) { location = location.match(/^(.+)\?.*$/)[1]; }
	if (location.match(/\/$/) !== null) { location += 'index.html'; }

	var filename = path.join('./web/', location);

	var ext = null;
	if (filename.match(/[^\/]+\..+$/) !== null) {
		ext = filename.split('.').pop();
	}

	// エラーレスポンス用
	var resErr = function (code) {

		if (res.headersSent === false) {
			res.writeHead(code, {'content-type': 'text/plain'});

			if (req.method !== 'HEAD') {
				switch (code) {
				case 400:
					res.write('400 Bad Request\n');
					break;
				case 402:
					res.write('402 Payment Required\n');
					break;
				case 401:
					res.write('401 Unauthorized\n');
					break;
				case 403:
					res.write('403 Forbidden\n');
					break;
				case 404:
					res.write('404 Not Found\n');
					break;
				case 405:
					res.write('405 Method Not Allowed\n');
					break;
				case 406:
					res.write('406 Not Acceptable\n');
					break;
				case 407:
					res.write('407 Proxy Authentication Required\n');
					break;
				case 408:
					res.write('408 Request Timeout\n');
					break;
				case 409:
					res.write('409 Conflict\n');
					break;
				case 410:
					res.write('410 Gone\n');
					break;
				case 411:
					res.write('411 Length Required\n');
					break;
				case 412:
					res.write('412 Precondition Failed\n');
					break;
				case 413:
					res.write('413 Request Entity Too Large\n');
					break;
				case 414:
					res.write('414 Request-URI Too Long\n');
					break;
				case 415:
					res.write('415 Unsupported Media Type\n');
					break;
				case 416:
					res.write('416 Requested Range Not Satisfiable\n');
					break;
				case 417:
					res.write('417 Expectation Failed\n');
					break;
				case 429:
					res.write('429 Too Many Requests\n');
					break;
				case 451:
					res.write('451 Unavailable For Legal Reasons\n');
					break;
				case 500:
					res.write('500 Internal Server Error\n');
					break;
				case 501:
					res.write('501 Not Implemented\n');
					break;
				case 502:
					res.write('502 Bad Gateway\n');
					break;
				case 503:
					res.write('503 Service Unavailable\n');
					break;
				}
			}
			logRequest(code);
		} else {
			logRequest(res.statusCode + '(!' + code + ')');
		}
		res.end();
	};

	var writeHead = function (code) {
		var type = 'text/plain';

		if (ext === 'html') { type = 'text/html'; }
		if (ext === 'js') { type = 'text/javascript'; }
		if (ext === 'css') { type = 'text/css'; }
		if (ext === 'ico') { type = 'image/vnd.microsoft.icon'; }
		if (ext === 'cur') { type = 'image/vnd.microsoft.icon'; }
		if (ext === 'png') { type = 'image/png'; }
		if (ext === 'gif') { type = 'image/gif'; }
		if (ext === 'jpg') { type = 'image/jpeg'; }
		if (ext === 'woff2') { type = 'font/woff2'; }
		if (ext === 'f4v') { type = 'video/mp4'; }
		if (ext === 'm4v') { type = 'video/mp4'; }
		if (ext === 'mp4') { type = 'video/mp4'; }
		if (ext === 'flv') { type = 'video/x-flv'; }
		if (ext === 'webm') { type = 'video/webm'; }
		if (ext === 'm2ts') { type = 'video/MP2T'; }
		if (ext === 'asf') { type = 'video/x-ms-asf'; }
		if (ext === 'json') { type = 'application/json; charset=utf-8'; }
		if (ext === 'xspf') { type = 'application/xspf+xml'; }

		var head = {
			'Content-Type'             : type,
			'Server'                   : 'Chinachu (Node)',
			'Cache-Control'            : res.getHeader('Cache-Control') || 'no-cache',
			'X-Content-Type-Options'   : 'nosniff',
			'X-Frame-Options'          : 'SAMEORIGIN',
			'X-UA-Compatible'          : 'IE=Edge,chrome=1',
			'X-XSS-Protection'         : '1; mode=block'
		};

		res.writeHead(code, head);
	};

	// ヘッダの確認
	if (!req.headers.host) { return resErr(400); }

	var responseStatic = function () {

		if (fs.existsSync(filename) === false) { return resErr(404); }

		if (req.method !== 'HEAD' && req.method !== 'GET') {
			res.setHeader('Allow', 'HEAD, GET');
			return resErr(405);
		}

		if (['ico', 'png', 'woff2'].indexOf(ext) !== -1) {
			res.setHeader('Cache-Control', 'private, max-age=86400');
		}

		var fstat = fs.statSync(filename);

		res.setHeader('Accept-Ranges', 'bytes');
		res.setHeader('Last-Modified', new Date(fstat.mtime).toUTCString());

		if (req.headers['if-modified-since'] && req.headers['if-modified-since'] === new Date(fstat.mtime).toUTCString()) {
			writeHead(304);
			logRequest(304);
			return res.end();
		}

		var range = {};
		// Range applies to GET only. Validate before committing response headers.
		if (req.method === 'GET' && req.headers.range) {
			var match = /^bytes=([0-9]*)-([0-9]*)$/.exec(req.headers.range);
			var invalidRange = function () {
				res.setHeader('Content-Range', 'bytes */' + fstat.size);
				return resErr(416);
			};
			if (!match || match[0] !== req.headers.range || (!match[1] && !match[2]) || fstat.size === 0) {
				return invalidRange();
			}
			var first = Number(match[1]);
			var last = Number(match[2]);
			if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return invalidRange();
			if (!match[1]) {
				if (last === 0) return invalidRange();
				range.start = Math.max(0, fstat.size - last);
				range.end = fstat.size - 1;
			} else {
				range.start = first;
				range.end = match[2] ? Math.min(last, fstat.size - 1) : fstat.size - 1;
				if (range.start >= fstat.size || range.start > range.end) return invalidRange();
			}

			res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + fstat.size);
			res.setHeader('Content-Length', range.end - range.start + 1);

			writeHead(206);
			logRequest(206);
		} else {
			res.setHeader('Content-Length', fstat.size);

			writeHead(200);
			logRequest(200);
		}

		if (req.method === 'GET') {
			var stream = fs.createReadStream(filename, range);
			stream.once('error', function () { res.destroy(); });
			res.once('close', function () { stream.destroy(); });
			stream.pipe(res);
		} else {
			res.end();
		}
	};

	var responseApi = function () {
		var dir  = location.replace('/api/', '').replace(/\.[a-z0-9]+$/, '');
		var dirs = dir.split('/');
		var addr = dir.replace(/^[^\/]+\/?/, '/');

		if (dirs[0] === 'index.html') { return resErr(400); }

		var resourceFile = './api/resource-' + dirs[0] + '.json';

		if (fs.existsSync(resourceFile) === false) { return resErr(404); }

		fs.readFile(resourceFile, function (err, json) {
			if (err) { return resErr(500); }

			var r;
			try {
				r = JSON.parse(json);
			} catch (e) {
				console.error(e);
				return resErr(500);
			}

			var pattern;
			var param;
			var target = null;

			var k, i, l;
			for (k in r) {
				if (r.hasOwnProperty(k)) {
					pattern = new RegExp(k.replace(/:[^\/]+/g, '([^/]+)'));

					if (addr.match(pattern) !== null) {
						target = r[k];
						param  = {};

						if (k.match(pattern).length > 1) {
							for (i = 1, l = k.match(pattern).length; i < l; i++) {
								param[k.match(pattern)[i].replace(':', '')] = addr.match(pattern)[i];
							}
						}
					}
				}
			}

			if (target === null) { return resErr(400); }
			if (target.methods.indexOf(req.method.toLowerCase()) === -1) {
				res.setHeader('Allow', target.methods.join(', ').toUpperCase());
				return resErr(405);
			}
			if (target.types.indexOf(ext) === -1) { return resErr(415); }

			var scriptFile = './api/script-' + target.script + '.vm.js';

			if (fs.existsSync(scriptFile) === false) { return resErr(501); }

			res._end = res.end;
			res.end  = function () {
				res.end = res._end;
				res.end.apply(res, arguments);
				res.emit('end');
			};

			var acceptEncoding = req.headers['accept-encoding'];
			if (!acceptEncoding) { acceptEncoding = ''; }
			var encoding = '';

			if (acceptEncoding.match(/deflate/)) {
				encoding = 'deflate';
			}

			if (req.headers['user-agent'] && req.headers['user-agent'].match(/Trident/)) {
				encoding = '';
			}

			var sandbox = {
				request      : req,
				response     : res,
				path         : path,
				fs           : fs,
				URL          : URL,
				AbortController: AbortController,
				util         : util,
				log          : log,
				child_process: child_process,
				Buffer       : Buffer,
				zlib         : zlib,
				chinachu     : chinachu,
				mirakurun    : mirakurun,
				config       : config,
				configStore  : configStore,
				excludesStore: excludesStore,
				define: {
					CONFIG_FILE        : CONFIG_FILE,
					RULES_FILE         : RULES_FILE,
					EXCLUDES_FILE      : EXCLUDES_FILE,
					RESERVES_DATA_FILE : RESERVES_DATA_FILE,
					SCHEDULE_DATA_FILE : SCHEDULE_DATA_FILE,
					RECORDING_DATA_FILE: RECORDING_DATA_FILE,
					RECORDED_DATA_FILE : RECORDED_DATA_FILE,
					OPERATOR_LOG_FILE  : OPERATOR_LOG_FILE,
					WUI_LOG_FILE       : WUI_LOG_FILE,
					SCHEDULER_LOG_FILE : SCHEDULER_LOG_FILE,
					OPERATOR_PID_FILE  : OPERATOR_PID_FILE
				},
				data: {
					rules    : rules,
					schedule : schedule,
					reserves : reserves,
					recording: recording,
					recorded : recorded,
					status   : status
				},
				setInterval: setInterval,
				setTimeout : setTimeout,
				clearInterval: clearInterval,
				clearTimeout : clearTimeout,

				children: []
			};

			var isClosed = false;
			var cleanup;

			sandbox.request.query    = query;
			sandbox.request.param    = param;
			sandbox.request.type     = ext;
			sandbox.request.encoding = encoding;
			sandbox.response.head    = writeHead;
			sandbox.response.error   = function (code) {

				isClosed = true;

				resErr(code);

				cleanup();
			};

			// DEPRECATED
			sandbox.response.exit = function (data, encoding) {

				log('response.exit is DEPRECATED: ' + scriptFile);

				try {
					res.end(data, encoding);
				} catch (e) {
					log(e);
				}
			};

			var onResponseClose = function () {

				if (!isClosed) {
					isClosed = true;

					logRequest(res.statusCode);
				}

				cleanup();
			};

			cleanup = function () {

				setTimeout(function () {

					sandbox.children.forEach(function (child) {
						if (child.exitCode != null || child.signalCode != null) return;

						log('child process killing: PID=' + child.pid);

						try {
							child.kill('SIGKILL');
						} catch (e) {
						}
					});

					sandbox = null;
				}, 1000);

				res.removeListener('close', onResponseClose);
				res.removeListener('finish', onResponseClose);

				cleanup = emptyFunction;
			};

			res.on('close', onResponseClose);
			res.on('finish', onResponseClose);

			try {
				vm.runInNewContext(fs.readFileSync(scriptFile), sandbox, scriptFile);
			} catch (ee) {
				if (!isClosed) {
					resErr(500);
					isClosed = true;
				}

				console.error(ee);
			}

			return;
		});

		return;
	};

	// 静的ファイルまたはAPIレスポンスの分岐
	if (req.url.match(/^\/api\/.*$/) === null) {
		if (/^web\//.test(filename) === false) { return resErr(400); }
		if (fs.existsSync(filename) === false) { return resErr(404); }

		responseStatic();
	} else {
		responseApi();
	}
}

//
// socket.io server
//

var ios = new events.EventEmitter();
ios.setMaxListeners(0);

function iosAddEventListner(io, eventName) {
	return ios.on(eventName, function () {
		var i, l, args = [];
		for (i = 0, l = arguments.length; i < l; i++) {
			args.push(arguments[i]);
		}
		io.emit.apply(io, [eventName].concat(args));
	});
}

function ioAddListener(server) {
	var io = new Server(server, { allowRequest: (req, done) => done(null, !requestGuard(req)) });

	if (basicAuthEnabled) {
		io.use(createBasicAuthMiddleware(config.wuiUsers || []));
	}

	io.on('connection', ioServer);

	// listen event
	iosAddEventListner(io, 'status');
	iosAddEventListner(io, 'notify-rules');
	iosAddEventListner(io, 'notify-exclusion-rules');
	iosAddEventListner(io, 'notify-reserves');
	iosAddEventListner(io, 'notify-recording');
	iosAddEventListner(io, 'notify-recorded');
	iosAddEventListner(io, 'notify-schedule');

	return io;
}

ioAddListener(server);

function ioServer(socket) {
	ioServerMain(socket);
}

function ioServerMain(socket) {
	++status.connectedCount;

	socket.on('disconnect', ioServerSocketOnDisconnect);

	// broadcast
	ios.emit('status', status);

	socket.emit('notify-rules');
	socket.emit('notify-exclusion-rules');
	socket.emit('notify-reserves');
	socket.emit('notify-recording');
	socket.emit('notify-recorded');
	socket.emit('notify-schedule');
}

function ioServerSocketOnDisconnect(socket) {
	--status.connectedCount;
	ios.emit('status', status);
}

// ファイル更新監視: ./data/rules.json
chinachu.jsonWatcher(
	RULES_FILE,
	function _onUpdated(err, data, mes) {
		if (err) {
			console.error(err);
			return;
		}

		rules = data;
		ios.emit('notify-rules');
		log(mes);
	},
	{ create: [], now: true }
);

// Common exclusions include legacy config rules until excludes.json exists.
watchExclusionRules(EXCLUDES_FILE, CONFIG_FILE, function () {
	ios.emit('notify-exclusion-rules');
});

// ファイル更新監視: ./data/schedule.json
chinachu.jsonWatcher(
	SCHEDULE_DATA_FILE,
	function _onUpdated(err, data, mes) {
		if (err) {
			console.error(err);
			return;
		}

		schedule = data;
		ios.emit('notify-schedule');
		log(mes);
	},
	{ create: [], now: true }
);

// ファイル更新監視: ./data/reserves.json
chinachu.jsonWatcher(
	RESERVES_DATA_FILE,
	function _onUpdated(err, data, mes) {
		if (err) {
			console.error(err);
			return;
		}

		reserves = data;
		ios.emit('notify-reserves');
		log(mes);
	},
	{ create: [], now: true }
);

// ファイル更新監視: ./data/recording.json
chinachu.jsonWatcher(
	RECORDING_DATA_FILE,
	function _onUpdated(err, data, mes) {
		if (err) {
			console.error(err);
			return;
		}

		recording = data;
		ios.emit('notify-recording');
		log(mes);
	},
	{ create: [], now: true }
);

// ファイル更新監視: ./data/recorded.json
chinachu.jsonWatcher(
	RECORDED_DATA_FILE,
	function _onUpdated(err, data, mes) {
		if (err) {
			console.error(err);
			return;
		}

		recorded = data;
		ios.emit('notify-recorded');
		log(mes);
	},
	{ create: [], now: true }
);

// プロセス監視
function processChecker() {

	ios.emit('status', status);

	var c = chinachu.createCountdown(1, chinachu.createTimeout(processChecker, 5000));

	if (fs.existsSync(OPERATOR_PID_FILE) === true) {
		fs.readFile(OPERATOR_PID_FILE, function (err, pid) {

			if (err) { return c.tick(); }

			pid = pid.toString().trim();

			child_process.exec('ps h -p ' + pid + ' -o %cpu,rss', function (err, stdout) {

				if (stdout === '') {
					status.operator.alive = false;
					status.operator.pid   = null;
				} else {
					status.operator.alive = true;
					status.operator.pid   = parseInt(pid, 10);
				}

				c.tick();
			});
		});
	} else {
		status.operator.alive = false;
		status.operator.pid   = null;

		c.tick();
	}
}
processChecker();
