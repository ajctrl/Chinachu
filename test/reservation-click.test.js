'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const planner = require('../lib/reservation-planner');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function browser() {
	const ctx = vm.createContext({});
	vm.runInContext(`
		var requests = [], notices = [], events = [], storage = {}, handlers = {}, mode = 'details', changes = 0;
		var window = { location: {}, localStorage: { getItem: function(k) { return storage[k]; }, setItem: function(k,v) { storage[k]=v; } }, addEventListener: function(k,fn) { handlers[k]=fn; } };
		var document = { fire: function(name, memo) { changes++; events.push({name:name, memo:memo}); } };
		var global = { chinachu: { reserves: [{ id: 'one', title: '番組1', start: 100 }, { id: 'two', title: '番組2', start: 200 }, { id: 'manual', title: '手動予約', start: 300, isManualReserved: true }] } };
		var Ajax = { Request: function(url, options) { requests.push({url:url, options:options}); } };
		var P = {}, Class = { create: function(base, methods) { return methods; } };
	`, ctx);
	vm.runInContext(read('web/preferences.js'), ctx);
	vm.runInContext(read('web/reservation-actions.js'), ctx);
	vm.runInContext('var ChinachuPreferences = window.ChinachuPreferences, ChinachuReservationActions = window.ChinachuReservationActions;', ctx);
	vm.runInContext(read('web/page/reserves/list.js'), ctx);
	vm.runInContext(`P.showSkipNotice = function(message, undo) { notices.push({message:message, undo:undo}); };`, ctx);
	return ctx;
}
function complete(ctx, index, skip, failure) {
	const req = ctx.requests[index];
	if (failure) req.options.onFailure({ status: failure });
	else {
		const id = req.url.split('/')[3];
		const program = JSON.parse(JSON.stringify(ctx.global.chinachu.reserves.find(p => p.id === id)));
		if (skip) planner.skip(program); else planner.unskip(program);
		req.options.onSuccess({ status: 200, responseJSON: { program } });
	}
	req.options.onComplete();
}

