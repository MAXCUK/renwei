import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  paragraphs,
  sentences,
  dialogueMask,
  maskText,
  countHan,
  countChars,
  countLetters,
  isLetter,
  dialogueRatio,
  mean,
  stdev,
  round,
  percent,
  padEnd,
  padStart,
} from './zh-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = join(here, '..', '..', 'data', 'rules.json');

export const GENRES = {
  default: ['通用', 'default', '默认'],
  dushi: ['都市', '现实', '现代', 'dushi'],
  gufeng: ['古风', '仙侠', '武侠', '历史', '古言', 'gufeng'],
  rexue: ['热血', '爽文', '玄幻', '高武', '系统', 'rexue'],
  xuanyi: ['悬疑', '惊悚', '推理', '恐怖', 'xuanyi'],
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const SEVERITY_LABEL = { high: '【高】', medium: '【中】', low: '【低】' };
const EXCERPT_RADIUS = 12;
const END_PARAGRAPHS = 3;

export function resolveGenre(name) {
  if (name === undefined || name === null || name === '') return 'default';
  const n = String(name).trim().toLowerCase();
  for (const [key, aliases] of Object.entries(GENRES)) {
    if (aliases.some((a) => a.toLowerCase() === n)) return key;
  }
  const options = Object.values(GENRES)
    .map((a) => a[0])
    .join('、');
  throw new Error(`不认识的题材“${name}”，可选：${options}`);
}

export function genreLabel(key) {
  return GENRES[key]?.[0] ?? key;
}

export function loadRuleBook(path = RULES_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 解析自定义禁用词表：每行一个短语，/正则/ 按正则匹配，行尾 "@数字" 表示每万字允许几次。
 * # 开头的行是注释。
 */
export function parseExtraList(text, source = '禁用词表') {
  const rules = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^(.*?)(?:\s+@\s*(\d+(?:\.\d+)?))?$/u);
    const phrase = m[1].trim();
    if (!phrase) return;
    const isRegex = phrase.length > 2 && phrase.startsWith('/') && phrase.endsWith('/');
    const pattern = isRegex ? phrase.slice(1, -1) : escapeRegExp(phrase);
    try {
      new RegExp(pattern, 'u');
    } catch (e) {
      throw new Error(`${source} 第 ${i + 1} 行的正则写错了：${phrase}（${e.message}）`);
    }
    rules.push({
      id: `custom.${rules.length + 1}`,
      category: 'custom',
      name: phrase,
      severity: 'high',
      limit: m[2] ? Number(m[2]) : 0,
      pattern,
      hint: `这是你在${source}里禁掉的写法。`,
    });
  });
  return rules;
}

function splitRefs(refs) {
  return refs.flatMap((a) => String(a).split(/[,，\s]+/u)).filter(Boolean);
}

export function rhythmIds(book) {
  return Object.values(book.stats ?? {}).map((s) => s.id);
}

/** 找出配置里写错的规则 id 或类别名。 */
export function unknownRuleRefs(book, refs) {
  const known = new Set([
    ...book.rules.map((r) => r.id),
    ...Object.keys(book.categories),
    ...rhythmIds(book),
  ]);
  return splitRefs(refs).filter((r) => !known.has(r) && !r.startsWith('custom.'));
}

export function buildRules(book, { genre = 'default', allow = [], limits = {}, extra = [] } = {}) {
  const allowSet = new Set(splitRefs(allow));
  const out = [];
  for (const rule of [...book.rules, ...extra]) {
    if (allowSet.has(rule.id) || allowSet.has(rule.category)) continue;
    let limit = rule.limit ?? 0;
    if (rule.genre && genre in rule.genre) limit = rule.genre[genre];
    if (rule.id in limits) limit = Number(limits[rule.id]);
    out.push({
      ...rule,
      limit,
      scope: rule.scope ?? 'all',
      position: rule.position ?? 'any',
      regex: new RegExp(rule.pattern, 'gu'),
      weight: book.weights[rule.severity] ?? 1,
      categoryName: book.categories[rule.category] ?? rule.category,
    });
  }
  return out;
}

