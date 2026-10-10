'use strict';

// Refresh demo EPG metadata and include existing reservations in search results.
// Does not modify reservations, recordings, rules or create recording files.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'data/schedule.json');
const original = JSON.parse(fs.readFileSync(filename, 'utf8'));
const reserves = JSON.parse(fs.readFileSync(path.join(root, 'data/reserves.json'), 'utf8'));
const now = Date.now();
const hour = 3600000;
const start = Math.ceil(now / hour) * hour;
const schedule = original.map(channel => ({
	...channel,
	programs: (channel.programs || []).filter(program => !/^dummy-/.test(program.id))
}));
const channels = [
	{ id: 'dummy-gr-1', name: 'テスト総合', type: 'GR', channel: '27', sid: 101 },
	{ id: 'dummy-gr-2', name: 'テスト教育', type: 'GR', channel: '26', sid: 102 },
	{ id: 'dummy-bs-1', name: 'テストBS旅', type: 'BS', channel: 'BS01_0', sid: 201 },
	{ id: 'dummy-bs-2', name: 'テストBS映画', type: 'BS', channel: 'BS03_0', sid: 202 },
	{ id: 'dummy-cs-1', name: 'テストCSスポーツ', type: 'CS', channel: 'CS2', sid: 301 },
	{ id: 'dummy-sky-1', name: 'テストSKY音楽', type: 'SKY', channel: '100', sid: 401 }
];
const series = [
	['街角ぶらり旅', 'variety', '温泉と商店街を訪ねる旅'],
	['世界の旅', 'documentary', '海と山の自然紀行'],
	['星空探検隊', 'anime', '宇宙を旅する冒険アニメ'],
	['夕方ニュース', 'news', '経済と暮らしのニュース'],
	['週末サッカー中継', 'sports', 'サッカーの試合と選手インタビュー'],
	['季節のごはん', 'information', '旬の野菜を使った料理'],
	['海辺の約束', 'drama', '海辺の町で出会う家族の物語'],
	['音楽の時間', 'music', 'ジャズとクラシックのライブ'],
	['名作シネマ', 'cinema', '旅をテーマにした映画特集'],
	['親子で学ぶ科学', 'hobby', '星と宇宙の実験教室'],
	['舞台への招待', 'theater', '演劇と舞台の舞台裏'],
	['みんなの暮らし', 'welfare', '福祉と地域の生活'],
	['テスト特別番組', 'etc', '検索テスト用のその他ジャンル']
];
function getChannel(channel) {
	let entry = schedule.find(value => value.id === channel.id);
	if (!entry) { entry = { ...channel, programs: [] }; schedule.push(entry); }
	return entry;
}
let generated = 0;
channels.forEach((channel, channelIndex) => {
	const entry = getChannel(channel);
	Object.assign(entry, channel);
	for (let index = 0; index < 168; index++) {
		const [title, category, description] = series[(index + channelIndex * 3) % series.length];
		const episode = Math.floor(index / series.length) + 1;
		const programStart = start + index * hour;
		const subTitle = `第${episode}回 検索デモ`;
		entry.programs.push({
			id: `dummy-search-${channel.id}-${String(index + 1).padStart(4, '0')}`,
			title, subTitle, fullTitle: `${title} ${subTitle}`, category,
			detail: `${description}。\n検索確認用デモデータ。${channel.name}・第${episode}回。`,
			episode, flags: index % 17 === 0 ? ['新'] : [], channel: { ...channel },
			start: programStart, end: programStart + hour, seconds: 3600
		});
		generated++;
	}
});
const ids = new Set(schedule.flatMap(channel => channel.programs.map(program => program.id)));
let addedReserves = 0;
for (const reserve of reserves) {
	if (ids.has(reserve.id)) continue;
	const program = { ...reserve, channel: { ...reserve.channel } };
	delete program.isManualReserved;
	delete program.isSkip;
	getChannel(program.channel).programs.push(program);
	ids.add(program.id);
	addedReserves++;
}
schedule.forEach(channel => channel.programs.sort((a, b) => a.start - b.start));
const backupDir = path.join(root, 'data/dummy-backups', `search-${now}`);
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(filename, path.join(backupDir, 'schedule.json'));
const temporary = `${filename}.search-demo.tmp`;
fs.writeFileSync(temporary, JSON.stringify(schedule, null, 2) + '\n');
fs.renameSync(temporary, filename);
const all = schedule.flatMap(channel => channel.programs);
console.log(`デモ番組: ${generated}件 / 追加した予約番組: ${addedReserves}件`);
console.log(`番組表: ${schedule.length}チャンネル・${all.length}件 / 検索対象: ${all.filter(program => program.end >= now).length}件`);
console.log(`元データ: ${path.relative(root, backupDir)}/schedule.json`);
