import {
  paragraphs,
  sentences,
  dialogueMask,
  countHan,
  countLetters,
  isLetter,
  mean,
  stdev,
  median,
  round,
  percent,
  padEnd,
  padStart,
} from './zh-text.mjs';

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const HAN_RUN = /[\u4e00-\u9fff]{2,}/gu;
const OPENING_QUOTES = /^[“「『‘"]/u;
const STOP_CHARS = new Set([...'的了着过是在和与而之也就都他她我你它们这那个']);
const SHORT_MAX = 10;
const LONG_MIN = 26;

const PATTERNS = {
  comma: /[，,]/gu,
  period: /。/gu,
  exclaim: /[！!]/gu,
  question: /[？?]/gu,
  ellipsis: /…{1,2}|⋯{1,2}|\.{3,}/gu,
  dash: /—{1,2}/gu,
  semicolon: /[；;]/gu,
  colon: /[：:]/gu,
  enumComma: /、/gu,
  simile: /仿佛|宛如|犹如|宛若|恍若|好似|恍如|如同|好像|像是|似乎/gu,
  redupAdverb: /([\u4e00-\u9fff])\1地(?=[\u4e00-\u9fff])/gu,
  de: /的/gu,
  le: /了/gu,
};

function count(re, text) {
  return text.match(re)?.length ?? 0;
}

const MIN_GRAM = 2;
const MAX_GRAM = 4;

/** 统计 2–4 字的连续汉字片段（含虚词的片段不算），返回 Map<长度, Map<片段, 次数>>。 */
function ngramCounts(text) {
  const byLen = new Map();
  for (let n = MIN_GRAM; n <= MAX_GRAM; n++) byLen.set(n, new Map());
  for (const run of text.match(HAN_RUN) ?? []) {
    const chars = [...run];
    for (let n = MIN_GRAM; n <= MAX_GRAM; n++) {
      const counts = byLen.get(n);
      for (let i = 0; i + n <= chars.length; i++) {
        const gram = chars.slice(i, i + n);
        if (gram.some((c) => STOP_CHARS.has(c))) continue;
        const key = gram.join('');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return byLen;
}

function rawCount(byLen, gram) {
  return byLen.get([...gram].length)?.get(gram) ?? 0;
}

/**
 * 只保留"不总是作为更长片段一部分出现"的片段：脚步、步声总是出现在脚步声里，就只留脚步声。
 * 这样能避开按字切出来的跨词碎片。
 */
function maximalGrams(byLen) {
  const out = new Map();
  for (let n = MIN_GRAM; n <= MAX_GRAM; n++) {
    const superMax = new Map();
    const longer = byLen.get(n + 1);
    if (longer) {
      for (const [h, c] of longer) {
        const chars = [...h];
        for (const sub of [chars.slice(0, n).join(''), chars.slice(1).join('')]) {
          superMax.set(sub, Math.max(superMax.get(sub) ?? 0, c));
        }
      }
    }
    for (const [g, c] of byLen.get(n)) {
      if (c > (superMax.get(g) ?? 0)) out.set(g, c);
    }
  }
  return out;
}

function topGrams(grams, han, limit) {
  return [...grams.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || [...b[0]].length - [...a[0]].length || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .slice(0, limit)
    .map(([gram, c]) => ({ gram, count: c, per10k: han ? round((c * 10000) / han, 1) : 0 }));
}

function corpus(texts) {
  const paras = texts.flatMap((t) => paragraphs(t));
  return { paras, joined: paras.map((p) => p.text).join('\n') };
}

/** 计算一份或多份文字合起来的文风指纹。 */
export function fingerprint(texts, sources = []) {
  const { paras, joined } = corpus(texts);
  const han = countHan(joined);
  const per1000 = (n) => (han ? round((n * 1000) / han, 1) : 0);
  const per100 = (n) => (han ? round((n * 100) / han, 2) : 0);

  const lens = [];
  const openers = new Map();
  let openerTotal = 0;
  let narrationParas = 0;
  let singleParas = 0;
  let letters = 0;
  let dialogueLetters = 0;
  for (const p of paras) {
    const ss = sentences(p.text);
    const mask = dialogueMask(p.text);
    let pl = 0;
    let pin = 0;
    for (let i = 0; i < p.text.length; i++) {
      if (isLetter(p.text[i])) {
        pl++;
        if (mask[i]) pin++;
      }
    }
    letters += pl;
    dialogueLetters += pin;
    const narrative = pl > 0 && pin / pl < 0.5;
    if (narrative) {
      narrationParas++;
      if (ss.length === 1) singleParas++;
    }
    for (const s of ss) {
      lens.push(countLetters(s));
      if (!narrative || OPENING_QUOTES.test(s)) continue;
      const first = [...s].find((ch) => HAN.test(ch));
      if (first) {
        openers.set(first, (openers.get(first) ?? 0) + 1);
        openerTotal++;
      }
    }
  }

  const n = lens.length;
  const avg = mean(lens);
  return {
    version: 1,
    sources,
    han,
    sentences: n,
    paragraphs: paras.length,
    sentence: {
      avg: round(avg, 1),
      median: median(lens),
      cv: avg ? round(stdev(lens) / avg, 2) : 0,
      short: n ? round(lens.filter((l) => l <= SHORT_MAX).length / n, 2) : 0,
      medium: n ? round(lens.filter((l) => l > SHORT_MAX && l < LONG_MIN).length / n, 2) : 0,
      long: n ? round(lens.filter((l) => l >= LONG_MIN).length / n, 2) : 0,
    },
    paragraph: {
      avgHan: paras.length ? round(han / paras.length, 1) : 0,
      singleSentenceRatio: narrationParas ? round(singleParas / narrationParas, 2) : 0,
    },
    dialogueRatio: letters ? round(dialogueLetters / letters, 2) : 0,
    punctuation: {
      comma: per1000(count(PATTERNS.comma, joined)),
      period: per1000(count(PATTERNS.period, joined)),
      exclaim: per1000(count(PATTERNS.exclaim, joined)),
      question: per1000(count(PATTERNS.question, joined)),
      ellipsis: per1000(count(PATTERNS.ellipsis, joined)),
      dash: per1000(count(PATTERNS.dash, joined)),
      semicolon: per1000(count(PATTERNS.semicolon, joined)),
      colon: per1000(count(PATTERNS.colon, joined)),
      enumComma: per1000(count(PATTERNS.enumComma, joined)),
    },
    density: {
      simile: per1000(count(PATTERNS.simile, joined)),
      redupAdverb: per1000(count(PATTERNS.redupAdverb, joined)),
      de: per100(count(PATTERNS.de, joined)),
      le: per100(count(PATTERNS.le, joined)),
    },
    openers: [...openers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([char, c]) => ({ char, share: round(c / openerTotal, 2) })),
    topWords: topGrams(maximalGrams(ngramCounts(joined)), han, 20),
  };
}

export const METRICS = [
  { key: 'sentence.avg', label: '平均句长（字）', get: (f) => f.sentence.avg, mode: 'rel', tol: 0.2 },
  { key: 'sentence.cv', label: '句长变异系数', get: (f) => f.sentence.cv, mode: 'rel', tol: 0.25 },
  { key: 'sentence.short', label: '短句占比', get: (f) => f.sentence.short, mode: 'abs', tol: 0.12, pct: true },
  { key: 'sentence.long', label: '长句占比', get: (f) => f.sentence.long, mode: 'abs', tol: 0.12, pct: true },
  { key: 'paragraph.avgHan', label: '平均段长（字）', get: (f) => f.paragraph.avgHan, mode: 'rel', tol: 0.3 },
  {
    key: 'paragraph.singleSentenceRatio',
    label: '单句段占比',
    get: (f) => f.paragraph.singleSentenceRatio,
    mode: 'abs',
    tol: 0.15,
    pct: true,
  },
  { key: 'dialogueRatio', label: '对话占比', get: (f) => f.dialogueRatio, mode: 'abs', tol: 0.12, pct: true },
  { key: 'punctuation.comma', label: '逗号/千字', get: (f) => f.punctuation.comma, mode: 'rel', tol: 0.2 },
  { key: 'punctuation.exclaim', label: '感叹号/千字', get: (f) => f.punctuation.exclaim, mode: 'rel', tol: 0.6, minAbs: 2 },
  { key: 'punctuation.question', label: '问号/千字', get: (f) => f.punctuation.question, mode: 'rel', tol: 0.6, minAbs: 2 },
  { key: 'punctuation.ellipsis', label: '省略号/千字', get: (f) => f.punctuation.ellipsis, mode: 'rel', tol: 0.6, minAbs: 2 },
  { key: 'punctuation.dash', label: '破折号/千字', get: (f) => f.punctuation.dash, mode: 'rel', tol: 0.6, minAbs: 1 },
  { key: 'density.simile', label: '比喻词/千字', get: (f) => f.density.simile, mode: 'rel', tol: 0.6, minAbs: 1 },
  { key: 'density.de', label: '“的”/百字', get: (f) => f.density.de, mode: 'rel', tol: 0.2 },
  { key: 'density.le', label: '“了”/百字', get: (f) => f.density.le, mode: 'rel', tol: 0.25 },
];

export function diffMetrics(base, current) {
  return METRICS.map((m) => {
    const a = m.get(base);
    const b = m.get(current);
    const delta = round(b - a, 2);
    let rel = null;
    let off;
    if (m.mode === 'abs') {
      off = Math.abs(delta) > m.tol;
    } else {
      rel = a ? delta / a : b ? Infinity : 0;
      off = Math.abs(rel) > m.tol && (m.minAbs === undefined || Math.abs(delta) >= m.minAbs);
    }
    return { key: m.key, label: m.label, base: a, current: b, delta, rel, off, pct: Boolean(m.pct) };
  });
}

/** 和基线比：≥3 项偏离算文风漂移。 */
export function drift(base, current) {
  const metrics = diffMetrics(base, current);
  const offCount = metrics.filter((m) => m.off).length;
  const verdict = offCount >= 3 ? '文风漂移' : offCount > 0 ? '轻微偏离' : '和基线一致';
  return { metrics, offCount, verdict, baseHan: base.han, currentHan: current.han };
}

/** 对比学习：原稿 A 和改稿 B 的指标差异，以及改稿里删掉、新加的高频片段。 */
export function compareTexts(textsA, textsB, names = ['原稿', '改稿']) {
  const fa = fingerprint(textsA);
  const fb = fingerprint(textsB);
  const ca = ngramCounts(corpus(textsA).joined);
  const cb = ngramCounts(corpus(textsB).joined);
  const shifted = (from, to, fromHan, toHan) => {
    const out = [];
    for (const [gram, c] of maximalGrams(from)) {
      const other = rawCount(to, gram);
      if (toHan && fromHan && other / toHan >= c / fromHan / 2) continue;
      out.push({ gram, count: c, other });
    }
    out.sort((x, y) => y.count - x.count || [...y.gram].length - [...x.gram].length);
    const frequent = out.filter((g) => g.count >= 2);
    return (frequent.length >= 3 ? frequent : out).slice(0, 12);
  };
  return {
    names,
    a: fa,
    b: fb,
    metrics: diffMetrics(fa, fb),
    removed: shifted(ca, cb, fa.han, fb.han).map((g) => ({ gram: g.gram, before: g.count, after: g.other })),
    added: shifted(cb, ca, fb.han, fa.han).map((g) => ({ gram: g.gram, before: g.other, after: g.count })),
  };
}

function formatValue(m, v) {
  return m.pct ? percent(v) : String(v);
}

function formatChange(m) {
  if (m.pct) {
    const pp = round(m.delta * 100, 0);
    return `${pp > 0 ? '+' : ''}${pp} 个百分点`;
  }
  if (m.rel === Infinity) return '从无到有';
  if (m.rel === null || Number.isNaN(m.rel)) return '—';
  const r = round(m.rel * 100, 0);
  return `${r > 0 ? '+' : ''}${r}%`;
}

function metricTable(metrics, headA, headB, withStatus) {
  const out = [`${padEnd('指标', 18)}${padStart(headA, 10)}${padStart(headB, 10)}  变化`];
  for (const m of metrics) {
    const status = withStatus ? (m.off ? '  ← 偏离' : '') : '';
    out.push(
      `${padEnd(m.label, 18)}${padStart(formatValue(m, m.base), 10)}${padStart(formatValue(m, m.current), 10)}  ${formatChange(m)}${status}`,
    );
  }
  return out;
}

export function renderFingerprint(fp) {
  const p = fp.punctuation;
  const d = fp.density;
  const out = [
    `━━ 文风指纹${fp.sources.length ? `：${fp.sources.join('、')}` : ''} ━━`,
    `汉字 ${fp.han} · 句子 ${fp.sentences} · 段落 ${fp.paragraphs}`,
    '',
    `句子    平均 ${fp.sentence.avg} 字 · 中位 ${fp.sentence.median} 字 · 变异系数 ${fp.sentence.cv}`,
    `        短句(≤${SHORT_MAX}字) ${percent(fp.sentence.short)} · 中句 ${percent(fp.sentence.medium)} · 长句(≥${LONG_MIN}字) ${percent(fp.sentence.long)}`,
    `段落    平均 ${fp.paragraph.avgHan} 字 · 单句叙述段 ${percent(fp.paragraph.singleSentenceRatio)}`,
    `对话    占比 ${percent(fp.dialogueRatio)}`,
    `标点    每千字：逗号 ${p.comma} · 句号 ${p.period} · 感叹号 ${p.exclaim} · 问号 ${p.question} · 省略号 ${p.ellipsis} · 破折号 ${p.dash} · 顿号 ${p.enumComma}`,
    `用词    每千字比喻词 ${d.simile} · 叠词+地 ${d.redupAdverb} · 每百字“的” ${d.de} · “了” ${d.le}`,
  ];
  if (fp.openers.length) out.push(`句首    ${fp.openers.map((o) => `${o.char} ${percent(o.share)}`).join(' · ')}`);
  if (fp.topWords.length) out.push(`高频词  ${fp.topWords.map((g) => `${g.gram}×${g.count}`).join(' · ')}`);
  if (fp.han < 1500) out.push('', `注意：样本只有 ${fp.han} 字，指标可能不稳定，最好凑够 1500 字以上。`);
  return out.join('\n');
}

export function renderCompare(result) {
  const [na, nb] = result.names;
  const out = [
    `━━ 对比学习 ━━`,
    `原稿：${na}（${result.a.han} 字）`,
    `改稿：${nb}（${result.b.han} 字）`,
    '',
    ...metricTable(result.metrics, '原稿', '改稿', false),
  ];
  const fmt = (g) => `${g.gram}（${g.before}→${g.after}）`;
  if (result.removed.length) out.push('', `改稿删掉或少用的：${result.removed.map(fmt).join(' · ')}`);
  if (result.added.length) out.push(`改稿新加或多用的：${result.added.map(fmt).join(' · ')}`);
  return out.join('\n');
}

export function renderDrift(result, label) {
  const out = [
    `━━ 文风漂移检查：${label} ━━`,
    `结论：${result.verdict}（${result.offCount} 项偏离，3 项及以上算漂移）`,
    '',
    ...metricTable(result.metrics, '基线', '本文', true),
  ];
  const notes = [];
  if (result.baseHan < 1500) notes.push(`基线样本只有 ${result.baseHan} 字`);
  if (result.currentHan < 800) notes.push(`本文只有 ${result.currentHan} 字`);
  if (notes.length) out.push('', `注意：${notes.join('，')}，结论仅供参考。`);
  return out.join('\n');
}
