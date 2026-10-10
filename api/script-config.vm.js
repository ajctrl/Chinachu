(function() {
	if (!data.status.feature.configurator) return response.error(403);
	if (!fs.existsSync(define.CONFIG_FILE)) return response.error(410);
	try {
		response.setHeader('Cache-Control', 'no-store');
		if (request.method === 'GET') {
			var text = fs.readFileSync(define.CONFIG_FILE, 'utf8');
			var visible = configStore.publicText(text);
			response.setHeader('ETag', '"' + configStore.revision(text) + '"');
			response.head(200);
			return response.end(visible);
		}
		if (request.method === 'PUT') {
			if (typeof request.query.json !== 'string') {
				response.head(400);
				return response.end(JSON.stringify({ message: 'JSONを指定してください。' }));
			}
			var expected = request.query.revision;
			if (typeof expected !== 'string') {
				response.head(428);
				return response.end(JSON.stringify({ message: '設定を再読み込みしてから保存してください。' }));
			}
			var before = fs.readFileSync(define.CONFIG_FILE, 'utf8');
			if (expected !== configStore.revision(before)) {
				response.head(409);
				return response.end(JSON.stringify({ message: '読み込み後に設定が更新されています。再読み込みしてください。' }));
			}
			var prepared = configStore.prepare(request.query.json, before);
			var saved = configStore.save(define.CONFIG_FILE, prepared.text, expected, undefined, { secure: true, backupText: prepared.backupText });
			response.setHeader('ETag', '"' + saved.revision + '"');
			response.head(200);
			return response.end(configStore.publicText(prepared.text));
		}
	} catch (error) {
		response.head(error.status || 500);
		response.end(JSON.stringify({ message: error.status ? error.message : '設定の読み込みに失敗しました（' + (error.code || 'I/Oエラー') + '）。', errors: error.errors || [] }));
	}
})();
