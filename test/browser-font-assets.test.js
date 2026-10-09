'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'web/lib/notosansjp');
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'vendor.json'), 'utf8'));
const font = Object.keys(metadata.files).find(name => name.endsWith('.woff2'));
const stylesheet = path.join(directory, metadata.stylesheet.file);
const vendorScript = path.join(root, 'scripts/vendor-browser-libraries.py');

describe('bundled Japanese fonts', function () {
	it('loads the stylesheet from the app and references only bundled font files', function () {
		const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
		assert.ok(html.includes('./lib/notosansjp/' + metadata.stylesheet.file));
		const urls = Array.from(fs.readFileSync(stylesheet, 'utf8').matchAll(/url\(([^)]+)\)/g), match => match[1]);
		assert.ok(urls.length > 0);
		for (const url of urls) {
			assert.match(url, /^\.\/[\w.-]+\.woff2$/);
			assert.ok(fs.existsSync(path.join(directory, url)));
		}
	});

	it('verifies the stylesheet, font binaries and license without downloading', function () {
		const result = spawnSync('python3', [vendorScript, '--verify-fonts'], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
	});

	it('rejects a damaged font instead of accepting its recorded version', function () {
		const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-font-integrity-'));
		try {
			const target = path.join(temporary, 'notosansjp');
			fs.mkdirSync(target);
			fs.copyFileSync(path.join(directory, 'vendor.json'), path.join(target, 'vendor.json'));
			fs.copyFileSync(stylesheet, path.join(target, metadata.stylesheet.file));
			fs.writeFileSync(path.join(target, font), 'damaged font');
			const python = 'import importlib.util, pathlib, sys\n' +
				'spec = importlib.util.spec_from_file_location("vendor", sys.argv[1])\n' +
				'vendor = importlib.util.module_from_spec(spec)\n' +
				'spec.loader.exec_module(vendor)\n' +
				'vendor.LIB = pathlib.Path(sys.argv[2])\n' +
				'vendor.verify_fonts()\n';
			const result = spawnSync('python3', ['-B', '-c', python, vendorScript, temporary], { encoding: 'utf8' });
			assert.notEqual(result.status, 0);
			assert.ok(result.stderr.includes('Integrity mismatch: ' + font), result.stderr);
		} finally {
			fs.rmSync(temporary, { recursive: true, force: true });
		}
	});
});

describe('WUI static asset responses', function () {
	let handler;
	before(function () {
		// Load the real HTTP handler without starting Mirakurun or the WUI service.
		const source = fs.readFileSync(path.join(root, 'app-wui.js'), 'utf8').replace(/\r\n/g, '\n');
		const start = source.indexOf('function httpServerMain(');
		const end = source.indexOf('\n//\n// socket.io server', start);
		assert.ok(start >= 0 && end > start);
		handler = vm.runInNewContext(source.slice(start, end) + '\nhttpServerMain;', {
			fs, path, config: {}, log() {}, console
		});
	});

	function request(url, headers = {}) {
		const req = {
			method: 'HEAD', url, client: { remoteAddress: '127.0.0.1' },
			httpVersionMajor: 1, httpVersionMinor: 1, headers: { host: 'localhost', ...headers }
		};
		const response = new http.ServerResponse(req);
		handler(req, response, {});
		return response;
	}

	it('serves WOFF2 with its MIME type and one-day private caching', function () {
		const response = request('/lib/notosansjp/' + font);
		assert.equal(response.statusCode, 200);
		assert.equal(response.getHeader('Content-Type'), 'font/woff2');
		assert.equal(response.getHeader('Cache-Control'), 'private, max-age=86400');
	});

	it('ignores Range on HEAD and preserves font caching for conditional responses', function () {
		const head = request('/lib/notosansjp/' + font, { range: 'bytes=0-9' });
		assert.equal(head.statusCode, 200);
		assert.equal(head.getHeader('Content-Length'), fs.statSync(path.join(directory, font)).size);
		assert.equal(head.getHeader('Content-Range'), undefined);
		assert.equal(head.getHeader('Cache-Control'), 'private, max-age=86400');
		const modified = fs.statSync(path.join(directory, font)).mtime.toUTCString();
		const conditional = request('/lib/notosansjp/' + font, { 'if-modified-since': modified });
		assert.equal(conditional.statusCode, 304);
		assert.equal(conditional.getHeader('Cache-Control'), 'private, max-age=86400');
	});

	it('keeps application CSS subject to revalidation', function () {
		const response = request('/ui.css');
		assert.equal(response.statusCode, 200);
		assert.equal(response.getHeader('Cache-Control'), 'no-cache');
	});
});