const EDGE = /[\s，。；！？：、,.;!?:]/u;

/** 在一段文字里跑一条规则，返回命中区间。scope 决定只看叙述、只看对话还是全部。 */
export function matchRule(rule, text, mask = dialogueMask(text)) {
  const view = rule.scope === 'all' ? text : maskText(text, mask, rule.scope === 'dialogue' ? 1 : 0);
  const out = [];
  rule.regex.lastIndex = 0;
  let m;
  while ((m = rule.regex.exec(view)) !== null) {
    if (m[0].length === 0) {
      rule.regex.lastIndex++;
      continue;
    }
    let start = m.index;
    let end = m.index + m[0].length;
    while (start < end && EDGE.test(view[start])) start++;
    while (end > start && /\s/u.test(view[end - 1])) end--;
    if (end > start) out.push({ start, end });
  }
  return out;
}

function firstLetter(text) {
  for (const ch of text) if (isLetter(ch)) return ch;
  return null;
}

function hitRecord(p, start, end) {
  const from = Math.max(0, start - EXCERPT_RADIUS);
  const to = Math.min(p.text.length, end + EXCERPT_RADIUS);
  return {
    line: p.line,
    column: start + 1,
    match: p.text.slice(start, end),
    before: (from > 0 ? '…' : '') + p.text.slice(from, start),
    after: p.text.slice(end, to) + (to < p.text.length ? '…' : ''),
  };
}

