// The update command writes its own scheduler log and outlives this request.
const scheduler = child_process.spawn('./chinachu', ['update'], { stdio: 'ignore' });
scheduler.once('error', err => {
	log(err);
	response.error(500);
});
scheduler.once('spawn', () => {
	response.head(202);
	response.end('{}');
});
scheduler.once('exit', (code, signal) => {
	if (code !== 0) log('Scheduler update exited: ' + (signal || code));
});
