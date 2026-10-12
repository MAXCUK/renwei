import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadRuleBook,
  buildRules,
  matchRule,
  analyzeText,
  parseExtraList,
  unknownRuleRefs,
  resolveGenre,
} from '../skills/renwei-deai/scripts/lib/deai.mjs';
import { SCRIPTS, EXAMPLES, run, tempDir } from './helpers.mjs';

const book = loadRuleBook();
const rules = buildRules(book);
const analyze = (text, opts = {}) => analyzeText(text, opts.rules ?? rules, book, opts);
const ids = (report) => report.rules.map((r) => r.id);
const NEUTRAL = ['他把门关上了。', '桌上的茶已经凉透。', '楼下有人在收被子，喊了两声孩子的名字。', '灯管闪了一下。'];

test('每条规则的例句：match 必须命中，nomatch 不能命中', () => {
  for (const rule of rules) {
    for (const ex of rule.match) assert.ok(matchRule(rule, ex).length > 0, `${rule.id} 没有命中：${ex}`);
    for (const ex of rule.nomatch ?? []) {
      const hits = matchRule(rule, ex).map((h) => ex.slice(h.start, h.end));
      assert.deepEqual(hits, [], `${rule.id} 误报：${ex}`);
    }
  }
});

test('AI 原稿评为严重，改稿评为自然', () => {
  const ai = analyze(readFileSync(EXAMPLES.ai, 'utf8'));
  assert.equal(ai.grade, 'AI 腔严重');
  assert.ok(ai.counts.high >= 10, `高级命中只有 ${ai.counts.high}`);
  for (const id of [
    'structure.not-but',
    'structure.rather-than',
    'cliche.mouth-arc',
    'cliche.eye-flash',
    'cliche.frozen-time',
    'sublimation.beginning',
    'sublimation.maybe-this-is',
    'sublimation.narrator-foreshadow',
  ]) {
    assert.ok(ids(ai).includes(id), `AI 原稿应该命中 ${id}`);
  }

  const human = analyze(readFileSync(EXAMPLES.human, 'utf8'));
  assert.ok(human.index < 1, `改稿指数 ${human.index}`);
  assert.equal(human.rules.filter((r) => r.excess > 0).length, 0);
  assert.equal(human.rhythm.length, 0);
});

test('只查叙述的规则不管台词', () => {
  assert.ok(!ids(analyze('“不是我，而是他！”他喊。')).includes('structure.not-but'));
  assert.ok(ids(analyze('这不是结束，而是开始。')).includes('structure.not-but'));
});

test('同一处文字只算级别最高的规则', () => {
  const report = analyze('他嘴角勾起一抹弧度。');
  assert.deepEqual(ids(report), ['cliche.mouth-arc']);
  assert.equal(report.rules[0].hits[0].match, '嘴角勾起一抹弧度');
});

test('命中区间不含开头的标点', () => {
  const report = analyze('他闭上眼。想起父亲，想起老屋，想起那条河。');
  const hit = report.rules.find((r) => r.id === 'structure.triple-repeat').hits[0];
  assert.ok(hit.match.startsWith('想起'));
});

test('章末规则只查最后三段', () => {
  const ending = '他知道，一切都会好起来的。';
  assert.ok(ids(analyze([...NEUTRAL, ending].join('\n'))).includes('sublimation.ending-reflection'));
  assert.ok(!ids(analyze([ending, ...NEUTRAL].join('\n'))).includes('sublimation.ending-reflection'));
});

test('题材会改变限额', () => {
  const filler = '他把门关上，坐回床边，盯着墙上那张旧挂历看了很久，最后还是起身去烧水。';
  let text = '他心里五味杂陈。\n';
  while (analyze(text).han < 1000) text += `${filler}\n`;
  const excess = (report) => report.rules.find((r) => r.id === 'cliche.emotion-idiom')?.excess ?? 0;
  assert.equal(excess(analyze(text)), 1);
  const gufeng = buildRules(book, { genre: resolveGenre('仙侠') });
  assert.equal(excess(analyze(text, { rules: gufeng })), 0);
  assert.equal(resolveGenre('都市'), 'dushi');
  assert.throws(() => resolveGenre('科幻'));
});

