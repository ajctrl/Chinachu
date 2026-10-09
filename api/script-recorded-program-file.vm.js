(function() {
	
	var program = chinachu.getProgramById(request.param.id, data.recorded);
	
	if (program === null) return response.error(404);
	
	if (!data.status.feature.filer) return response.error(403);
	
	// Open/delete through the trusted recording root, not the stored path alone.
	
	switch (request.method) {
		case 'GET':
			var fd;
			try { fd = chinachu.openRecordingFile(config.recordedDir, program.recorded); }
			catch (error) { log(error); return response.error(error.code === 'ENOENT' ? 410 : 403); }
			try {
				var fstat = fs.fstatSync(fd);
			
				if (request.type === 'm2ts') {
					response.setHeader('content-length', fstat.size);
					response.setHeader('content-disposition', 'attachment; filename="' + program.id + '.m2ts"');
					response.head(200);

					var source = fs.createReadStream(null, { fd: fd, autoClose: true });
					fd = null;
					source.once('error', function(error) { log(error); response.destroy(); });
					response.once('close', function() { source.destroy(); });
					source.pipe(response);
				}
			
				if (request.type === 'json') {
					response.head(200);
				
					response.end(JSON.stringify({
						dev    : fstat.dev,
						ino    : fstat.ino,
						mode   : fstat.mode,
						ulink  : fstat.ulink,
						uid    : fstat.uid,
						gid    : fstat.gid,
						rdev   : fstat.rdev,
						size   : fstat.size,
						blksize: fstat.blksize,
						blocks : fstat.blocks,
						atime  : fstat.atime.getTime(),
						mtime  : fstat.mtime.getTime(),
						ctime  : fstat.ctime.getTime()
					}, null, '  '));
				}
			
			} finally { if (fd !== null) fs.closeSync(fd); }
			return;
		
		case 'DELETE':
			try {
				if (!chinachu.removeRecordingFile(config.recordedDir, program.recorded)) return response.error(410);
			} catch (error) { log(error); return response.error(403); }
			response.head(200);
			
			if (request.type === 'json') {
				response.end('{}');
			} else {
				response.end();
			}
			return;
	}

})();