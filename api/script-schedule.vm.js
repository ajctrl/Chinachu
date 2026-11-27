const result = store.transaction(() => {
	const { revision, modified, previous_modified } = store.revision('schedule');
	const etag = 'W/"schedule-' + modified + '-' + revision + '"';
	const lastModified = new Date(modified).toUTCString();
	// A date-only validator cannot distinguish two updates in the same second.
	const current = request.headers['if-none-match'] !== undefined
		? request.headers['if-none-match'] === etag
		: request.headers['if-modified-since'] === lastModified && new Date(previous_modified).toUTCString() !== lastModified;
	return { etag, lastModified, input: current ? null : JSON.stringify(store.read('schedule')) };
}, false);
response.setHeader('etag', result.etag);
response.setHeader('last-modified', result.lastModified);
if (result.input === null) {
	response.head(304);
	response.end();
} else {
	var input = result.input;
	switch (request.encoding) {
	case 'deflate':
		response.setHeader('content-encoding', 'deflate');
		zlib.deflate(input, function (err, buffer) {
			if (err) return response.error(500);
			response.setHeader('content-length', buffer.length);
			response.head(200);
			response.end(request.method === 'GET' ? buffer : undefined);
		});
		break;
	default:
		response.head(200);
		if (request.method === 'GET') {
			response.end(input);
		} else {
			response.end();
		}
	}
}