export function analyzeText(text, rules, book, { file = null, allow = [] } = {}) {
  const allowSet = new Set(splitRefs(allow));
  const paras = paragraphs(text);
  const han = paras.reduce((a, p) => a + countHan(p.text), 0);
  const chars = paras.reduce((a, p) => a + countChars(p.text), 0);
  const endFrom = Math.max(0, paras.length - END_PARAGRAPHS);

  const hitsByRule = new Map();
  paras.forEach((p, idx) => {
    const mask = dialogueMask(p.text);
    const raw = [];
    for (const rule of rules) {
      if (rule.position === 'end' && idx < endFrom) continue;
      for (const span of matchRule(rule, p.text, mask)) raw.push({ rule, ...span });
    }
    raw.sort(
      (a, b) =>
        b.rule.weight - a.rule.weight || b.end - b.start - (a.end - a.start) || a.start - b.start,
    );
    const kept = [];
    for (const h of raw) {
      if (kept.some((k) => h.start < k.end && k.start < h.end)) continue;
      kept.push(h);
    }
    kept.sort((a, b) => a.start - b.start);
    for (const h of kept) {
      if (!hitsByRule.has(h.rule)) hitsByRule.set(h.rule, []);
      hitsByRule.get(h.rule).push(hitRecord(p, h.start, h.end));
    }
  });

  const ruleResults = [];
  for (const [rule, hits] of hitsByRule) {
    const allowed = Math.round((rule.limit * han) / 10000);
    ruleResults.push({
      id: rule.id,
      name: rule.name,
      category: rule.category,
      categoryName: rule.categoryName,
      severity: rule.severity,
      weight: rule.weight,
      limit: rule.limit,
      allowed,
      count: hits.length,
      excess: Math.max(0, hits.length - allowed),
      hint: rule.hint,
      hits,
    });
  }
  ruleResults.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.excess - a.excess || b.count - a.count,
  );

  const sentLens = [];
  let narrationParas = 0;
  let singleParas = 0;
  const openers = [];
  for (const p of paras) {
    const ss = sentences(p.text);
    for (const s of ss) sentLens.push(countLetters(s));
    const mask = dialogueMask(p.text);
    let letters = 0;
    let inside = 0;
    for (let i = 0; i < p.text.length; i++) {
      if (isLetter(p.text[i])) {
        letters++;
        if (mask[i]) inside++;
      }
    }
    const narrative = letters > 0 && inside / letters < 0.5;
    if (narrative) {
      narrationParas++;
      if (ss.length === 1) singleParas++;
    }
    openers.push(narrative ? firstLetter(p.text) : null);
  }
  const avg = mean(sentLens);
  const stats = {
    sentenceCount: sentLens.length,
    avgSentence: round(avg, 1),
    sentenceCV: avg ? round(stdev(sentLens) / avg, 2) : 0,
    narrationParagraphs: narrationParas,
    singleSentenceRatio: narrationParas ? round(singleParas / narrationParas, 2) : 0,
    dialogueRatio: round(dialogueRatio(paras), 2),
  };

  const rhythm = [];
  const S = book.stats ?? {};
  const rhythmOn = (s) => s && !allowSet.has(s.id) && !allowSet.has('rhythm');
  const flag = (s, detail, extra = {}) =>
    rhythm.push({
      id: s.id,
      name: s.name,
      category: 'rhythm',
      severity: s.severity,
      weight: book.weights[s.severity] ?? 1,
      detail,
      hint: s.hint,
      ...extra,
    });
  const cv = S.sentenceCV;
  if (rhythmOn(cv) && stats.sentenceCount >= cv.minSentences && stats.sentenceCV < cv.min) {
    flag(cv, `句长变异系数 ${stats.sentenceCV}，低于 ${cv.min}（平均每句 ${stats.avgSentence} 字）`);
  }
  const ss = S.singleSentenceParagraphs;
  if (rhythmOn(ss) && narrationParas >= ss.minParagraphs && stats.singleSentenceRatio > ss.max) {
    flag(ss, `${percent(stats.singleSentenceRatio)} 的叙述段只有一句话（超过 ${percent(ss.max)}）`);
  }
  const run = S.sameOpeningRun;
  if (rhythmOn(run)) {
    let startIdx = 0;
    for (let i = 1; i <= paras.length; i++) {
      if (i < paras.length && openers[i] !== null && openers[i] === openers[startIdx]) continue;
      const len = i - startIdx;
      if (openers[startIdx] !== null && len > run.maxRun) {
        flag(run, `第 ${paras[startIdx].line}–${paras[i - 1].line} 行连续 ${len} 段以“${openers[startIdx]}”开头`, {
          line: paras[startIdx].line,
        });
      }
      startIdx = i;
    }
  }

  const score =
    ruleResults.reduce((a, r) => a + r.excess * r.weight, 0) + rhythm.reduce((a, r) => a + r.weight, 0);
  const index = round(score / Math.max(1, han / 1000), 1);
  const grade = book.grades.find((g) => g.below === null || index < g.below).label;
  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of ruleResults) counts[r.severity] += r.excess;
  for (const r of rhythm) counts[r.severity] += 1;

  return {
    file,
    chars,
    han,
    paragraphs: paras.length,
    ...stats,
    index,
    grade,
    counts,
    rules: ruleResults,
    rhythm,
  };
}

const ANSI = {
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  yellow: (s) => `\x1b[33m${s}\x1b[39m`,
  cyan: (s) => `\x1b[36m${s}\x1b[39m`,
};
const PLAIN = Object.fromEntries(Object.keys(ANSI).map((k) => [k, (s) => s]));

