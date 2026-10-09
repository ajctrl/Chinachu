(function() {
	function stopChild(child) {
		if (child && child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
	}

	var program = chinachu.getProgramById(request.param.id, data.recording);

	if (program === null) return response.error(404);

	if (!data.status.feature.streamer) return response.error(403);

	var videoSize;
	try { videoSize = chinachu.validateVideoSize(request.query.s); }
	catch (_) { return response.error(400); }

	if (!program.pid) return response.error(503);

	if (program.tuner && program.tuner.isScrambling) return response.error(409);

	var fd;
	try { fd = chinachu.openRecordingFile(config.recordedDir, program.recorded); }
	catch (error) { log(error); return response.error(error.code === 'ENOENT' ? 410 : 403); }
	try {

		switch (request.type) {
			case 'xspf':
				response.setHeader('content-disposition', 'attachment; filename="' + program.id + '.xspf"');
				response.head(200);

				var ext    = request.query.ext || 'm2ts';
				var prefix = request.query.prefix || '';

				var target = prefix + 'watch.' + ext + new URL(request.url, 'http://localhost').search;
				var title = program.title
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/&/g, "&amp;")
					.replace(/"/g, "&quot;");

				response.write('<?xml version="1.0" encoding="UTF-8"?>\n');
				response.write('<playlist version="1" xmlns="http://xspf.org/ns/0/">\n');
				response.write('<trackList>\n');
				response.write('<track>\n<location>' + target.replace(/&/g, '&amp;') + '</location>\n');
				response.write('<title>' + title + '</title>\n</track>\n');
				response.write('</trackList>\n');
				response.write('</playlist>\n');

				response.end();
				return;

			case 'm2ts':
			case 'mp4':
				response.head(200);

				log('[streamer] streaming: ' + program.recorded);

				var d = {
					ss   : request.query.ss     || null, //start(seconds)
					t    : request.query.t      || null, //duration(seconds)
					s    : videoSize, //size(WxH)
					f    : request.query.f      || null, //format
					'c:v': request.query['c:v'] || null, //vcodec
					'c:a': request.query['c:a'] || null, //acodec
					'b:v': request.query['b:v'] || null, //bitrate
					'b:a': request.query['b:a'] || null, //ab
					ar   : request.query.ar     || null, //ar(Hz)
					r    : request.query.r      || null  //rate(fps)
				};

				switch (request.type) {
					case 'm2ts':
						d.f = 'mpegts';
						d['c:v'] = d['c:v'] || 'copy';
						d['c:a'] = d['c:a'] || 'copy';
						break;
					case 'mp4':
						d.f = 'mp4';
						d['c:v'] = d['c:v'] || 'h264';
						d['c:a'] = d['c:a'] || 'aac';
						break;
				}

				var args = [];

				if (!request.query.debug) args.push('-v', '0');

				if (config.vaapiEnabled === true) {
					args.push("-vaapi_device", config.vaapiDevice || '/dev/dri/renderD128');
					args.push("-hwaccel", "vaapi");
					args.push("-hwaccel_output_format", "yuv420p");
				}

				if (d.ss) args.push('-ss', (parseInt(d.ss, 10) - 1) + '');

				args.push('-re', '-i', (!d.ss) ? 'pipe:0' : '/proc/self/fd/3');

				if (d.t) { args.push('-t', d.t); }

				args.push('-threads', '0');

				if (config.vaapiEnabled === true) {
					let scale = "";
					if (d.s) {
						let [width, height] = d.s.split("x");
						scale = `,scale_vaapi=w=${width}:h=${height}`;
					}
					args.push("-vf", `format=nv12|vaapi,hwupload,deinterlace_vaapi${scale}`);
					args.push("-aspect", "16:9")
				} else {
					args.push('-filter:v', 'yadif');
				}

				if (d['c:v']) {
					if (config.vaapiEnabled === true) {
						if (d['c:v'] === "mpeg2video") {
							d['c:v'] = "mpeg2_vaapi";
						}
						if (d['c:v'] === "h264") {
							d['c:v'] = "h264_vaapi";
						}
					}
					args.push('-c:v', d['c:v']);
				}
				if (d['c:a']) args.push('-c:a', d['c:a']);

				if (d.s) {
					if (config.vaapiEnabled !== true) {
						args.push('-s', d.s);
					}
				}
				if (d.r)  args.push('-r', d.r);
				if (d.ar) args.push('-ar', d.ar);

				if (d['b:v']) {
					if (d['c:v'] !== 'vp8_vaapi') {
						args.push('-b:v', d['b:v']);
					}
					args.push('-minrate:v', d['b:v'], '-maxrate:v', d['b:v']);
				}
				if (d['b:a']) {
					args.push('-b:a', d['b:a'], '-minrate:a', d['b:a'], '-maxrate:a', d['b:a']);
				}

				if (d['c:v'] === 'h264') {
					args.push('-profile:v', 'baseline');
					args.push('-preset', 'ultrafast');
					args.push('-tune', 'fastdecode,zerolatency');
				}
				if (d['c:v'] === 'h264_vaapi') {
					args.push('-profile', '77');
					args.push('-level', '41');
				}

				if (d.f === 'mp4') {
					args.push('-movflags', 'frag_keyframe+empty_moov+faststart+default_base_moof');
				}

				args.push('-y', '-f', d.f, 'pipe:1');

				if ((!d.ss) && (d['c:v'] === 'copy') && (d['c:a'] === 'copy') && (d.f === 'mpegts')) {
					var tailf = child_process.spawn('tail', ['-f', '-c', '61440', '/proc/self/fd/3'], { stdio: ['pipe', 'pipe', 'pipe', fd] });// 1KB
					children.push(tailf);

					tailf.stdout.pipe(response);

					tailf.once('error', function(error) { log(error); response.destroy(); });
					tailf.once('close', function() { response.end(); });
					response.once('close', function() { stopChild(tailf); });
				} else {
					var ffmpeg = child_process.spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe', fd] });
					children.push(ffmpeg);
					log('SPAWN: ffmpeg ' + args.join(' ') + ' (pid=' + ffmpeg.pid + ')');
					var tailf = null;
					function stopInput() {
						if (tailf) { tailf.stdout.unpipe(ffmpeg.stdin); stopChild(tailf); }
					}
					ffmpeg.stdin.on('error', function(error) {
						stopInput();
						if (error.code !== 'EPIPE') { log(error); response.destroy(); stopChild(ffmpeg); }
					});
					ffmpeg.once('error', function(error) { stopInput(); log(error); response.destroy(); });

					if (!d.ss) {
						tailf = child_process.spawn('tail', ['-f', '/proc/self/fd/3'], { stdio: ['pipe', 'pipe', 'pipe', fd] });
						children.push(tailf);

						tailf.stdout.pipe(ffmpeg.stdin);

						tailf.once('error', function(error) { log(error); response.destroy(); stopChild(ffmpeg); });
						tailf.once('close', function() { if (!ffmpeg.stdin.destroyed) ffmpeg.stdin.end(); });
					}

					ffmpeg.stdout.pipe(response);

					ffmpeg.stderr.on('data', function(d) {
						log(d);
					});

					// close follows stdout draining; exit can precede the final frames.
					ffmpeg.once('close', function() {
						stopInput();
						response.end();
					});

					response.once('close', function() {
						stopInput();
						stopChild(ffmpeg);
					});
				}

				return;
		}//<--switch

	} finally { fs.closeSync(fd); }
})();
