(function() {
	
	var program = chinachu.getProgramById(request.param.id, data.reserves);
	
	if (program === null) return response.error(404);
	
	switch (request.method) {
		case 'PUT':
			if (request.query.start !== undefined && Number(request.query.start) !== program.start) return response.error(409);
			if (request.param.action !== 'skip' && request.param.action !== 'unskip') return response.error(400);
			var cmd = '';
			
			switch (request.param.action) {
				case 'skip':
					cmd = 'node app-cli.js -mode skip -id ' + program.id;
					break;
				case 'unskip':
					cmd = 'node app-cli.js -mode unskip -id ' + program.id;
					break;
			}
			
			child_process.exec(cmd, function(err, stdout, stderr) {
				if (err) return response.error(500);
				
				try {
					var reserves = JSON.parse(fs.readFileSync(define.RESERVES_DATA_FILE, 'utf8'));
					var updated = chinachu.getProgramById(program.id, reserves);
				} catch (error) { return response.error(500); }
				response.head(200);
				response.end(JSON.stringify({ program: updated }));
			});
			return;
	}

})();