'use strict';

function editRule(store, name, action, number, rule) {
	store.transaction(() => {
		const rules = store.read(name);
		const index = Number(number);
		if (action !== 'POST' && (!/^\d+$/.test(number) || !Number.isSafeInteger(index) || !rules[index])) {
			throw Object.assign(new Error('ルールが見つかりません'), { status: 404 });
		}
		switch (action) {
		case 'POST': rules.push(rule); break;
		case 'PUT': rules[index] = rule; break;
		case 'DELETE': rules.splice(index, 1); break;
		case 'enable': if (rules[index].isDisabled) delete rules[index].isDisabled; break;
		case 'disable': rules[index].isDisabled = true; break;
		default: throw Object.assign(new Error('不明なルール操作です'), { status: 500 });
		}
		store.replace(name, rules);
	});
}

module.exports = { editRule };
