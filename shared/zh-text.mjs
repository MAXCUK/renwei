import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';

const HAN_G = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;
const LETTER = /[\p{L}\p{N}]/u;
const LETTER_G = /[\p{L}\p{N}]/gu;
const CN_NUM = '0-9零〇一二两三四五六七八九十百千万';
const CHAPTER_TITLE = new RegExp(`^第\\s*[${CN_NUM}]+\\s*[章回节卷集](?:\\s|$|[：:，,、·\\-—])`, 'u');

const TERMINAL = new Set(['。', '！', '？', '!', '?']);
const ELLIPSIS = new Set(['…', '⋯']);
const QUOTE_CLOSERS = new Set(['”', '’', '」', '』', '"', "'"]);
const CLOSERS = new Set([...QUOTE_CLOSERS, '）', ')', '】', '》', ']']);
const OPEN_QUOTES = new Set(['“', '「', '『', '‘']);
const CLOSE_QUOTES = new Set(['”', '」', '』', '’']);

export function readText(file) {
  let text = readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, '\n');
}

export function countHan(text) {
  return text.match(HAN_G)?.length ?? 0;
}

export function countLetters(text) {
  return text.match(LETTER_G)?.length ?? 0;
}

export function countChars(text) {
  return text.replace(/\s/gu, '').length;
}

export function isLetter(ch) {
  return ch !== undefined && LETTER.test(ch);
}

export function isChapterTitle(line) {
  return CHAPTER_TITLE.test(line) && countLetters(line) <= 30;
}

function frontMatterEnd(lines) {
  if (lines[0]?.trim() !== '---') return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i;
  }
  return -1;
}

