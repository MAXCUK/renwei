import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint, compareTexts, drift } from '../skills/renwei-style/scripts/lib/fingerprint.mjs';
import { SCRIPTS, EXAMPLES, run, tempDir } from './helpers.mjs';

const ai = readFileSync(EXAMPLES.ai, 'utf8');
const human = readFileSync(EXAMPLES.human, 'utf8');

test('指纹的基本指标', () => {
  const fp = fingerprint(['他走了。“等等！”她喊。他没回头。']);
  assert.equal(fp.sentences, 3);
  assert.equal(fp.paragraphs, 1);
  assert.equal(fp.dialogueRatio, 0.18);
  assert.equal(fp.han, 11);
});

test('高频词组不出现跨词碎片', () => {
  const grams = fingerprint([human]).topWords.map((g) => g.gram);
  assert.ok(grams.includes('登记本'));
  assert.ok(grams.includes('脚步声'));
  assert.ok(!grams.includes('记本'));
  assert.ok(!grams.includes('步声'));
});

test('对比学习找出删掉和新加的词', () => {
  const result = compareTexts([ai], [human]);
  const removed = result.removed.map((g) => g.gram);
  const added = result.added.map((g) => g.gram);
  assert.ok(removed.includes('仿佛'));
  assert.ok(removed.includes('缓缓'));
  assert.ok(added.includes('登记本'));
  assert.ok(!added.includes('仿佛'));
});

test('漂移判定', () => {
  const base = fingerprint([human]);
  assert.equal(drift(base, fingerprint([ai])).verdict, '文风漂移');
  assert.equal(drift(base, fingerprint([human])).offCount, 0);
});

test('命令行：保存基线、漂移检查、参数错误', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const baseline = join(dir, '设定', '文风指纹.json');
  const saved = run(SCRIPTS.style, [EXAMPLES.human, '--save', baseline]);
  assert.equal(saved.code, 0);
  assert.ok(existsSync(baseline));
  assert.equal(JSON.parse(readFileSync(baseline, 'utf8')).version, 1);

  const checked = run(SCRIPTS.style, [EXAMPLES.ai, '--baseline', baseline]);
  assert.equal(checked.code, 0);
  assert.match(checked.stdout, /文风漂移/);

  const compared = run(SCRIPTS.style, ['--compare', EXAMPLES.ai, EXAMPLES.human]);
  assert.match(compared.stdout, /改稿删掉或少用的/);

  assert.equal(run(SCRIPTS.style, ['--compare', EXAMPLES.ai]).code, 2);
  assert.equal(run(SCRIPTS.style, [EXAMPLES.ai, '--baseline', join(dir, '没有.json')]).code, 2);
});
