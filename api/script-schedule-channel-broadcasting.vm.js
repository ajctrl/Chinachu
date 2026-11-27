const channel = store.channel(request.param.chid, Date.now());
if (!channel) response.error(404);
else {
	response.head(200);
	response.end(JSON.stringify(channel.programs, null, '  '));
}
