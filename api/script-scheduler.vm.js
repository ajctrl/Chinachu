(function() {
	
	switch (request.method) {
		case 'GET':
			res();
			return;
		
		case 'PUT':
			child_process.exec('./chinachu update', function(err, stdout, stderr) {
				if (err) return response.error(500);
				
				try { res(); } catch (error) { log(error); response.error(500); }
			});
			return;
	}
	
	function res() {
		if (request.type === 'json') {
		
			var result = {
				time     : 0,
				conflicts: [],
				reserves : []
			};
			
			if (!fs.existsSync(define.SCHEDULER_LOG_FILE)) {
				response.head(204);
				response.end(JSON.stringify(result));
				return;
			}
			
			result.time = fs.statSync(define.SCHEDULER_LOG_FILE).mtime.getTime();
			
			var schedulerLog  = child_process.execSync('/bin/bash -c \'sed "/RUNNING SCHEDULER\\./q" <\(nice -n 19 tac "' + define.SCHEDULER_LOG_FILE + '"\)\' 2>/dev/null', {
				encoding: 'utf8'
			});
			
			const entries = [];
			for (const line of schedulerLog.split('\n').reverse()) {
				const match = line.match(/(RESERVE|CONFLICT): ([a-z0-9-]+)/);
				if (match) entries.push({ type: match[1], id: match[2] });
			}
			const programs = store.firstProgramsById(entries.map(entry => entry.id));
			for (const { type, id } of entries) {
				const list = type === 'CONFLICT' ? result.conflicts : result.reserves;
				list.push(programs.get(id) ?? null);
			}

			response.head(200);
			response.end(JSON.stringify(result, null, '  '));
			
		} else {
			
			if (!fs.existsSync(define.SCHEDULER_LOG_FILE)) {
				response.head(204);
				response.end('');
				return;
			}
			
			response.head(200);
			response.end(fs.readFileSync(define.SCHEDULER_LOG_FILE, 'ascii'));
			
		}
	}

})();
