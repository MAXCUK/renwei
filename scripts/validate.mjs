#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const report = (where, message) => problems.push(`${where}：${message}`);
const readJson = (rel) => {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (e) {
    report(rel, `读不出合法的 JSON（${e.message}）`);
    return null;
  }
};

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const GENRES = new Set(['default', 'dushi', 'gufeng', 'rexue', 'xuanyi']);
const SEVERITIES = new Set(['high', 'medium', 'low']);
const SCOPES = new Set(['all', 'narration', 'dialogue']);
const POSITIONS = new Set(['any', 'end']);

/** 只解析 SKILL.md 用到的 YAML 子集：顶层 key: value，以及 metadata 下一层缩进的键值。 */
function parseFrontmatter(text, where) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) {
    report(where, '缺少 YAML frontmatter');
    return { data: {}, body: text };
  }
  const data = {};
  let parent = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const nested = line.match(/^ {2}([\w-]+):\s*(.*)$/);
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (nested && parent) {
      data[parent][nested[1]] = nested[2].replace(/^"(.*)"$/, '$1');
      continue;
    }
    if (!top) {
      report(where, `frontmatter 这一行看不懂：${line}`);
      continue;
    }
    const [, key, value] = top;
    if (value === '') {
      data[key] = {};
      parent = key;
      continue;
    }
    parent = null;
    if (!/^".*"$/.test(value) && (/: |\s#/.test(value) || /^[&*!|>'"%@`{[\],?-]/.test(value))) {
      report(where, `${key} 的值含有 YAML 特殊字符，需要加引号`);
    }
    data[key] = value.replace(/^"(.*)"$/, '$1');
  }
  return { data, body: text.slice(m[0].length) };
}

