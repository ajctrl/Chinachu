if (request.method === 'PUT') {
	const recorded = store.transaction(() => {
		const kept = data.recorded.filter(item => fs.existsSync(item.recorded));
		store.replace('recorded', kept);
		return kept;
	});
	response.head(200);
	response.end(JSON.stringify(recorded, null, '  '));
} else {
	response.head(200);
	response.end(JSON.stringify(data.recorded));
}
