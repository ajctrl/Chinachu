(function() {
	
	var program = chinachu.getProgramById(request.param.id, data.recorded);
	
	if (program === null) return response.error(404);
	
	if (!data.status.feature.previewer) return response.error(403);
	
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
	
		var pos = request.query.pos || '5';
	
		pos = (parseInt(pos, 10) - 1.5).toString(10);
	
		var closed = false;
		var ffmpeg = chinachu.execFileWithFd('ffmpeg', [
			'-f', 'mpegts', '-ss', pos, '-r', '10', '-i', '/proc/self/fd/3',
			'-ss', '1.5', '-r', '10', '-frames:v', '1', '-c:v', vcodec,
			'-an', '-f', 'image2', '-s', width + 'x' + height, '-map', '0:v:0', '-y', 'pipe:1'
		], fd, { encoding: 'binary', maxBuffer: 3200000, timeout: 3000, killSignal: 'SIGKILL' },
			function(err, stdout, stderr) {
				if (closed) return;
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
			}, child_process
		);
	
		if (ffmpeg.pid) {
			children.push(ffmpeg);
			ffmpeg.once('exit', function() {
				var index = children.indexOf(ffmpeg);
				if (index !== -1) children.splice(index, 1);
			});
		}
		response.once('close', function() { closed = true; ffmpeg.kill('SIGKILL'); });

	} finally { fs.closeSync(fd); }
})();
