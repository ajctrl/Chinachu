if (request.method === 'PUT') {
	changeReservation(store, 'reserve', request.param.id, { oneSeg: request.query.mode === '1seg' });
	response.head(200);
	response.end('{}');
} else {
	const program = store.program(request.param.id);
	if (program === null) response.error(404);
	else {
		response.head(200);
		response.end(JSON.stringify(program, null, '  '));
	}
}
