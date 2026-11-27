if (request.method === 'DELETE') {
	changeReservation(store, 'unreserve', request.param.id);
	response.head(200);
	response.end('{}');
} else {
	const program = chinachu.getProgramById(request.param.id, data.reserves);
	if (program === null) response.error(404);
	else {
		response.head(200);
		response.end(JSON.stringify(program, null, '  '));
	}
}