test('自定义禁用词表', () => {
  const extra = parseExtraList('# 注释\n邪魅一笑\n/[他她]挑了挑眉/\n倒吸一口凉气 @1\n');
  assert.equal(extra.length, 3);
  assert.equal(extra[1].pattern, '[他她]挑了挑眉');
  assert.equal(extra[2].limit, 1);
  assert.throws(() => parseExtraList('/[坏掉/'), /正则写错了/);
  const report = analyze('她挑了挑眉。', { rules: buildRules(book, { extra }) });
  assert.ok(report.rules.some((r) => r.category === 'custom'));
});

test('allow 能关掉单条规则、整个类别和节奏检查', () => {
  const allowed = buildRules(book, { allow: ['structure.dash', 'modifier'] });
  assert.ok(!allowed.some((r) => r.id === 'structure.dash' || r.category === 'modifier'));
  assert.deepEqual(unknownRuleRefs(book, ['structure.dash', 'modifier', 'rhythm', 'nope.rule']), ['nope.rule']);
});

test('命令行：JSON 输出、退出码、标准输入、错误参数', () => {
  const json = run(SCRIPTS.deai, [EXAMPLES.ai, '--json']);
  assert.equal(json.code, 0);
  assert.equal(JSON.parse(json.stdout).files[0].grade, 'AI 腔严重');

  assert.equal(run(SCRIPTS.deai, [EXAMPLES.ai, '--max-index', '1']).code, 1);
  assert.equal(run(SCRIPTS.deai, [EXAMPLES.human, '--max-index', '1']).code, 0);

  const stdin = run(SCRIPTS.deai, ['-', '--json'], { input: '他嘴角勾起一抹弧度。' });
  assert.equal(JSON.parse(stdin.stdout).files[0].rules[0].id, 'cliche.mouth-arc');

  assert.equal(run(SCRIPTS.deai, ['不存在的文件.md']).code, 2);
  assert.equal(run(SCRIPTS.deai, [EXAMPLES.ai, '--genre', '科幻']).code, 2);

  const list = run(SCRIPTS.deai, ['--list-rules']).stdout;
  for (const rule of book.rules) assert.ok(list.includes(rule.id), `--list-rules 缺少 ${rule.id}`);
});

test('命令行：自动读取工作区的禁用词和配置', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  assert.equal(run(SCRIPTS.init, ['测试书', '--dir', dir]).code, 0);
  const ws = join(dir, '测试书');
  writeFileSync(join(ws, '设定', '禁用词.txt'), '灯亮了\n');
  writeFileSync(
    join(ws, '设定', '去AI味.json'),
    JSON.stringify({ genre: '都市', allow: ['cliche.weather-opening', 'nope.rule'], limits: {} }),
  );
  const chapter = join(ws, '正文', '第001章.md');
  writeFileSync(chapter, '# 第一章\n\n夜色如墨，走廊的灯亮了。\n');

  const withWs = JSON.parse(run(SCRIPTS.deai, [chapter, '--json']).stdout).files[0];
  assert.ok(withWs.rules.some((r) => r.category === 'custom'));
  assert.ok(!withWs.rules.some((r) => r.id === 'cliche.weather-opening'));
  assert.equal(withWs.genre, '都市');

  const text = run(SCRIPTS.deai, [chapter]).stdout;
  assert.match(text, /已读取工作区配置/);
  assert.match(text, /nope\.rule/);

  const without = JSON.parse(run(SCRIPTS.deai, [chapter, '--json', '--no-workspace']).stdout).files[0];
  assert.ok(!without.rules.some((r) => r.category === 'custom'));
  assert.ok(without.rules.some((r) => r.id === 'cliche.weather-opening'));
});

test('命令行：目录按章节号排序，多文件输出汇总', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  writeFileSync(join(dir, '第10章.md'), readFileSync(EXAMPLES.human, 'utf8'));
  writeFileSync(join(dir, '第2章.md'), readFileSync(EXAMPLES.ai, 'utf8'));
  writeFileSync(join(dir, '_模板.md'), '嘴角勾起一抹弧度');
  const out = JSON.parse(run(SCRIPTS.deai, [dir, '--json', '--no-workspace']).stdout);
  assert.deepEqual(
    out.files.map((f) => f.file.split(/[\\/]/).pop()),
    ['第2章.md', '第10章.md'],
  );
  assert.equal(out.summary.files, 2);
  assert.match(run(SCRIPTS.deai, [dir, '--no-workspace']).stdout, /汇总/);
});
