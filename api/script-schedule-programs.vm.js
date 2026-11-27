const programs = store.programs();
response.head(200);
response.end(JSON.stringify(programs, null, '  '));