describe('reservation click actions', function() {
	it('notifies observers with the full current list before and after skip, undo and failure', function() {
		const ctx = browser();
		function checkEvent(index, skipped) {
			const event = ctx.events[index];
			assert.equal(event.name, 'chinachu:reserves');
			assert.strictEqual(event.memo, ctx.global.chinachu.reserves);
			assert.ok(Array.isArray(event.memo));
			assert.equal(event.memo.length.toString(10), '3');
			assert.equal(!!event.memo[0].isSkip, skipped);
			const ids = [];
			event.memo.forEach(program => ids.push(program.id));
			assert.deepEqual(ids, ['one', 'two', 'manual']);
		}
		ctx.P.setProgramSkip(ctx.global.chinachu.reserves[0], true);
		checkEvent(0, false);
		complete(ctx, 0, true);
		checkEvent(1, true);
		ctx.notices[0].undo();
		checkEvent(2, true);
		complete(ctx, 1, false);
		checkEvent(3, false);
		const beforeFailure = ctx.global.chinachu.reserves;
		ctx.P.setProgramSkip(beforeFailure[0], true);
		checkEvent(4, false);
		complete(ctx, 2, false, 500);
		checkEvent(5, false);
		assert.strictEqual(ctx.global.chinachu.reserves, beforeFailure);
		assert.equal(ctx.events.length, 6);
	});
	it('defaults to details and stores/synchronizes the selected browser-only action', function() {
		const ctx = browser();
		assert.equal(ctx.ChinachuPreferences.getClickAction(), 'details');
		ctx.ChinachuPreferences.setClickAction('skip');
		assert.equal(ctx.storage['chinachu.reserves.clickAction'], 'skip');
		assert.equal(ctx.requests.length, 0);
		ctx.storage['chinachu.reserves.clickAction'] = 'details';
		ctx.handlers.storage({ key: 'chinachu.reserves.clickAction' });
		assert.equal(ctx.ChinachuPreferences.getClickAction(), 'details');
	});
	it('opens details by default but ignores single clicks on unskipped manual reservations in skip mode', function() {
		const ctx = browser();
		ctx.P.onRowClick({}, {data:ctx.global.chinachu.reserves[0]});
		assert.equal(ctx.window.location.href, '#!/program/view/id=one/');
		ctx.P.onRowClick({}, {data:ctx.global.chinachu.reserves[2]});
		assert.equal(ctx.window.location.href, '#!/program/view/id=manual/');
		ctx.window.location.href = '#!/reserves/list/';
		ctx.ChinachuPreferences.setClickAction('skip');
		ctx.P.onRowClick({}, {data:ctx.global.chinachu.reserves[2]});
		assert.equal(ctx.window.location.href, '#!/reserves/list/');
		assert.equal(ctx.requests.length, 0);
	});
	it('skips manual reservations on double click, unskips on single click and supports undo', function() {
		const ctx = browser();
		ctx.ChinachuPreferences.setClickAction('skip');
		const row = { data: ctx.global.chinachu.reserves[2] };
		ctx.P.onRowClick({detail:1}, row);
		ctx.P.onRowClick({detail:2}, row);
		assert.equal(ctx.requests.length, 0);
		ctx.P.onRowDoubleClick({detail:2}, row);
		ctx.P.onRowDoubleClick({detail:2}, row);
		assert.equal(ctx.requests.length, 1);
		assert.match(ctx.requests[0].url, /manual\/skip.json$/);
		complete(ctx, 0, true);
		assert.equal(ctx.global.chinachu.reserves[2].isManualReserved, true);
		assert.equal(ctx.global.chinachu.reserves[2].isSkip, true);
		ctx.P.onRowClick({detail:1}, { data: ctx.global.chinachu.reserves[2] });
		assert.match(ctx.requests[1].url, /manual\/unskip.json$/);
		complete(ctx, 1, false);
		assert.ok(!ctx.global.chinachu.reserves[2].isSkip);
		ctx.notices.at(-1).undo();
		complete(ctx, 2, true);
		assert.equal(ctx.global.chinachu.reserves[2].isSkip, true);
		ctx.notices.at(-1).undo();
		complete(ctx, 3, false);
		assert.equal(ctx.global.chinachu.reserves[2].isManualReserved, true);
		assert.ok(!ctx.global.chinachu.reserves[2].isSkip);
	});
	it('does not re-skip a manual reservation when an unskip completes between the clicks', function() {
		const ctx = browser();
		ctx.ChinachuPreferences.setClickAction('skip');
		ctx.global.chinachu.reserves[2].isSkip = true;
		ctx.P.onRowClick({detail:1}, { data: ctx.global.chinachu.reserves[2] });
		complete(ctx, 0, false);
		const row = { data: ctx.global.chinachu.reserves[2] };
		ctx.P.onRowClick({detail:2}, row);
		ctx.P.onRowDoubleClick({detail:2}, row);
		assert.equal(ctx.requests.length, 1);
		assert.ok(!row.data.isSkip);
		// A new double-click gesture can intentionally skip the reservation again.
		ctx.P.onRowClick({detail:1}, row);
		ctx.P.onRowClick({detail:2}, row);
		ctx.P.onRowDoubleClick({detail:2}, row);
		assert.equal(ctx.requests.length, 2);
		assert.match(ctx.requests[1].url, /manual\/skip.json$/);
	});
	it('ignores double clicks in details mode, on automatic rows and on links or modified clicks', function() {
		const ctx = browser();
		const manual = { data: ctx.global.chinachu.reserves[2] };
		ctx.P.onRowDoubleClick({}, manual);
		ctx.ChinachuPreferences.setClickAction('skip');
		ctx.P.onRowDoubleClick({}, { data: ctx.global.chinachu.reserves[0] });
		for (const event of [{button:2}, {ctrlKey:true}, {metaKey:true}, {shiftKey:true}, {altKey:true}, {target:{closest:()=>true}}]) {
			ctx.P.onRowDoubleClick(event, manual);
		}
		assert.equal(ctx.requests.length, 0);
	});
	it('does not toggle an automatic reservation twice during a double click', function() {
		const ctx = browser();
		ctx.ChinachuPreferences.setClickAction('skip');
		ctx.P.onRowClick({detail:1}, { data: ctx.global.chinachu.reserves[0] });
		complete(ctx, 0, true);
		const row = { data: ctx.global.chinachu.reserves[0] };
		ctx.P.onRowClick({detail:2}, row);
		ctx.P.onRowDoubleClick({detail:2}, row);
		assert.equal(ctx.requests.length, 1);
		assert.equal(ctx.global.chinachu.reserves[0].isSkip, true);
	});
	it('skips immediately, restores through undo and preserves exclusion override metadata', function() {
		const ctx = browser();
		ctx.ChinachuPreferences.setClickAction('skip');
		ctx.P.onRowClick({}, {data:ctx.global.chinachu.reserves[0]});
		assert.match(ctx.requests[0].url, /one\/skip.json$/);
		assert.equal(ctx.requests[0].options.parameters.start,100);
		complete(ctx,0,true);
		assert.equal(ctx.global.chinachu.reserves[0].isSkip,true);
		ctx.notices[0].undo();
		assert.match(ctx.requests[1].url, /one\/unskip.json$/);
		complete(ctx,1,false);
		assert.ok(!ctx.global.chinachu.reserves[0].isSkip);
		ctx.global.chinachu.reserves[0].isSkip=true;
		ctx.global.chinachu.reserves[0].isAutoSkip=true;
		ctx.P.onRowClick({}, {data:ctx.global.chinachu.reserves[0]});
		complete(ctx,2,false);
		assert.equal(ctx.global.chinachu.reserves[0].autoSkipOverride,true);
	});
	it('serializes rapid clicks on different programs and ignores duplicate pending clicks', function() {
		const ctx = browser();
		ctx.ChinachuPreferences.setClickAction('skip');
		ctx.P.onRowClick({}, {data:ctx.global.chinachu.reserves[0]});
		ctx.P.onRowClick({}, {data:ctx.global.chinachu.reserves[0]});
		ctx.P.onRowClick({}, {data:ctx.global.chinachu.reserves[1]});
		assert.equal(ctx.requests.length,1);
		assert.equal(ctx.ChinachuReservationActions.isPending('two'),true);
		complete(ctx,0,true);
		assert.equal(ctx.requests.length,2);
		complete(ctx,1,true);
		assert.ok(ctx.global.chinachu.reserves.slice(0,2).every(p=>p.isSkip));
		assert.equal(ctx.ChinachuReservationActions.isPending('two'),false);
	});
	it('keeps the current state on failure, reports it and continues the queue', function() {
		const ctx = browser();
		ctx.P.setProgramSkip(ctx.global.chinachu.reserves[0],true);
		ctx.P.setProgramSkip(ctx.global.chinachu.reserves[1],true);
		complete(ctx,0,false,500);
		assert.ok(!ctx.global.chinachu.reserves[0].isSkip);
		assert.match(ctx.notices[0].message,/失敗/);
		assert.equal(ctx.notices[0].undo,undefined);
		assert.equal(ctx.requests.length,2);
		ctx.P.closed=true;
		complete(ctx,1,true);
		assert.equal(ctx.notices.length,1);
	});
	it('does not report success on a network error or a missing API result', function() {
		for (const response of [{status:0}, {status:200,responseJSON:{}}]) {
			const ctx = browser();
			ctx.P.setProgramSkip(ctx.global.chinachu.reserves[0],true);
			ctx.requests[0].options.onSuccess(response);
			ctx.requests[0].options.onComplete();
			assert.ok(!ctx.global.chinachu.reserves[0].isSkip);
			assert.match(ctx.notices[0].message,/失敗/);
			assert.equal(ctx.ChinachuReservationActions.isPending('one'),false);
		}
	});
	it('does not skip when using details, the context menu or modified clicks', function() {
		const ctx = browser();ctx.ChinachuPreferences.setClickAction('skip');
		for (const event of [{button:2},{ctrlKey:true},{metaKey:true},{target:{closest:()=>true}}]) ctx.P.onRowClick(event,{data:ctx.global.chinachu.reserves[0]});
		assert.equal(ctx.requests.length,0);
	});
});

