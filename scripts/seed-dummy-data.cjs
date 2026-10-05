'use strict';

// UI用。録画ファイルは作成せず、番組メタデータだけを生成する。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const schedule = JSON.parse(fs.readFileSync(path.join(dataDir, 'schedule.json'), 'utf8'));
const templates = schedule.flatMap(channel => channel.programs || []);
if (!templates.length) throw new Error('data/schedule.json に番組が必要です。');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const now = Date.now();
const minute = 60000;
const series = [
	['星空探検隊', 'anime', 30],
	['夕方ニュース', 'news', 30],
	['週末サッカー中継', 'sports', 120],
	['街角ぶらり旅', 'variety', 60],
	['季節のごはん', 'information', 30],
	['海辺の約束', 'drama', 60],
	['音楽の時間', 'music', 30],
	['世界の自然紀行', 'documentary', 60],
	['名作シネマ', 'cinema', 120],
	['親子で学ぶ科学', 'education', 30]
];

function program(kind, index) {
	const template = templates[index % templates.length];
	const [title, category, duration] = series[index % series.length];
	const episode = Math.floor(index / series.length) + 1;
	const id = `dummy-${kind}-${String(index + 1).padStart(4, '0')}`;
	const start = kind === 'reserves' ? now + (index + 1) * 3 * 60 * minute
		: kind === 'recorded' ? now - (index + 1) * 6 * 60 * minute
			: now - (index + 1) * 5 * minute;
	const subTitle = `第${episode}回 UI確認用ダミーデータ`;
	const result = {
		id, title, subTitle, fullTitle: `${title} ${subTitle}`, category,
		detail: `一覧表示・検索・ソートの確認用ダミー番組です。\n${title} 第${episode}回。実際の録画ファイルはありません。`,
		episode, flags: index % 11 === 0 ? ['新'] : index % 13 === 0 ? ['再'] : [],
		channel: { ...template.channel }, start,
		end: start + duration * minute, seconds: duration * 60
	};
	if (kind === 'reserves') {
		if (index % 5 === 0) result.isManualReserved = true;
		if (index % 17 === 0 && !result.isManualReserved) result.isSkip = true;
	} else {
		result.recorded = path.join(config.recordedDir || './recorded/', `${id}.m2ts`);
		result.tuner = { name: 'Dummy tuner', command: '*', isScrambling: false };
		if (kind === 'recording') result.pid = -1;
	}
	return result;
}

const counts = { reserves: 400, recorded: 300, recording: 2 };
const backupDir = path.join(dataDir, 'dummy-backups', `${now}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const [kind, count] of Object.entries(counts)) {
	const filename = path.join(dataDir, `${kind}.json`);
	if (fs.existsSync(filename)) fs.copyFileSync(filename, path.join(backupDir, `${kind}.json`));
	const entries = Array.from({ length: count }, (_, index) => program(kind, index));
	const temporary = `${filename}.dummy.tmp`;
	fs.writeFileSync(temporary, JSON.stringify(entries, null, 2) + '\n');
	fs.renameSync(temporary, filename);
	console.log(`${kind}: ${entries.length}件`);
}
console.log(`元データのバックアップ: ${path.relative(root, backupDir)}`);
