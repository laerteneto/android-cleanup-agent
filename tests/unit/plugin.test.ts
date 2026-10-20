import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CONTRACT_VERSION } from '../../src/core/schemas.js';
// @ts-expect-error plain .mjs hook modules (Node built-ins only)
import { checkCommand } from '../../hooks/scripts/bash-guard.mjs';
// @ts-expect-error plain .mjs hook modules
import { checkWrite } from '../../hooks/scripts/write-guard.mjs';

const ROOT = resolve(process.cwd());

function frontmatter(path: string): Record<string, unknown> {
  const m = readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`no frontmatter in ${path}`);
  return parse(m[1] as string) as Record<string, unknown>;
}

describe('agents', () => {
  const dir = join(ROOT, '.claude/agents');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const ALLOWED = new Set(['name', 'description', 'tools', 'model', 'effort', 'maxTurns']);
  it.each(files)('%s has valid frontmatter and narrow tools', (f) => {
    const fm = frontmatter(join(dir, f));
    expect(fm.name).toBe(f.replace(/\.md$/, ''));
    expect(String(fm.name)).toMatch(/^aca-[a-z-]+-agent$/);
    for (const k of Object.keys(fm)) expect(ALLOWED.has(k)).toBe(true);
    expect(['haiku', 'sonnet', 'opus', 'fable', 'inherit']).toContain(fm.model);
    expect(String(fm.description).length).toBeLessThanOrEqual(1024);
    const tools = String(fm.tools);
    expect(tools).not.toMatch(/(^|,\s*)Bash(\s*,|$)/);
    expect(tools).not.toMatch(/\b(Write|Edit|MultiEdit)\b/);
    for (const m of tools.matchAll(/Bash\(([^)]*)\)/g)) expect(m[1]).toMatch(/^android-cleanup-agent [a-z]+( [a-z]+)?:\*$/);
  });
  it('the judge can only show and veto', () => {
    expect(String(frontmatter(join(dir, 'aca-risk-judge-agent.md')).tools)).toBe('Bash(android-cleanup-agent approvals show:*), Bash(android-cleanup-agent approvals veto:*)');
  });
});