/** 把正文拆成段落：每个非空行算一段，跳过 Markdown 标题、分隔线、注释、代码块、front matter 和"第N章"标题行。 */
export function paragraphs(text) {
  const lines = text.split('\n');
  const skipUntil = frontMatterEnd(lines);
  const out = [];
  let fence = false;
  let comment = false;
  for (let i = skipUntil + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^(```|~~~)/.test(t)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (comment) {
      if (t.includes('-->')) comment = false;
      continue;
    }
    if (t.startsWith('<!--')) {
      if (!t.includes('-->')) comment = true;
      continue;
    }
    if (!t) continue;
    if (/^#{1,6}(\s|$)/.test(t)) continue;
    if (/^([-*_=]\s*){3,}$/.test(t)) continue;
    if (isChapterTitle(t)) continue;
    out.push({ line: i + 1, text: t.replace(/^>\s?/, '') });
  }
  return out;
}

/** 中文分句。“……！”他说。 这类引语加说话人算一句；句中的省略号不断句。 */
export function sentences(text) {
  const out = [];
  const chars = Array.from(text);
  let buf = '';
  const push = () => {
    const s = buf.trim();
    if (countLetters(s) > 0) out.push(s);
    buf = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    buf += c;
    let end = TERMINAL.has(c);
    if (!end && ELLIPSIS.has(c)) {
      const next = chars[i + 1];
      end = next === undefined || CLOSERS.has(next) || /\s/u.test(next);
    }
    if (!end) continue;
    let closedQuote = false;
    while (i + 1 < chars.length) {
      const n = chars[i + 1];
      if (TERMINAL.has(n) || ELLIPSIS.has(n)) {
        buf += n;
        i++;
        closedQuote = false;
      } else if (CLOSERS.has(n)) {
        buf += n;
        i++;
        closedQuote = QUOTE_CLOSERS.has(n);
      } else {
        break;
      }
    }
    if (closedQuote && isLetter(chars[i + 1])) continue;
    push();
  }
  push();
  return out;
}

/** 返回与 text 等长的数组，1 表示该位置在引号（对话）里。 */
export function dialogueMask(text) {
  const mask = new Uint8Array(text.length);
  let depth = 0;
  let straight = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (OPEN_QUOTES.has(c)) {
      depth++;
      mask[i] = 1;
    } else if (CLOSE_QUOTES.has(c)) {
      mask[i] = 1;
      if (depth > 0) depth--;
    } else if (c === '"') {
      mask[i] = 1;
      straight = !straight;
    } else {
      mask[i] = depth > 0 || straight ? 1 : 0;
    }
  }
  return mask;
}

/**
 * 只保留对话（keep = 1）或只保留叙述（keep = 0）。被遮住的字符换成"。"，
 * 让正则把遮住的部分当成句子边界，不会跨过它去匹配。
 */
export function maskText(text, mask, keep) {
  let out = '';
  for (let i = 0; i < text.length; i++) out += mask[i] === keep ? text[i] : '。';
  return out;
}

export function dialogueRatio(paras) {
  let inside = 0;
  let total = 0;
  for (const p of paras) {
    const mask = dialogueMask(p.text);
    for (let i = 0; i < p.text.length; i++) {
      if (isLetter(p.text[i])) {
        total++;
        if (mask[i]) inside++;
      }
    }
  }
  return total ? inside / total : 0;
}

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 };

/** "十二" → 12，"一百零五" → 105，"二〇二六" → 2026，"37" → 37；无法解析返回 NaN。 */
export function parseChineseNumber(s) {
  s = String(s).trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (!s) return NaN;
  if (!/[十百千万]/.test(s)) {
    let digits = '';
    for (const c of s) {
      if (!(c in CN_DIGIT)) return NaN;
      digits += CN_DIGIT[c];
    }
    return Number(digits);
  }
  let total = 0;
  let section = 0;
  let num = 0;
  for (const c of s) {
    if (c in CN_DIGIT) num = CN_DIGIT[c];
    else if (c in CN_UNIT) {
      section += (num || 1) * CN_UNIT[c];
      num = 0;
    } else if (c === '万') {
      total += (section + num || 1) * 10000;
      section = 0;
      num = 0;
    } else if (/\d/.test(c)) {
      num = num * 10 + Number(c);
    } else {
      return NaN;
    }
  }
  return total + section + num;
}

/** 从文件名取章节号：第001章.md、第十二章-夜班.md、012.md。取不到返回 NaN。 */
export function chapterNumber(name) {
  const base = basename(String(name)).replace(/\.[^.]+$/, '');
  const m = base.match(new RegExp(`第\\s*([${CN_NUM}]+)\\s*[章回节]`, 'u'));
  if (m) return parseChineseNumber(m[1]);
  const d = base.match(/^(\d+)/);
  return d ? Number(d[1]) : NaN;
}

/** 解析表格里的章节引用："3"、"第3章"、"第十二章"、"12-15"（取后一个）。"待定"、空白返回 NaN。 */
export function parseChapterRef(value) {
  const parts = String(value ?? '').match(new RegExp(`[${CN_NUM}]+`, 'gu'));
  return parts ? parseChineseNumber(parts[parts.length - 1]) : NaN;
}

export function compareChapterNames(a, b) {
  const na = chapterNumber(a);
  const nb = chapterNumber(b);
  const ha = !Number.isNaN(na);
  const hb = !Number.isNaN(nb);
  if (ha && hb && na !== nb) return na - nb;
  if (ha !== hb) return ha ? -1 : 1;
  return a.localeCompare(b, 'zh-Hans-CN');
}

/** 展开输入：文件原样保留，目录取其中的 .md/.txt（不含 _ 和 . 开头的文件），按章节号排序。 */
export function listTextFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    if (statSync(input).isDirectory()) {
      const names = readdirSync(input).filter(
        (n) => /\.(md|txt)$/i.test(n) && !n.startsWith('_') && !n.startsWith('.'),
      );
      names.sort(compareChapterNames);
      for (const n of names) files.push(join(input, n));
    } else {
      files.push(input);
    }
  }
  return files;
}

/** 从文件或目录往上找小说工作区（同时有 进度.md 和 设定/ 的目录）。 */
export function findWorkspaceRoot(startPath) {
  let dir = resolve(startPath);
  try {
    if (statSync(dir).isFile()) dir = dirname(dir);
  } catch {
    return null;
  }
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(dir, '进度.md')) && existsSync(join(dir, '设定'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function round(x, digits = 2) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export function percent(x, digits = 0) {
  return `${round(x * 100, digits)}%`;
}

export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

export function padEnd(s, width) {
  s = String(s);
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

export function padStart(s, width) {
  s = String(s);
  return ' '.repeat(Math.max(0, width - displayWidth(s))) + s;
}

/** 截取 [start, end) 附近的上下文，长了用省略号。 */
export function excerpt(text, start, end, radius = 12) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
}
