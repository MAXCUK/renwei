#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import {
  readText,
  paragraphs,
  countChars,
  countHan,
  chapterNumber,
  parseChapterRef,
  listTextFiles,
  findWorkspaceRoot,
} from './lib/zh-text.mjs';

const USAGE = `人味 · 小说进度检查

用法：node novel-status.mjs [工作区目录] [--json]

不写目录时从当前目录往上找工作区（同时有 进度.md 和 设定/ 的目录）。
报告章节数和字数、缺章、下一章细纲、伏笔状态（逾期、该收、该埋未埋、快到期）和 进度.md 里的下一步。`;

const UPCOMING_WINDOW = 3;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
} catch (e) {
  fail(`${e.message}\n\n${USAGE}`);
}
const { values, positionals } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const start = positionals[0] ?? process.cwd();
if (!existsSync(start)) fail(`找不到目录：${start}`);
const root = findWorkspaceRoot(start);
if (!root) fail(`这里不是小说工作区（往上找不到同时有 进度.md 和 设定/ 的目录）：${start}\n用 init-novel.mjs 新建一个。`);

const read = (...parts) => {
  const p = join(root, ...parts);
  return existsSync(p) ? readText(p) : '';
};

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function parseTable(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const header = splitRow(lines[i]);
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      if (cells.every((c) => !c)) continue;
      rows.push(Object.fromEntries(header.map((h, k) => [h, cells[k] ?? ''])));
    }
    return { header, rows };
  }
  return { header: [], rows: [] };
}

function section(text, title) {
  const lines = text.split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      inside = line.replace(/^##\s*/, '').trim().startsWith(title);
      continue;
    }
    if (inside && line.trim().startsWith('-')) out.push(line.trim().replace(/^-\s*/, ''));
  }
  return out;
}

function classify(status) {
  const s = status.replace(/\s/gu, '');
  if (/废弃|作废|取消/u.test(s)) return 'dropped';
  if (/已回收|已收|已兑现|回收完/u.test(s)) return 'closed';
  if (/已埋|埋了|待回收|进行中/u.test(s)) return 'open';
  if (!s || /未埋|待埋|计划/u.test(s)) return 'planned';
  return 'unknown';
}

