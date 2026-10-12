#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const book = JSON.parse(readFileSync(join(root, 'skills', 'renwei-deai', 'data', 'rules.json'), 'utf8'));
const outDir = join(root, 'presets');
const check = process.argv.includes('--check');

// p-e-w（XTC 和 DRY 的作者）推荐的起手值：其余采样器全部关掉，只留 Min P、XTC、DRY。
const SAMPLING = {
  temperature: 1,
  min_p: 0.02,
  xtc_threshold: 0.1,
  xtc_probability: 0.5,
  dry_multiplier: 0.8,
  dry_base: 1.75,
  dry_allowed_length: 2,
};

const phrases = [...new Set(book.rules.flatMap((r) => r.ban ?? []))];
const regexes = book.rules.filter((r) => r.regexBan).map((r) => r.pattern);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const files = {
  'banned-strings.txt': `${phrases.join('\n')}\n`,
  'sillytavern-banned-strings.txt': `${phrases.map((p) => JSON.stringify(p)).join('\n')}\n`,
  'antislop-regex.json': json(regexes),
  'koboldcpp-generate.json': json({
    prompt: '把提示词放在这里',
    max_length: 600,
    ...SAMPLING,
    top_p: 1,
    top_k: 0,
    rep_pen: 1,
    banned_tokens: phrases,
  }),
  'llama-server-sampling.json': json({ ...SAMPLING, top_p: 1, top_k: 0, repeat_penalty: 1 }),
};

const stale = [];
mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = join(outDir, name);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) continue;
  if (check) {
    stale.push(relative(root, path));
  } else {
    writeFileSync(path, content);
    console.log(`已生成 ${relative(root, path)}`);
  }
}

if (check && stale.length) {
  console.error(`这些预设和 rules.json 不一致，请运行 npm run presets：\n${stale.map((s) => `  ${s}`).join('\n')}`);
  process.exit(1);
}
if (check) console.log(`presets/ 与 rules.json 一致（${phrases.length} 条禁用短语，${regexes.length} 条正则）`);
