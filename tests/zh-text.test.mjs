import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sentences,
  paragraphs,
  dialogueRatio,
  dialogueMask,
  maskText,
  parseChineseNumber,
  chapterNumber,
  parseChapterRef,
  countChars,
  countHan,
  displayWidth,
  isChapterTitle,
} from '../shared/zh-text.mjs';

test('分句：引语加说话人算一句，句中省略号不断句', () => {
  assert.deepEqual(sentences('他走了。“等等！”她喊。'), ['他走了。', '“等等！”她喊。']);
  assert.deepEqual(sentences('“你好！”他说。'), ['“你好！”他说。']);
  assert.deepEqual(sentences('他说……我不知道。'), ['他说……我不知道。']);
  assert.deepEqual(sentences('“我不知道……”她说。'), ['“我不知道……”她说。']);
  assert.deepEqual(sentences('“走！”“去哪？”'), ['“走！”', '“去哪？”']);
  assert.deepEqual(sentences('真的？！不可能。'), ['真的？！', '不可能。']);
});

test('分段：跳过标题、front matter、注释、代码块和章节标题行', () => {
  const text = [
    '---',
    'title: x',
    '---',
    '# 第一章 夜班',
    '第二章 冷库',
    '<!-- 备注 -->',
    '```',
    '代码',
    '```',
    '　　他推开门。',
    '',
    '> 引文段落',
    '---',
    '第二节课下课了。',
  ].join('\n');
  const paras = paragraphs(text);
  assert.deepEqual(
    paras.map((p) => p.text),
    ['他推开门。', '引文段落', '第二节课下课了。'],
  );
  assert.equal(paras[0].line, 10);
});

test('章节标题识别', () => {
  assert.ok(isChapterTitle('第一章 夜班'));
  assert.ok(isChapterTitle('第12章：冷库'));
  assert.ok(!isChapterTitle('第二节课下课了'));
});

test('对话识别与遮罩', () => {
  const text = '他说：“不是我，是他。”然后走了。';
  const mask = dialogueMask(text);
  assert.equal(maskText(text, mask, 1).replace(/。/g, ''), '“不是我，是他”');
  assert.ok(!maskText(text, mask, 0).includes('不是我'));
  const ratio = dialogueRatio([{ line: 1, text: '他走了。“等等！”她喊。他没回头。' }]);
  assert.equal(Math.round(ratio * 100), 18);
});

test('中文数字', () => {
  const cases = { 十: 10, 十二: 12, 二十: 20, 一百零五: 105, 三千二百: 3200, 两千: 2000, 一万二千: 12000, 二〇二六: 2026, 37: 37 };
  for (const [input, expected] of Object.entries(cases)) assert.equal(parseChineseNumber(input), expected, input);
  assert.ok(Number.isNaN(parseChineseNumber('abc')));
  assert.ok(Number.isNaN(parseChineseNumber('')));
});

test('章节号和章节引用', () => {
  assert.equal(chapterNumber('第001章.md'), 1);
  assert.equal(chapterNumber('第十二章-夜班.md'), 12);
  assert.equal(chapterNumber('012.md'), 12);
  assert.ok(Number.isNaN(chapterNumber('序章.md')));
  assert.equal(parseChapterRef('第3章'), 3);
  assert.equal(parseChapterRef('12-15'), 15);
  assert.equal(parseChapterRef('第五章'), 5);
  assert.ok(Number.isNaN(parseChapterRef('待定')));
  assert.ok(Number.isNaN(parseChapterRef('')));
});

test('计数和显示宽度', () => {
  assert.equal(countChars('他 说：\n“好。”'), 7);
  assert.equal(countHan('他说ok，好。'), 3);
  assert.equal(displayWidth('中a'), 3);
});
