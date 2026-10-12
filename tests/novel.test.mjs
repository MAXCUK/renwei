import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPTS, EXAMPLES, run, tempDir } from './helpers.mjs';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('新建工作区：模板齐全，占位符都替换了', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const result = run(SCRIPTS.init, ['夜班', '--dir', dir]);
  assert.equal(result.code, 0, result.stderr);
  const ws = join(dir, '夜班');
  for (const f of ['进度.md', '设定/立项.md', '设定/去AI味.json', '追踪/伏笔.md', '大纲/细纲/_模板.md']) {
    assert.ok(existsSync(join(ws, f)), `缺少 ${f}`);
  }
  assert.ok(statSync(join(ws, '正文')).isDirectory());
  assert.ok(statSync(join(ws, '审稿')).isDirectory());
  for (const file of walk(ws)) assert.ok(!readFileSync(file, 'utf8').includes('{{'), `${file} 里还有占位符`);
  const progress = readFileSync(join(ws, '进度.md'), 'utf8');
  assert.match(progress, /^# 夜班 · 进度/);
  assert.match(progress, /\d{4}-\d{2}-\d{2}/);
});

test('新建工作区：已存在时拒绝，--force 只补齐不覆盖', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  run(SCRIPTS.init, ['夜班', '--dir', dir]);
  const ws = join(dir, '夜班');
  assert.equal(run(SCRIPTS.init, ['夜班', '--dir', dir]).code, 2);

  writeFileSync(join(ws, '设定', '立项.md'), '我自己写的立项');
  rmSync(join(ws, '追踪', '时间线.md'));
  assert.equal(run(SCRIPTS.init, ['夜班', '--dir', dir, '--force']).code, 0);
  assert.equal(readFileSync(join(ws, '设定', '立项.md'), 'utf8'), '我自己写的立项');
  assert.ok(existsSync(join(ws, '追踪', '时间线.md')));

  assert.equal(run(SCRIPTS.init, ['坏/名字', '--dir', dir]).code, 2);
  assert.equal(run(SCRIPTS.init, []).code, 2);
});

test('进度检查：章节、缺章、细纲、伏笔状态', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  run(SCRIPTS.init, ['夜班', '--dir', dir]);
  const ws = join(dir, '夜班');
  writeFileSync(join(ws, '正文', '第001章.md'), readFileSync(EXAMPLES.human, 'utf8'));
  writeFileSync(join(ws, '正文', '第003章.md'), '# 第三章 冷库\n\n他打开了冷库的门。\n');
  writeFileSync(join(ws, '大纲', '细纲', '第004章.md'), '# 第 4 章\n');
  appendFileSync(
    join(ws, '追踪', '伏笔.md'),
    [
      '| F01 | 登记本上划破的“三号” | 1 | 2 | 已埋 | |',
      '| F02 | 老周的旧伤 | 2 | 3 | 已埋 | |',
      '| F03 | 声控灯自己亮 | 1 | 第五章 | 已埋 | |',
      '| F04 | 父亲的电动车 | 3 | 8 | 未埋 | |',
      '| F05 | 冷库温度计 | 1 | 1 | 已回收 | |',
      '| F06 | 门卫的收音机 | 2 | 4 | 进行到一半 | |',
      '',
    ].join('\n'),
  );

  const report = JSON.parse(run(SCRIPTS.status, [ws, '--json']).stdout);
  assert.equal(report.book, '夜班');
  assert.equal(report.latest, 3);
  assert.deepEqual(report.missing, [2]);
  assert.deepEqual(report.next, { number: 4, outline: true });
  const f = report.foreshadow;
  assert.deepEqual(f.overdue.map((i) => i.id), ['F01']);
  assert.deepEqual(f.dueNow.map((i) => i.id), ['F02']);
  assert.deepEqual(f.unplanted.map((i) => i.id), ['F04']);
  assert.deepEqual(f.upcoming.map((i) => i.id), ['F03']);
  assert.equal(f.counts.closed, 1);
  assert.equal(f.counts.unknown, 1);

  const fromInside = run(SCRIPTS.status, [], { cwd: join(ws, '正文') });
  assert.equal(fromInside.code, 0);
  assert.match(fromInside.stdout, /逾期：F01/);
  assert.match(fromInside.stdout, /状态看不懂：F06/);
});

test('进度检查：不在工作区里时报错', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  assert.equal(run(SCRIPTS.status, [dir]).code, 2);
});
