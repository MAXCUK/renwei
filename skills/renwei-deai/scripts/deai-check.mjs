#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { listTextFiles, findWorkspaceRoot, readText } from './lib/zh-text.mjs';
import {
  loadRuleBook,
  buildRules,
  parseExtraList,
  resolveGenre,
  genreLabel,
  analyzeText,
  renderText,
  renderSummary,
  renderRuleList,
  unknownRuleRefs,
  summarize,
} from './lib/deai.mjs';

const USAGE = `人味 · 去 AI 味检测

用法：node deai-check.mjs <文件或目录…> [选项]
      node deai-check.mjs - < 正文.txt          从标准输入读

选项：
  --genre <题材>     通用 | 都市 | 古风 | 热血 | 悬疑。古风、热血会放宽成语、比喻、“道”等限额
  --extra <文件>     追加自定义禁用词表（每行一个短语，/正则/ 也行，行尾 @2 表示每万字允许 2 次）
  --allow <规则>     跳过规则或整个类别，逗号分隔，例如 structure.dash,modifier
  --no-workspace     不自动读取工作区里的 设定/禁用词.txt 和 设定/去AI味.json
  --json             输出 JSON
  --all              列出每条规则的全部命中（默认每条最多 5 处）
  --max-index <数>   任一文件的 AI 腔指数超过这个值时，退出码为 1
  --list-rules       列出全部规则
  -h, --help         显示帮助

目录会展开成其中的 .md / .txt 文件（跳过 _ 开头的模板），按章节号排序。`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      genre: { type: 'string' },
      extra: { type: 'string', multiple: true },
      allow: { type: 'string', multiple: true },
      'no-workspace': { type: 'boolean' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      'max-index': { type: 'string' },
      'list-rules': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  fail(`${e.message}\n\n${USAGE}`);
}
const { values, positionals } = parsed;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const book = loadRuleBook();
if (values['list-rules']) {
  console.log(renderRuleList(book));
  process.exit(0);
}
if (!positionals.length) fail(USAGE);

let maxIndex = null;
if (values['max-index'] !== undefined) {
  maxIndex = Number(values['max-index']);
  if (!Number.isFinite(maxIndex)) fail(`--max-index 需要一个数字，收到“${values['max-index']}”`);
}

let cliGenre = null;
try {
  if (values.genre) cliGenre = resolveGenre(values.genre);
} catch (e) {
  fail(e.message);
}

const cliExtra = [];
for (const file of values.extra ?? []) {
  if (!existsSync(file)) fail(`找不到禁用词表：${file}`);
  try {
    cliExtra.push(...parseExtraList(readText(file), file));
  } catch (e) {
    fail(e.message);
  }
}
const cliAllow = values.allow ?? [];

const displayName = (file) => {
  const rel = relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file;
};

const inputs = [];
for (const p of positionals) {
  if (p === '-') {
    inputs.push({ name: '(标准输入)', text: readFileSync(0, 'utf8'), lookup: process.cwd() });
    continue;
  }
  if (!existsSync(p)) fail(`找不到文件或目录：${p}`);
  for (const f of listTextFiles([p])) inputs.push({ name: displayName(f), path: f, lookup: f });
}
if (!inputs.length) fail('没有找到 .md 或 .txt 文件。');

const contexts = new Map();
function contextFor(input) {
  const root = values['no-workspace'] ? null : findWorkspaceRoot(input.lookup);
  const key = root ?? '';
  if (contexts.has(key)) return contexts.get(key);

  let config = {};
  let extra = [];
  const loaded = [];
  if (root) {
    const configPath = join(root, '设定', '去AI味.json');
    const listPath = join(root, '设定', '禁用词.txt');
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readText(configPath));
      } catch (e) {
        fail(`${displayName(configPath)} 不是合法的 JSON：${e.message}`);
      }
      loaded.push(displayName(configPath));
    }
    if (existsSync(listPath)) {
      try {
        extra = parseExtraList(readText(listPath), '设定/禁用词.txt');
      } catch (e) {
        fail(e.message);
      }
      if (extra.length) loaded.push(`${displayName(listPath)}（${extra.length} 条）`);
    }
  }

  let genre;
  try {
    genre = cliGenre ?? resolveGenre(config.genre);
  } catch (e) {
    fail(`设定/去AI味.json：${e.message}`);
  }
  const allow = [...(config.allow ?? []), ...cliAllow];
  const limits = config.limits ?? {};
  const unknown = unknownRuleRefs(book, [...allow, ...Object.keys(limits)]);
  const rules = buildRules(book, { genre, allow, limits, extra: [...extra, ...cliExtra] });
  const ctx = { root, genre, allow, rules, loaded, unknown };
  contexts.set(key, ctx);
  return ctx;
}

const reports = inputs.map((input) => {
  const ctx = contextFor(input);
  const text = input.text ?? readText(input.path);
  const report = analyzeText(text, ctx.rules, book, { file: input.name, allow: ctx.allow });
  report.genre = genreLabel(ctx.genre);
  report.workspace = ctx.root ? displayName(ctx.root) : null;
  return report;
});

if (values.json) {
  console.log(JSON.stringify({ files: reports, summary: summarize(reports) }, null, 2));
} else {
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const notes = [];
  for (const ctx of contexts.values()) {
    if (ctx.loaded.length) notes.push(`已读取工作区配置：${ctx.loaded.join('、')}`);
    if (ctx.genre !== 'default') notes.push(`题材：${genreLabel(ctx.genre)}`);
    if (ctx.unknown.length) notes.push(`注意：这些规则名不存在，已忽略：${ctx.unknown.join('、')}（用 --list-rules 查看全部）`);
  }
  if (notes.length) console.log(`${[...new Set(notes)].join('\n')}\n`);
  console.log(reports.map((r) => renderText(r, { all: values.all, color })).join('\n\n'));
  if (reports.length > 1) console.log(renderSummary(reports));
}

if (maxIndex !== null && reports.some((r) => r.index > maxIndex)) process.exit(1);
