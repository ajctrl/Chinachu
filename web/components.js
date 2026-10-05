/* Preload the controls before creating instances; all imports are local. */
window.chinachuComponentsReady = Promise.all([
	'button', 'dialog', 'checkbox', 'input', 'textarea', 'select', 'option',
	'slider', 'progress-bar', 'callout', 'tab-group', 'tab', 'tab-panel', 'tooltip'
].map(name => import('./lib/webawesome/dist-cdn/components/' + name + '/' + name + '.js')).concat(import('./lib/webawesome/dist-cdn/translations/ja.js')));