export function renderText(report, { all = false, color = false, maxHits = 5 } = {}) {
  const c = color ? ANSI : PLAIN;
  const out = [];
  out.push(c.bold(`━━ ${report.file ?? '(输入文本)'} ━━`));
  out.push(
    `字数 ${report.chars} · 汉字 ${report.han} · 句子 ${report.sentenceCount} · 段落 ${report.paragraphs} · 对话占比 ${percent(report.dialogueRatio)}`,
  );
  const { high, medium, low } = report.counts;
  out.push(`AI 腔指数 ${c.bold(String(report.index))}（${report.grade}）· 超额：高 ${high} · 中 ${medium} · 低 ${low}`);

  const over = report.rules.filter((r) => r.excess > 0);
  const within = report.rules.filter((r) => r.excess === 0);
  for (const r of over) {
    const tag = r.severity === 'high' ? c.red(SEVERITY_LABEL[r.severity]) : c.yellow(SEVERITY_LABEL[r.severity]);
    out.push('');
    out.push(`${tag}${r.name} · ${r.categoryName} · ${r.count} 处（本文限额 ${r.allowed}）`);
    const shown = all ? r.hits : r.hits.slice(0, maxHits);
    for (const h of shown) out.push(`  第 ${h.line} 行  ${h.before}${c.red(`[${h.match}]`)}${h.after}`);
    if (shown.length < r.hits.length) out.push(c.dim(`  ……还有 ${r.hits.length - shown.length} 处，加 --all 查看全部`));
    out.push(`  ${c.cyan('改法')}：${r.hint}`);
  }
  for (const r of report.rhythm) {
    out.push('');
    out.push(`${c.yellow('【节奏】')}${r.name} · ${r.detail}`);
    out.push(`  ${c.cyan('改法')}：${r.hint}`);
  }
  if (within.length) {
    out.push('');
    out.push(c.dim(`限额内，不计分：${within.map((r) => `${r.name} ${r.count}/${r.allowed}`).join(' · ')}`));
  }
  if (!over.length && !report.rhythm.length) {
    out.push('');
    out.push('没有发现超额的 AI 腔。');
  }
  return out.join('\n');
}

export function renderSummary(reports) {
  const nameWidth = Math.min(40, Math.max(4, ...reports.map((r) => (r.file ?? '').length + 2)));
  const out = ['', '汇总', `${padEnd('文件', nameWidth)}${padStart('字数', 8)}${padStart('指数', 7)}  评级`];
  for (const r of reports) {
    out.push(`${padEnd(r.file ?? '(输入文本)', nameWidth)}${padStart(r.chars, 8)}${padStart(r.index, 7)}  ${r.grade}`);
  }
  const totalHan = reports.reduce((a, r) => a + r.han, 0);
  const weighted = totalHan ? reports.reduce((a, r) => a + r.index * r.han, 0) / totalHan : 0;
  out.push(`按字数加权的平均指数 ${round(weighted, 1)}`);
  return out.join('\n');
}

export function renderRuleList(book) {
  const out = [];
  for (const [cat, catName] of Object.entries(book.categories)) {
    const rules = book.rules.filter((r) => r.category === cat);
    if (!rules.length) continue;
    out.push(`${catName}（${cat}）`);
    for (const r of rules) {
      const genre = r.genre
        ? `  题材放宽：${Object.entries(r.genre)
            .map(([g, v]) => `${genreLabel(g)} ${v}`)
            .join('，')}`
        : '';
      out.push(
        `  ${padEnd(r.id, 34)}${padEnd(r.name, 22)}${padEnd(SEVERITY_LABEL[r.severity], 6)}每万字限 ${r.limit}${genre}`,
      );
    }
    out.push('');
  }
  out.push('节奏（rhythm）');
  for (const s of Object.values(book.stats ?? {})) out.push(`  ${padEnd(s.id, 34)}${s.name}`);
  return out.join('\n');
}

export function summarize(reports) {
  const totalHan = reports.reduce((a, r) => a + r.han, 0);
  return {
    files: reports.length,
    chars: reports.reduce((a, r) => a + r.chars, 0),
    han: totalHan,
    index: totalHan ? round(reports.reduce((a, r) => a + r.index * r.han, 0) / totalHan, 1) : 0,
    worst: reports.reduce((w, r) => (w === null || r.index > w.index ? r : w), null)?.file ?? null,
  };
}