describe('skills', () => {
  const dir = join(ROOT, '.claude/skills');
  const skills = readdirSync(dir);
  it.each(skills)('%s has valid frontmatter, stays short and links resolve', (s) => {
    const path = join(dir, s, 'SKILL.md');
    const fm = frontmatter(path);
    expect(fm.name).toBe(s);
    expect(String(fm.description)).toMatch(/Use when user says:/);
    expect(String(fm['allowed-tools'])).not.toMatch(/(^|,\s*)Bash(\s*,|$)/);
    expect(String(fm['allowed-tools'])).not.toMatch(/Bash\(adb/);
    const text = readFileSync(path, 'utf8');
    expect(text.split('\n').length).toBeLessThanOrEqual(500);
    for (const m of text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([^`\s)]+)/g)) expect(existsSync(join(dir, s, m[1] as string))).toBe(true);
  });
  it('pins the contract version the CLI writes', () => {
    expect(readFileSync(join(dir, 'cleanup/references/output-contract.md'), 'utf8')).toContain(`contract_version: ${CONTRACT_VERSION})`);
    expect(readFileSync(join(dir, 'cleanup/SKILL.md'), 'utf8')).toContain(`is **${CONTRACT_VERSION}**`);
  });
});

describe('manifests', () => {
  it('keeps package, plugin and marketplace versions in sync', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
    const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
    expect(plugin.version).toBe(pkg.version);
    expect(market.plugins[0].version).toBe(pkg.version);
    expect(plugin.name).toBe('android-cleanup-agent');
  });
  it('the bin shim pins the exact version and never runs install scripts', () => {
    const shim = readFileSync(join(ROOT, 'bin/android-cleanup-agent'), 'utf8');
    expect(shim).toContain('android-cleanup-agent@$VER');
    expect(shim).toContain('npm_config_ignore_scripts=true');
    expect(shim).not.toContain('@latest');
  });
});

describe('bash guard', () => {
  const check = (cmd: string, mode?: string) => checkCommand(cmd, { cwd: '/tmp', permissionMode: mode }) as string | null;

  it('denies raw adb changes, however they are spelled', () => {
    for (const cmd of [
      'adb shell pm uninstall --user 0 com.google.android.gm',
      'adb -s 192.0.2.10:5555 shell pm uninstall -k --user 0 com.x.y',
      'adb shell "pm disable-user --user 0 com.x.y"',
      "adb shell 'settings put global window_animation_scale 0'",
      'adb shell settings delete secure location_mode',
      'adb shell cmd package uninstall com.x.y',
      'adb shell cmd package install-existing com.x.y',
      'adb shell cmd location set-location-enabled false',
      'adb shell cmd bluetooth_manager disable',
      'adb shell svc wifi disable',
      'adb shell pm clear com.x.y',
      'adb shell pm trim-caches 999G',
      'adb shell am force-stop com.x.y',
      'adb shell rm -rf /sdcard/DCIM',
      'adb shell "ls; rm -rf /sdcard"',
      'adb shell sh -c "pm uninstall com.x.y"',
      'adb shell reboot',
      'adb shell setprop persist.x 1',
      'adb shell logcat -c',
      'adb reboot',
      'adb -d reboot bootloader',
      'adb uninstall com.x.y',
      'adb install evil.apk',
      'adb root',
      'adb shell',
      'ANDROID_SERIAL=x /opt/sdk/platform-tools/adb shell pm uninstall com.x.y',
      'bash -c "adb shell pm uninstall com.x.y"',
      'echo $(adb shell pm uninstall com.x.y)',
      'fastboot erase userdata',
      'sudo adb kill-server',
      'node -e "require(\'child_process\')"',
    ]) expect(check(cmd), cmd).toMatch(/^deny:/);
  });

  it('asks before the CLI changes the device, and denies human-only gates when bypassed', () => {
    expect(check('android-cleanup-agent apply --run run_x --yes')).toMatch(/^ask:/);
    expect(check('android-cleanup-agent restore --run run_x --yes')).toMatch(/^ask:/);
    expect(check('android-cleanup-agent reboot --yes')).toMatch(/^ask:/);
    expect(check('android-cleanup-agent reboot --yes', 'bypassPermissions')).toMatch(/^deny:/);
    expect(check('android-cleanup-agent clear-data --package com.x.y --confirm-package com.x.y --yes')).toMatch(/^ask:.*com\.x\.y/);
    expect(check('android-cleanup-agent clear-data --package com.x.y --confirm-package com.x.y --yes', 'bypassPermissions')).toMatch(/^deny:/);
    expect(check('android-cleanup-agent clear-data --package a.b --package c.d --yes')).toMatch(/^deny:.*exactly one/);
    expect(check('adb shell input keyevent KEYCODE_HOME')).toMatch(/^ask:/);
  });

  it('leaves read-only and ordinary work alone', () => {
    for (const cmd of [
      'adb devices -l',
      'adb mdns services',
      'adb connect 192.0.2.10:37001',
      'adb pair 192.0.2.10:37002 123456',
      'adb shell getprop ro.product.model',
      'adb shell dumpsys meminfo',
      'adb shell pm list packages -d',
      'adb shell settings get global window_animation_scale',
      'adb shell cmd package resolve-activity --brief -c android.intent.category.HOME',
      'adb exec-out screencap -p > shot.png',
      'adb logcat -d',
      'git status',
      'android-cleanup-agent audit --summary',
      'android-cleanup-agent apply --run run_x',
      'android-cleanup-agent restore --run run_x',
      'android-cleanup-agent reboot',
    ]) expect(check(cmd), cmd).toBeNull();
  });

  it('blocks on hook failure or timeout', () => {
    const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks/hooks.json'), 'utf8'));
    for (const entry of hooks.hooks.PreToolUse) for (const hk of entry.hooks) expect(hk.onFailure).toBe('block');
  });

  it('fails closed on malformed input that looks like a change, and runs as a real hook', () => {
    const script = join(ROOT, 'hooks/scripts/bash-guard.mjs');
    const run = (input: string) => {
      try {
        return { out: execFileSync('node', [script], { input, encoding: 'utf8' }), code: 0 };
      } catch (e) {
        return { out: '', code: (e as { status: number }).status };
      }
    };
    expect(run('{not json, adb shell pm uninstall x').code).toBe(2);
    expect(run('{not json, ls').code).toBe(0);
    expect(JSON.parse(run(JSON.stringify({ tool_input: { command: 'adb shell pm uninstall com.x.y' }, cwd: '/' })).out).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(run(JSON.stringify({ tool_input: { command: 'adb devices' }, cwd: '/' })).out).toBe('');
  });
});

describe('write guard', () => {
  const home = homedir();
  it('denies edits of the tool’s own state, allows the overlay', () => {
    expect(checkWrite(join(home, 'Library/Application Support/android-cleanup-agent/runs/run_x/approvals.yaml'), '/', {})).toMatch(/only changes through its CLI/);
    expect(checkWrite(join(home, '.local/state/android-cleanup-agent/runs/run_x/plan.json'), '/', {})).toMatch(/only changes through its CLI/);
    expect(checkWrite('/tmp/aca-state/x', '/', { ACA_STATE_DIR: '/tmp/aca-state' })).toMatch(/only changes/);
    expect(checkWrite(join(home, '.config/android-cleanup-agent/catalog.yaml'), '/', {})).toBeNull();
    expect(checkWrite(join(home, '.config/android-cleanup-agent/forbidden-strings.txt'), '/', {})).toMatch(/may be edited/);
    expect(checkWrite('/tmp/README.md', '/', {})).toBeNull();
  });
});
