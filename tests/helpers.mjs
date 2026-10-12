import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SCRIPTS = {
  deai: join(ROOT, 'skills', 'renwei-deai', 'scripts', 'deai-check.mjs'),
  style: join(ROOT, 'skills', 'renwei-style', 'scripts', 'style-fingerprint.mjs'),
  init: join(ROOT, 'skills', 'renwei-novel', 'scripts', 'init-novel.mjs'),
  status: join(ROOT, 'skills', 'renwei-novel', 'scripts', 'novel-status.mjs'),
  validate: join(ROOT, 'scripts', 'validate.mjs'),
  sync: join(ROOT, 'scripts', 'sync-shared.mjs'),
  presets: join(ROOT, 'scripts', 'build-presets.mjs'),
};

export const EXAMPLES = {
  ai: join(ROOT, 'examples', '夜班-AI原稿.md'),
  human: join(ROOT, 'examples', '夜班-改稿.md'),
};

export function run(script, args = [], { cwd = ROOT, input } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'renwei-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
