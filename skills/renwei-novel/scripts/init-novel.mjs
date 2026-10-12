#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(here, '..', 'assets', 'workspace');
const EMPTY_DIRS = ['正文', '审稿'];
const TEXT_FILE = /\.(md|txt|json)$/i;
const BAD_NAME = /[<>:"/\\|?*\u0000-\u001f]/u;

const USAGE = `人味 · 新建小说工作区

用法：node init-novel.mjs <书名> [--dir <父目录>] [--force]

  --dir <目录>   工作区建在这个目录下（默认当前目录），最终路径是 <目录>/<书名>/
  --force        目录已经存在时，只补齐缺少的文件，已有文件一律不覆盖
  -h, --help     显示帮助`;

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
      dir: { type: 'string' },
      force: { type: 'boolean' },
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

const name = positionals[0]?.trim();
if (!name) fail(USAGE);
if (positionals.length > 1) fail(`书名里有空格的话请加引号，例如 "夜班 第一部"。收到：${positionals.join(' ')}`);
if (BAD_NAME.test(name) || /[. ]$/u.test(name) || name === '.' || name === '..') {
  fail(`书名不能包含 < > : " / \\ | ? * 这些字符，也不能以点或空格结尾：${name}`);
}

const target = resolve(values.dir ?? process.cwd(), name);
if (existsSync(target) && !statSync(target).isDirectory()) fail(`已经有一个同名文件：${target}`);
if (existsSync(target) && readdirSync(target).length && !values.force) {
  fail(`目录已存在且不为空：${target}\n加 --force 只补齐缺少的文件，不会覆盖已有内容。`);
}

const now = new Date();
const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
const created = [];
const kept = [];
const show = (p) => relative(target, p).split(sep).join('/');

function copyTemplates(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTemplates(from, to);
      continue;
    }
    if (existsSync(to)) {
      kept.push(show(to));
      continue;
    }
    let content = readFileSync(from);
    if (TEXT_FILE.test(entry.name)) {
      content = content.toString('utf8').replaceAll('{{书名}}', name).replaceAll('{{日期}}', date);
    }
    writeFileSync(to, content);
    created.push(show(to));
  }
}

copyTemplates(TEMPLATE_DIR, target);
for (const d of EMPTY_DIRS) {
  const p = join(target, d);
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true });
    created.push(`${d}/`);
  }
}

console.log(`${kept.length ? '已补齐' : '已创建'}小说工作区：${target}`);
for (const f of created) console.log(`  + ${f}`);
if (kept.length) console.log(`  （${kept.length} 个文件已存在，没有覆盖）`);
console.log('\n下一步：填写 设定/立项.md，或者直接告诉 AI 你想写一个什么样的故事。');
