#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'shared', 'zh-text.mjs');
const skillsWithScripts = ['renwei-deai', 'renwei-style', 'renwei-novel'];
const targets = skillsWithScripts.map((s) => join(root, 'skills', s, 'scripts', 'lib', 'zh-text.mjs'));
const banner = '// 由 shared/zh-text.mjs 同步生成，不要直接修改；改源文件后运行 npm run sync。\n';
const expected = banner + readFileSync(source, 'utf8');
const check = process.argv.includes('--check');

const stale = [];
for (const target of targets) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (current === expected) continue;
  if (check) {
    stale.push(relative(root, target));
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, expected);
    console.log(`已同步 ${relative(root, target)}`);
  }
}

if (check && stale.length) {
  console.error(`这些副本和 shared/zh-text.mjs 不一致，请运行 npm run sync：\n${stale.map((s) => `  ${s}`).join('\n')}`);
  process.exit(1);
}
if (check) console.log('shared/zh-text.mjs 副本一致');
