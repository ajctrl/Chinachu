const programs = store.programs(null, Date.now());
response.head(200);
response.end(JSON.stringify(programs, null, '  '));
