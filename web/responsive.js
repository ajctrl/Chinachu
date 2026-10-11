/* Shared viewport modes. Keep their CSS counterparts in sync; see docs/browser-ui.md. */
(function(root) {
	'use strict';
	var queries = {
		compact: '(max-width: 800px)',
		wide: '(min-width: 801px)',
		scheduleCompact: '(max-width: 451px)'
	};
	var media = {};
	Object.keys(queries).forEach(function(name) {
		media[name] = root.matchMedia(queries[name]);
	});
	root.ChinachuResponsive = Object.freeze({ media: Object.freeze(media) });
})(window);
