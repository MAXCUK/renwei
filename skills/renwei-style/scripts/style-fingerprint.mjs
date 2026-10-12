#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { listTextFiles, readText } from './lib/zh-text.mjs';
import { fingerprint, compareTexts, drift, renderFingerprint, renderCompare, renderDrift } from './lib/fingerprint.mjs';

const USAGE = `人味 · 文风指纹

用法：
  node style-fingerprint.mjs <样本…>                              计算文风指纹
  node style-fingerprint.mjs <样本…> --save 设定/文风指纹.json      计算并保存为基线
  node style-fingerprint.mjs --compare <原稿> <改稿>               对比两份文字（对比学习）
  node style-fingerprint.mjs <章节…> --baseline 设定/文风指纹.json  检查是否偏离基线

选项：
  --json        输出 JSON
  -h, --help    显示帮助

可以传文件或目录（目录取其中的 .md / .txt，跳过 _ 开头的模板）。`;

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
      save: { type: 'string' },
      compare: { type: 'boolean' },
      baseline: { type: 'string' },
      json: { type: 'boolean' },
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
if (!positionals.length) fail(USAGE);

function load(paths) {
  for (const p of paths) if (!existsSync(p)) fail(`找不到文件或目录：${p}`);
  const files = listTextFiles(paths);
  if (!files.length) fail('没有找到 .md 或 .txt 文件。');
  return { files, texts: files.map((f) => readText(f)) };
}

const print = (data, text) => console.log(values.json ? JSON.stringify(data, null, 2) : text);

if (values.compare) {
  if (positionals.length !== 2) fail('--compare 需要正好两个参数：原稿和改稿。');
  const a = load([positionals[0]]);
  const b = load([positionals[1]]);
  const result = compareTexts(a.texts, b.texts, [basename(positionals[0]), basename(positionals[1])]);
  print(result, renderCompare(result));
} else if (values.baseline) {
  if (!existsSync(values.baseline)) fail(`找不到基线文件：${values.baseline}（先用 --save 生成）`);
  let base;
  try {
    base = JSON.parse(readFileSync(values.baseline, 'utf8'));
  } catch (e) {
    fail(`${values.baseline} 不是合法的 JSON：${e.message}`);
  }
  if (base.version !== 1 || !base.sentence) fail(`${values.baseline} 不是 style-fingerprint 生成的基线文件。`);
  const { files, texts } = load(positionals);
  const current = fingerprint(texts, files.map((f) => basename(f)));
  const result = drift(base, current);
  print({ ...result, baseline: values.baseline, files }, renderDrift(result, files.map((f) => basename(f)).join('、')));
} else {
  const { files, texts } = load(positionals);
  const fp = fingerprint(texts, files.map((f) => basename(f)));
  fp.createdAt = new Date().toISOString().slice(0, 10);
  if (values.save) {
    mkdirSync(dirname(values.save), { recursive: true });
    writeFileSync(values.save, `${JSON.stringify(fp, null, 2)}\n`);
  }
  print(fp, renderFingerprint(fp) + (values.save ? `\n\n已保存基线：${values.save}` : ''));
}
