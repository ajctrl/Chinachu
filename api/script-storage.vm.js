(function() {
	switch (request.method) {
		case 'GET':
			var sumOfFileSize = function(list) {
				return list.reduce( function(prev, fpath, i, self) {
					if( !fs.existsSync(fpath) ) return prev;
					var s = fs.statSync(fpath);
					if( !s.isFile() ) return prev;
					return prev + s.blocks * 512;
				}, 0);
			};
			
			var recordedFiles = data.recorded.map( function(r) { return r.recorded; } );
			var storageUsage = {};
			storageUsage.recorded = sumOfFileSize(recordedFiles);
			storageUsage.lowSpaceThreshold = (config.storageLowSpaceThresholdMB || 3000) * 1024 * 1024;
			
			fs.statfs(config.recordedDir, function(err, info) {
				if (err) { log(err); return response.error(500); }
				storageUsage.size = info.blocks * info.bsize;
				storageUsage.used = (info.blocks - info.bfree) * info.bsize;
				storageUsage.avail = info.bavail * info.bsize;
				response.head(200);
				response.end(JSON.stringify(storageUsage, null, '  '));
			});
			
			return;
	}
})();
