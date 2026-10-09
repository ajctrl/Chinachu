(function() {
	
	var program = chinachu.getProgramById(request.param.id, data.recording);
	
	if (program === null) return response.error(404);
	
	if (!data.status.feature.previewer) return response.error(403);
	
	if (!program.pid) return response.error(503);
	
	if (program.tuner && program.tuner.isScrambling) return response.error(409);
	
	var fd;
	try { fd = chinachu.openRecordingFile(config.recordedDir, program.recorded); }
	catch (error) { log(error); return response.error(error.code === 'ENOENT' ? 410 : 403); }
	try {
	
	
		var width  = request.query.width;
		var height = request.query.height;
	
		if (request.query.size && (request.query.size.match(/^[1-9][0-9]{0,3}x[1-9][0-9]{0,3}$/) !== null)) {
			width  = request.query.size.split('x')[0];
			height = request.query.size.split('x')[1];
		}
	
		width = parseInt(width, 10).toString(10);
		height = parseInt(height, 10).toString(10);
		if (width === 'NaN' || Number(width) < 1 || Number(width) > 4096) width = '320';
		if (height === 'NaN' || Number(height) < 1 || Number(height) > 4096) height = '180';
	
		var vcodec = 'mjpeg';
	
		if (request.query.type && (request.query.type === 'jpg')) { vcodec = 'mjpeg'; }
		if (request.query.type && (request.query.type === 'png')) { vcodec = 'png'; }
		if (request.type === 'jpg') { vcodec = 'mjpeg'; }
		if (request.type === 'png') { vcodec = 'png'; }
		if (request.type === 'txt') { vcodec = 'mjpeg'; }
	
		var sourceFailed = false;
		var closed = false;
		var ffmpeg = child_process.execFile('ffmpeg', [
			'-f', 'mpegts', '-r', '10', '-i', 'pipe:0', '-ss', '1.5', '-r', '10',
			'-frames:v', '1', '-f', 'image2', '-codec:v', vcodec, '-an',
			'-s', width + 'x' + height, '-map', '0:v:0', '-y', 'pipe:1'
		], { encoding: 'binary', maxBuffer: 3200000, timeout: 3000, killSignal: 'SIGKILL' },
			function(err, stdout, stderr) {
				if (closed || sourceFailed) return;
				if (err) {
					log(err);
					return response.error(503);
				}
			
				response.head(200);
				if (request.type === 'txt') {
					if (vcodec === 'mjpeg') {
						response.end('data:image/jpeg;base64,' + Buffer.from(stdout, 'binary').toString('base64'));
					} else if (vcodec === 'png') {
						response.end('data:image/png;base64,' + Buffer.from(stdout, 'binary').toString('base64'));
					}
				} else {
					response.end(stdout, 'binary');
				}
			}
		);
	
		if (ffmpeg.pid) {
			children.push(ffmpeg);
			ffmpeg.once('exit', function() {
				var index = children.indexOf(ffmpeg);
				if (index !== -1) children.splice(index, 1);
			});
		}
		var source = fs.createReadStream(null, {
			fd: fd, autoClose: true, start: Math.max(0, fs.fstatSync(fd).size - 3200000)
		});
		fd = null;
		source.once('error', function(error) {
			sourceFailed = true;
			log(error);
			ffmpeg.kill('SIGKILL');
			if (!closed) response.error(503);
		});
		ffmpeg.stdin.on('error', function() { source.destroy(); });
		ffmpeg.once('close', function() { source.destroy(); });
		response.once('close', function() { closed = true; source.destroy(); ffmpeg.kill('SIGKILL'); });
		source.pipe(ffmpeg.stdin);

	} finally { if (fd !== null) fs.closeSync(fd); }
})();