function checkSkills() {
  const skillsDir = join(root, 'skills');
  const names = readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory());
  if (!names.length) report('skills/', '没有任何 skill');
  for (const dir of names) {
    const where = `skills/${dir}/SKILL.md`;
    const path = join(skillsDir, dir, 'SKILL.md');
    if (!existsSync(path)) {
      report(where, '文件不存在');
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const { data, body } = parseFrontmatter(text, where);
    if (data.name !== dir) report(where, `name（${data.name}）必须和目录名（${dir}）一致`);
    if (!NAME.test(data.name ?? '') || (data.name ?? '').length > 64) {
      report(where, 'name 只能用小写字母、数字和单个连字符，最长 64 个字符');
    }
    const desc = data.description ?? '';
    if (!desc) report(where, '缺少 description');
    if (desc.length > 1024) report(where, `description 超过 1024 个字符（${desc.length}）`);
    const lines = text.split('\n').length;
    if (lines > 500) report(where, `超过 500 行（${lines}）`);
    for (const ref of body.matchAll(/`((?:references|scripts|data|assets)\/[^`\s]+)`/g)) {
      if (!existsSync(join(skillsDir, dir, ref[1]))) report(where, `引用的文件不存在：${ref[1]}`);
    }
  }
  return names;
}

function checkManifests(skillNames) {
  const cursorPlugin = readJson('.cursor-plugin/plugin.json');
  const cursorMarket = readJson('.cursor-plugin/marketplace.json');
  const claudePlugin = readJson('.claude-plugin/plugin.json');
  const claudeMarket = readJson('.claude-plugin/marketplace.json');
  const pluginKeys = new Set([
    'name', 'displayName', 'description', 'version', 'minClientVersions', 'author', 'publisher', 'homepage',
    'repository', 'license', 'logo', 'keywords', 'category', 'tags', 'commands', 'agents', 'skills', 'rules',
    'hooks', 'variables', 'mcpServers',
  ]);
  const entryKeys = new Set(['name', 'source', 'description', 'minClientVersions']);
  const kebab = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

  if (cursorPlugin) {
    for (const k of Object.keys(cursorPlugin)) if (!pluginKeys.has(k)) report('.cursor-plugin/plugin.json', `schema 不允许的字段：${k}`);
    if (!kebab.test(cursorPlugin.name ?? '')) report('.cursor-plugin/plugin.json', 'name 必须是小写 kebab-case');
    if (cursorPlugin.skills && !existsSync(join(root, cursorPlugin.skills))) {
      report('.cursor-plugin/plugin.json', `skills 路径不存在：${cursorPlugin.skills}`);
    }
  }
  for (const [where, market, plugin] of [
    ['.cursor-plugin/marketplace.json', cursorMarket, cursorPlugin],
    ['.claude-plugin/marketplace.json', claudeMarket, claudePlugin],
  ]) {
    if (!market) continue;
    if (!market.name || !Array.isArray(market.plugins)) report(where, '需要 name 和 plugins');
    for (const entry of market.plugins ?? []) {
      if (where.startsWith('.cursor')) {
        for (const k of Object.keys(entry)) if (!entryKeys.has(k)) report(where, `插件条目里 schema 不允许的字段：${k}`);
      }
      if (!entry.name || !entry.source) report(where, '插件条目需要 name 和 source');
      if (plugin && entry.name !== plugin.name) report(where, `插件名 ${entry.name} 和 plugin.json 的 ${plugin.name} 不一致`);
      if (entry.source && !existsSync(join(root, entry.source))) report(where, `source 路径不存在：${entry.source}`);
    }
  }
  const pkg = readJson('package.json');
  for (const [where, m] of [
    ['.cursor-plugin/plugin.json', cursorPlugin],
    ['.claude-plugin/plugin.json', claudePlugin],
  ]) {
    if (m && pkg && m.version !== pkg.version) report(where, `version（${m.version}）和 package.json（${pkg.version}）不一致`);
  }
  if (!skillNames.length) report('skills/', '插件里没有 skill');
}

function checkRules() {
  const where = 'skills/renwei-deai/data/rules.json';
  const book = readJson(where);
  if (!book) return;
  const ids = new Set();
  for (const rule of book.rules) {
    const at = `${where} ${rule.id ?? '(无 id)'}`;
    if (!rule.id || ids.has(rule.id)) report(at, 'id 缺失或重复');
    ids.add(rule.id);
    if (!rule.id?.startsWith(`${rule.category}.`)) report(at, 'id 要以类别开头，例如 cliche.xxx');
    if (!(rule.category in book.categories)) report(at, `未知类别 ${rule.category}`);
    if (!SEVERITIES.has(rule.severity)) report(at, `未知级别 ${rule.severity}`);
    if (!(typeof rule.limit === 'number' && rule.limit >= 0)) report(at, 'limit 必须是非负数字');
    if (rule.scope && !SCOPES.has(rule.scope)) report(at, `未知 scope ${rule.scope}`);
    if (rule.position && !POSITIONS.has(rule.position)) report(at, `未知 position ${rule.position}`);
    for (const g of Object.keys(rule.genre ?? {})) if (!GENRES.has(g)) report(at, `未知题材 ${g}`);
    if (!rule.name || !rule.hint) report(at, '缺少 name 或 hint');
    if (!rule.match?.length) report(at, '至少要有一条 match 例句');
    try {
      new RegExp(rule.pattern, 'gu');
    } catch (e) {
      report(at, `正则写错了：${e.message}`);
    }
    if (rule.regexBan && /\\p\{|\(\?<(?![=!])|\\k</.test(rule.pattern)) {
      report(at, 'regexBan 的正则要兼容 Python：不能用 \\p{…}、命名分组或 \\k 反向引用');
    }
  }
  for (const s of Object.values(book.stats ?? {})) {
    if (!s.id?.startsWith('rhythm.')) report(`${where} stats`, `节奏检查的 id 要以 rhythm. 开头：${s.id}`);
    if (!SEVERITIES.has(s.severity)) report(`${where} ${s.id}`, `未知级别 ${s.severity}`);
  }
}

function checkWorkspaceTemplates() {
  const base = 'skills/renwei-novel/assets/workspace';
  const required = [
    '进度.md', '设定/立项.md', '设定/人物.md', '设定/世界.md', '设定/文风.md', '设定/不可改动.md',
    '设定/禁用词.txt', '设定/去AI味.json', '大纲/全书.md', '大纲/细纲/_模板.md', '追踪/伏笔.md',
    '追踪/人物状态.md', '追踪/时间线.md', '追踪/章节摘要.md',
  ];
  for (const f of required) if (!existsSync(join(root, base, f))) report(`${base}/${f}`, '模板缺失');
  const foreshadow = join(root, base, '追踪/伏笔.md');
  if (existsSync(foreshadow)) {
    const header = readFileSync(foreshadow, 'utf8').split('\n').find((l) => l.startsWith('|')) ?? '';
    for (const col of ['编号', '内容', '埋设章', '计划回收章', '状态']) {
      if (!header.includes(col)) report(`${base}/追踪/伏笔.md`, `表头缺少“${col}”，novel-status.mjs 靠它找列`);
    }
  }
  readJson(`${base}/设定/去AI味.json`);
}

const skillNames = checkSkills();
checkManifests(skillNames);
checkRules();
checkWorkspaceTemplates();

if (problems.length) {
  console.error(`发现 ${problems.length} 个问题：\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`校验通过：${skillNames.length} 个 skill（${skillNames.join('、')}），插件清单、规则库、工作区模板均正常`);