const bookTitle = (() => {
  const m = read('设定', '立项.md').match(/^#\s*(.+?)\s*(?:·\s*立项)?\s*$/mu);
  return m ? m[1] : basename(root);
})();

const chapterDir = join(root, '正文');
const chapters = (existsSync(chapterDir) ? listTextFiles([chapterDir]) : []).map((file) => {
  const text = readText(file);
  const paras = paragraphs(text);
  const heading = text.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? '';
  return {
    file: basename(file),
    number: chapterNumber(file),
    title: heading,
    chars: paras.reduce((a, p) => a + countChars(p.text), 0),
    han: paras.reduce((a, p) => a + countHan(p.text), 0),
  };
});
const numbers = chapters.map((c) => c.number).filter((n) => !Number.isNaN(n));
const latest = numbers.length ? Math.max(...numbers) : 0;
const present = new Set(numbers);
const missing = [];
for (let n = 1; n < latest; n++) if (!present.has(n)) missing.push(n);

const outlineDir = join(root, '大纲', '细纲');
const outlines = new Set(
  existsSync(outlineDir)
    ? readdirSync(outlineDir)
        .filter((f) => !f.startsWith('_') && /\.(md|txt)$/i.test(f))
        .map((f) => chapterNumber(f))
        .filter((n) => !Number.isNaN(n))
    : [],
);

const table = parseTable(read('追踪', '伏笔.md'));
const col = (...keys) => table.header.find((h) => keys.some((k) => h.includes(k)));
const cId = col('编号', 'ID', 'id');
const cContent = col('内容', '伏笔');
const cPlant = col('埋设', '埋');
const cPayoff = col('回收');
const cStatus = col('状态');
const items = table.rows.map((r, i) => ({
  id: (cId && r[cId]) || `#${i + 1}`,
  content: (cContent && r[cContent]) || '',
  plant: cPlant ? parseChapterRef(r[cPlant]) : NaN,
  payoff: cPayoff ? parseChapterRef(r[cPayoff]) : NaN,
  status: classify(cStatus ? r[cStatus] : ''),
  rawStatus: cStatus ? r[cStatus] : '',
}));
const counts = { planned: 0, open: 0, closed: 0, dropped: 0, unknown: 0 };
for (const it of items) counts[it.status]++;
const overdue = items.filter((it) => it.status === 'open' && it.payoff < latest);
const dueNow = items.filter((it) => it.status === 'open' && it.payoff === latest);
const unplanted = items.filter((it) => it.status === 'planned' && it.plant <= latest);
const upcoming = items.filter(
  (it) => it.status === 'open' && it.payoff > latest && it.payoff <= latest + UPCOMING_WINDOW,
);

const progressText = read('进度.md');
const report = {
  book: bookTitle,
  root,
  chapters,
  totalChars: chapters.reduce((a, c) => a + c.chars, 0),
  totalHan: chapters.reduce((a, c) => a + c.han, 0),
  latest,
  missing,
  next: { number: latest + 1, outline: outlines.has(latest + 1) },
  foreshadow: { total: items.length, counts, overdue, dueNow, unplanted, upcoming },
  progress: {
    state: section(progressText, '当前状态'),
    next: section(progressText, '下一步'),
    pending: section(progressText, '等用户决定').filter((l) => l !== '暂无'),
  },
};

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const out = [`━━ 《${report.book}》 ━━`, `工作区：${root}`];
if (!chapters.length) {
  out.push('正文：还没有章节');
} else {
  const last = chapters.find((c) => c.number === latest) ?? chapters[chapters.length - 1];
  out.push(
    `正文：${chapters.length} 章，共 ${report.totalChars} 字（汉字 ${report.totalHan}），最新第 ${latest} 章${last.title ? `《${last.title}》` : ''}`,
  );
  const unnumbered = chapters.filter((c) => Number.isNaN(c.number));
  if (unnumbered.length) out.push(`没有章节号的文件：${unnumbered.map((c) => c.file).join('、')}（建议改名为 第001章.md 这种格式）`);
}
if (missing.length) out.push(`缺章：${missing.map((n) => `第 ${n} 章`).join('、')}`);
out.push(`下一章：第 ${report.next.number} 章，${report.next.outline ? '细纲已写' : '细纲还没写'}`);

out.push('');
const label = (it) => `${it.id}${it.content ? `「${it.content}」` : ''}`;
if (!items.length) {
  out.push('伏笔：伏笔表还是空的');
} else {
  out.push(`伏笔：已埋 ${counts.open} · 已回收 ${counts.closed} · 未埋 ${counts.planned} · 废弃 ${counts.dropped}`);
  for (const it of overdue) out.push(`  逾期：${label(it)} 计划第 ${it.payoff} 章回收，已经过了 ${latest - it.payoff} 章`);
  for (const it of dueNow) out.push(`  本章该收：${label(it)} 计划第 ${it.payoff} 章回收，确认是否已经收了，收了就把状态改成“已回收”`);
  for (const it of unplanted) out.push(`  该埋未埋：${label(it)} 计划第 ${it.plant} 章埋下`);
  for (const it of upcoming) out.push(`  快到期：${label(it)} 计划第 ${it.payoff} 章回收`);
  for (const it of items.filter((i) => i.status === 'unknown')) out.push(`  状态看不懂：${label(it)}“${it.rawStatus}”（请写 未埋 / 已埋 / 已回收 / 废弃）`);
}

if (report.progress.next.length) {
  out.push('', '进度.md · 下一步：', ...report.progress.next.map((l) => `  - ${l}`));
}
if (report.progress.pending.length) {
  out.push('等用户决定：', ...report.progress.pending.map((l) => `  - ${l}`));
}
console.log(out.join('\n'));
