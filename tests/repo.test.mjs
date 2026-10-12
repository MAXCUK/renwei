import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRIPTS, run } from './helpers.mjs';

test('skill 结构、插件清单、规则库、模板校验通过', () => {
  const r = run(SCRIPTS.validate);
  assert.equal(r.code, 0, r.stderr);
});

test('各 skill 里的 zh-text.mjs 副本和 shared/ 一致', () => {
  const r = run(SCRIPTS.sync, ['--check']);
  assert.equal(r.code, 0, r.stderr);
});

test('presets/ 和 rules.json 一致', () => {
  const r = run(SCRIPTS.presets, ['--check']);
  assert.equal(r.code, 0, r.stderr);
});
