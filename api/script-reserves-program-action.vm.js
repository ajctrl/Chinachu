const action = ['skip', 'unskip'].includes(request.param.action) ? request.param.action : null;
const program = changeReservation(store, action, request.param.id, { start: request.query.start });
response.head(200);
response.end(JSON.stringify({ program }));
