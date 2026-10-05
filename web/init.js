/* Chinachu browser startup. Libraries and page scripts are served locally. */
(async function () {
	'use strict';
	const C = window.Chinachu;
	try {
		await window.chinachuComponentsReady;
		const [indexResponse, localeResponse] = await Promise.all([fetch('./page/index.json'), fetch('./locales/ja.json')]);
		if (!indexResponse.ok || !localeResponse.ok) throw new Error('画面情報を読み込めませんでした。');
		const [index, translations] = await Promise.all([indexResponse.json(), localeResponse.json()]);
		C.translations = translations;
		window.location.query = C.query(location.search);
		const app = window.app = {
			view: {}, stat: {}, env: {}, api: {}, f: {}, def: {}, timer: {}, socket: null,
			chinachu: { status: {}, rules: [], reserves: [], schedule: [], recording: [], recorded: [] }
		};
		window.global = { chinachu: app.chinachu };
		app.def.apiRoot = window.location.query.api || './api/';
		app.def.colors = ['#6495ed', '#f39700', '#769164', '#e60012', '#663300', '#ec6d71', '#1e50a2'];
		app.def.categoryColor = { anime: '#fcbde1', information: '#bdfce8', news: '#d7fcbd', sports: '#bdf1fc', variety: '#fbfcbd', drama: '#fce1c4', music: '#bdc9fc', cinema: '#d6bdfc', etc: '#eeeeee' };
		app.view.body = new ChinachuUI.Body().clear();
		app.view.loadingMask = new ChinachuUI.Container({ className: 'fullmask loading' }).render(app.view.body);
		app.view.panicMask = new ChinachuUI.Container({ className: 'fullmask panic' }).render(app.view.body).hide();
		const colour = window.location.query.colour || localStorage.getItem('colour');
		if (colour && /^[\da-f]{3,8}$/i.test(colour)) document.body.style.backgroundColor = '#' + colour;
		app.pm = new C.PageManager(app, index);
		await C.loadScript('./class.js');
		await C.loadScript('./socket.io/socket.io.js?v=4.8.3');
		await C.loadScript('./chinachu.js');
	} catch (error) {
		console.error(error); document.body.replaceChildren();
		const message = document.createElement('p'); message.textContent = 'Chinachuの起動に失敗しました。' + error.message;
		document.body.append(message);
	}
}());
