'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage() {
	let page;
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/page/schedule/table.js'), 'utf8'), {
		Chinachu: { definePage(methods) { page = methods; } }
	});
	return page;
}

describe('schedule toolbar layout decisions', function() {
	const page = loadPage();
	function layout(overrides = {}) {
		return page.getDayControlsLayout({
			compact: false, wide: false,
			fullToday: '10/11(日) 12時〜', shortToday: '11(日)',
			rowWidth: 500, siblingWidth: 160, siblingCount: 4, gap: 4,
			tabsWidth: 280, shortTabsWidth: 220, navigationWidth: 150,
			groupedTypesWidthGain: 70, ...overrides
		});
	}

	it('keeps the full date labels when all tabs fit exactly', function() {
		const state = layout({ rowWidth: 472 });
		assert.equal(state.shortToday, false);
		assert.equal(state.split, false);
		assert.equal(state.groupedTypes, false);
		assert.equal(state.todayLabel, '10/11(日) 12時〜');
		assert.equal(state.width, 280);
	});

	it('tries the shorter today label before moving the tabs onto another row', function() {
		const state = layout({ rowWidth: 394 });
		assert.equal(state.shortToday, true);
		assert.equal(state.split, false);
		assert.equal(state.todayLabel, '11(日)');
		assert.equal(state.width, 220);
		const narrower = layout({ rowWidth: 393 });
		assert.equal(narrower.split, true);
		assert.equal(narrower.groupedTypes, false);
		assert.equal(narrower.width, 393);
	});

	it('retains the spacing difference at the desktop breakpoint', function() {
		assert.equal(layout({ rowWidth: 470, wide: true }).shortToday, false);
		assert.equal(layout({ rowWidth: 470, wide: false }).shortToday, true);
	});

	it('keeps individual broadcast filters while the compact date navigation fits', function() {
		const state = layout({ compact: true, rowWidth: 324 });
		assert.equal(state.shortToday, true);
		assert.equal(state.groupedTypes, false);
		assert.equal(state.split, false);
		assert.equal(state.width, 150);
		assert.equal(state.todayLabel, '10/11(日) 12時〜');
	});

	it('groups broadcast filters before splitting a compact date row', function() {
		const state = layout({ compact: true, rowWidth: 254 });
		assert.equal(state.groupedTypes, true);
		assert.equal(state.split, false);
		const narrower = layout({ compact: true, rowWidth: 253 });
		assert.equal(narrower.groupedTypes, true);
		assert.equal(narrower.split, true);
	});

	it('limits compact navigation width to the available header width', function() {
		const state = layout({ compact: true, rowWidth: 120 });
		assert.equal(state.groupedTypes, true);
		assert.equal(state.split, true);
		assert.equal(state.width, 120);
	});
});
