#!/usr/bin/env node
// Asserts the npm tarball ships what the plugin and CLI need, and nothing private.
import { execFileSync } from 'node:child_process';

const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const files = new Set(JSON.parse(out)[0].files.map((f) => f.path));
const required = [
  'dist/cli/index.js',
  'catalog/never-touch.yaml',
  'catalog/settings.yaml',
  'catalog/devices.yaml',
  'catalog/packages/google.yaml',
  'skills/cleanup/SKILL.md',
  'skills/cleanup/references/safety-rules.md',
  'agents/aca-risk-judge-agent.md',
  'hooks/hooks.json',
  'hooks/scripts/bash-guard.mjs',
  'hooks/scripts/write-guard.mjs',
  'bin/android-cleanup-agent',
  '.claude-plugin/plugin.json',
  'LICENSE',
  'README.md',
];
const missing = required.filter((f) => !files.has(f));
const forbidden = [...files].filter((f) => /(^|\/)(src|tests|site|privacy|output|runs|docs)\//.test(f) || /\.env|forbidden-strings\.txt$|restore\.sh$|audit\.json$/.test(f));
if (missing.length || forbidden.length) {
  if (missing.length) console.error('check-pack: missing from tarball:\n  ' + missing.join('\n  '));
  if (forbidden.length) console.error('check-pack: must not ship:\n  ' + forbidden.join('\n  '));
  process.exit(1);
}
console.log(`check-pack: ok (${files.size} files)`);
