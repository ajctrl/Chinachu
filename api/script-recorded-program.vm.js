(function () {
	if (request.method === 'DELETE') {
		store.transaction(() => {
			const history = data.recorded;
			const program = chinachu.getProgramById(request.param.id, history);
			if (!program) throw Object.assign(new Error('番組が見つかりません'), { status: 404 });
			try { chinachu.removeRecordingFile(config.recordedDir, program.recorded); }
			catch (error) { throw Object.assign(error, { status: 403 }); }
			store.replace('recorded', history.filter(item => item.id !== program.id));
		});
		response.head(200);
		response.end('{}');
		return;
	}
	const program = chinachu.getProgramById(request.param.id, data.recorded);
	if (!program) return response.error(404);
	program.isRemoved = !fs.existsSync(program.recorded);
	response.head(200);
	response.end(JSON.stringify(program, null, '  '));
})();
