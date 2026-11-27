const num = parseInt(request.param.num, 10);
// Only enable/disable are actions exposed by this URL.
const action = ['enable', 'disable'].includes(request.param.action) ? request.param.action : null;
editRule(store, 'rules', action, num);
response.head(200);
response.end('{}');