describe('reservation action API response', function() {
	it('returns persisted automatic and manual skip states and rejects changed programs or invalid actions', function() {
		const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chinachu-action-'));
		const file=path.join(dir,'reserves.json');
		const program={id:'one',title:'番組',start:100};
		let executions=0;
		function request(action, start, manual) {
			let status, body;
			vm.runInNewContext(read('api/script-reserves-program-action.vm.js'), {
				fs, define:{RESERVES_DATA_FILE:file}, data:{reserves:[{...program,isManualReserved:manual}]},
				request:{method:'PUT',param:{id:'one',action},query:{start}},
				chinachu:{getProgramById:(id,programs)=>programs.find(p=>p.id===id)||null},
				child_process:{exec(cmd,cb) { executions++; const updated={...program,isManualReserved:manual,isSkip:action==='unskip'};planner[action](updated);fs.writeFileSync(file,JSON.stringify([updated]));cb(null); }},
				response:{head(code){status=code;},end(text){body=JSON.parse(text);},error(code){status=code;}}
			});
			return {status,body};
		}
		try {
			assert.equal(request('skip',999,true).status,409);
			assert.equal(request('skip',999,false).status,409);
			assert.equal(request('invalid',100,false).status,400);
			assert.equal(executions,0);
			const result=request('skip',100,false);
			assert.equal(result.status,200);
			assert.equal(result.body.program.isSkip,true);
			const manual = request('skip',100,true);
			assert.equal(manual.status,200);
			assert.equal(manual.body.program.isSkip,true);
			assert.equal(manual.body.program.isManualReserved,true);
			const restored = request('unskip',100,true);
			assert.equal(restored.status,200);
			assert.ok(!restored.body.program.isSkip);
			assert.equal(restored.body.program.isManualReserved,true);
		} finally {fs.rmSync(dir,{recursive:true,force:true});}
	});
});
