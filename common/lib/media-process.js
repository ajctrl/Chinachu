'use strict';

const childProcess = require('node:child_process');

// Size is embedded in a filtergraph for VAAPI, so accept only bounded integers.
function validateVideoSize(size) {
	if (size === undefined) return null;
	const match = typeof size === 'string' && size.match(/^([1-9][0-9]{0,3})x([1-9][0-9]{0,3})$/);
	if (!match || match[0] !== size || Number(match[1]) > 8192 || Number(match[2]) > 8192 ||
		Number(match[1]) * Number(match[2]) > 8192 * 4320) {
		throw new Error('Invalid video size');
	}
	return size;
}

// execFile does not forward stdio. Use spawn to inherit an already secured,
// seekable input as fd 3 while retaining bounded output and execution time.
function execFileWithFd(command, args, fd, options, callback, launcher = childProcess) {
	const child = launcher.spawn(command, args, {
		stdio: ['pipe', 'pipe', 'pipe', fd], timeout: options.timeout, killSignal: 'SIGKILL'
	});
	const output = [[], []];
	const sizes = [0, 0];
	let failure;
	[child.stdout, child.stderr].forEach((stream, index) => {
		stream.on('data', chunk => {
			if (failure) return;
			sizes[index] += chunk.length;
			if (sizes[index] > options.maxBuffer) {
				failure = new Error('Media process output exceeded maxBuffer');
				child.kill('SIGKILL');
				return;
			}
			output[index].push(chunk);
		});
	});
	child.once('error', error => { failure = error; });
	child.once('close', (code, signal) => {
		if (!failure && (code !== 0 || signal)) failure = new Error('Media process failed: ' + (signal || code));
		const encoding = options.encoding || 'utf8';
		callback(failure || null, Buffer.concat(output[0]).toString(encoding), Buffer.concat(output[1]).toString(encoding));
	});
	return child;
}

module.exports = { execFileWithFd, validateVideoSize };
