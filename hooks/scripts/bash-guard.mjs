#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Bash). A second safety layer; the CLI's own checks
 * are the first and work without Claude.
 *
 * deny  - raw adb commands that change the device outside the CLI: uninstall,
 *         install, root, remount, reboot, sideload, an interactive shell, and
 *         `adb shell` with pm/cmd package mutators, settings put/delete,
 *         svc, setprop, rm, am force-stop/kill/clear, wm, logcat -c, …
 * deny  - fastboot, sudo, and inline interpreters (python -c, node -e, ...)
 * ask   - android-cleanup-agent apply --yes / restore --yes / reboot --yes /
 *         clear-data: a human answers Claude Code's permission dialog
 * deny  - the human-only gates (clear-data, reboot) when permissions are bypassed,
 *         and clear-data for more than one package at a time
 *
 * Compound commands are split on && || ; | & and newlines; env/command/exec/
 * time/nohup wrappers are skipped; bash/sh/zsh -c bodies, eval, $(...),
 * backticks and the body of `adb shell "..."` are inspected as nested commands.
 * A deny anywhere wins.
 *
 * Fails closed: if this script errors on a command that contains a changing
 * token, it blocks (exit 2). Otherwise an internal error lets the command through
 * to the normal permission flow, so unrelated work is never broken.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WRAPPERS = new Set(['env', 'command', 'exec', 'time', 'nohup', 'caffeinate', 'timeout']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'fish']);
const INTERPRETERS = { python: ['-c'], python3: ['-c'], node: ['-e', '--eval', '-p', '--print'], perl: ['-e', '-E'], ruby: ['-e'], php: ['-r'] };
const CHANGING_TOKEN = /\b(uninstall|install|disable|enable|clear|settings|reboot|trim-caches|svc|setprop|rm|clear-data|apply|restore|fastboot|force-stop)\b/;
const MAX_DEPTH = 4;

const ADB_GLOBAL_WITH_ARG = new Set(['-s', '-t', '-H', '-P', '-L']);
const ADB_GLOBAL_FLAGS = new Set(['-a', '-d', '-e']);
const ADB_DENY = new Set(['uninstall', 'install', 'install-multiple', 'install-multi-package', 'root', 'unroot', 'remount', 'disable-verity', 'enable-verity', 'sideload', 'reboot', 'reboot-bootloader', 'emu', 'restore', 'backup', 'sync', 'tcpip', 'usb']);
const PM_MUTATORS = /^(uninstall|disable|disable-user|disable-until-used|enable|default-state|clear|hide|unhide|suspend|unsuspend|install|install-create|install-existing|install-write|install-commit|trim-caches|set-[a-z-]+|grant|revoke|reset-permissions|uninstall-system-updates|move-package|create-user|remove-user)$/;

function decide(permissionDecision, reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason } }));
}

/** Splits a command line into word lists. Honours quotes and backslash escapes. */
export function segments(command) {
  const out = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[++i];
      inWord = true;
    } else if (c === ';' || c === '|' || c === '&' || c === '\n') {
      endSegment();
    } else if (c === ' ' || c === '\t' || c === '(' || c === ')' || c === '{' || c === '}') {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endSegment();
  return out;
}

function substitutions(command) {
  const found = [];
  for (const m of command.matchAll(/\$\(([^()]*)\)/g)) found.push(m[1]);
  for (const m of command.matchAll(/`([^`]*)`/g)) found.push(m[1]);
  return found;
}

const base = (w) => w.split('/').pop();

/** One command that runs ON the device (inside `adb shell`). */
function checkDeviceWords(words) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  const program = base(words[i] ?? '');
  const rest = words.slice(i + 1);
  const sub = rest.find((w) => !w.startsWith('-'));
  const DENY = 'deny:changes to the device go through the android-cleanup-agent CLI (audit → plan → approvals → apply), which checks, logs and can undo them.';
  if (!program) return null;
  if (program === 'pm' && sub && PM_MUTATORS.test(sub)) return DENY;
  if (program === 'cmd') {
    const [svc, op = ''] = rest.filter((w) => !w.startsWith('-'));
    if (svc === 'package' && PM_MUTATORS.test(op)) return DENY;
    if (svc === 'location' && op.startsWith('set-')) return DENY;
    if (svc === 'bluetooth_manager' && /^(enable|disable)$/.test(op)) return DENY;
    if (svc === 'wifi' && /^(set-|enable|disable|connect|forget)/.test(op)) return DENY;
    if (svc === 'role' && /^(add|remove|set|clear)/.test(op)) return DENY;
    if (svc === 'appops' && /^(set|reset)$/.test(op)) return DENY;
    if (svc === 'overlay' && /^(enable|disable)/.test(op)) return DENY;
    return null;
  }
  if (program === 'settings' && /^(put|delete|reset)$/.test(sub ?? '')) return DENY;
  if (['svc', 'reboot', 'setprop', 'rm', 'rmdir', 'mv', 'dd', 'chmod', 'chown', 'wipe', 'recovery', 'su', 'mkfs', 'sm', 'locksettings', 'dpm'].includes(program)) return DENY;
  if (program === 'am' && /^(force-stop|kill|kill-all|clear-[a-z-]+|crash|switch-user|stop-user)$/.test(sub ?? '')) return DENY;
  if (program === 'wm' && sub && sub !== 'size' && sub !== 'density') return null;
  if (program === 'wm' && rest.length > 1) return DENY;
  if (program === 'logcat' && rest.includes('-c')) return DENY;
  if (program === 'input') return 'ask:This sends a key press or tap to the device screen.';
  if (SHELLS.has(program)) {
    // adb flattens quoting, so everything after -c is what the device shell may run.
    const k = rest.indexOf('-c');
    const body = k >= 0 ? rest.slice(k + 1).join(' ') : null;
    if (body) return checkDeviceLine(body, 1);
  }
  return null;
}

function checkDeviceLine(line, depth) {
  let ask = null;
  for (const words of segments(line)) {
    const r = depth < MAX_DEPTH ? checkDeviceWords(words) : 'deny:device command nested too deeply';
    if (r?.startsWith('deny:')) return r;
    if (r?.startsWith('ask:') && !ask) ask = r;
  }
  return ask;
}

function checkAdb(rest) {
  let i = 0;
  while (i < rest.length) {
    if (ADB_GLOBAL_WITH_ARG.has(rest[i])) i += 2;
    else if (ADB_GLOBAL_FLAGS.has(rest[i])) i += 1;
    else break;
  }
  const sub = rest[i];
  const args = rest.slice(i + 1);
  if (!sub) return null;
  if (ADB_DENY.has(sub)) return `deny:\`adb ${sub}\` changes the device outside android-cleanup-agent; use its audit/plan/apply/reboot commands instead.`;
  if (sub === 'push' && args.some((a) => /^\/(system|vendor|data|product)/.test(a))) return 'deny:pushing into system partitions is blocked.';
  if (sub === 'shell' || sub === 'exec-out') {
    // Only `adb shell` options before the command (-t, -T, -x, -n, -e <c>); flags after it belong to the device command.
    let j = 0;
    while (j < args.length && /^-[a-zA-Z]$/.test(args[j])) j += args[j] === '-e' ? 2 : 1;
    const cmd = args.slice(j);
    if (cmd.length === 0) return 'deny:an interactive device shell is blocked while the plugin is enabled; run specific read-only commands instead.';
    // `adb shell "pm uninstall x"` arrives as one word; `adb shell pm uninstall x` as several. Both are re-parsed by the device shell.
    return checkDeviceLine(cmd.join(' '), 1);
  }
  return null;
}

/** Returns 'deny:<reason>', 'ask:<reason>' or null for one segment. */
function checkWords(words, ctx, depth) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  while (i < words.length && WRAPPERS.has(base(words[i]))) {
    i++;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || words[i].startsWith('-') || /^\d+[smh]?$/.test(words[i]))) i++;
  }
  if (i >= words.length) return null;
  const program = base(words[i]);
  const rest = words.slice(i + 1);

  if (program === 'sudo' || program === 'doas') return 'deny:android-cleanup-agent never needs root; sudo is blocked while the plugin is enabled.';
  if (program === 'fastboot') return 'deny:fastboot can wipe or brick a device; it is blocked while the plugin is enabled.';
  if (INTERPRETERS[program] && rest.some((w) => INTERPRETERS[program].includes(w))) return `deny:inline ${program} code is blocked while the plugin is enabled; use the android-cleanup-agent CLI.`;
  if (SHELLS.has(program) || program === 'eval') {
    const k = rest.indexOf('-c');
    const body = program === 'eval' ? rest.join(' ') : k >= 0 ? rest[k + 1] : null;
    if (body && depth < MAX_DEPTH) return checkCommand(body, ctx, depth + 1);
    return null;
  }
  if (program === 'xargs') return checkWords(rest.filter((w) => !w.startsWith('-')), ctx, depth + 1);
  if (program === 'adb' || program === 'adb.exe') return checkAdb(rest);

  if (program === 'android-cleanup-agent') {
    const sub = rest[0];
    const bypass = ctx.permissionMode === 'bypassPermissions';
    if (sub === 'clear-data') {
      if (bypass) return 'deny:clearing an app\'s data cannot be undone; it needs a human decision and is blocked while permissions are bypassed.';
      const pkgs = rest.filter((w, j) => rest[j - 1] === '--package' || w.startsWith('--package='));
      if (pkgs.length !== 1) return 'deny:clear-data takes exactly one --package.';
      const pkg = pkgs[0].replace(/^--package=/, '');
      return `ask:Permanently clear the data, logins and settings of ${pkg} on the device? This cannot be undone.`;
    }
    if (sub === 'reboot' && rest.includes('--yes')) {
      if (bypass) return 'deny:restarting the device interrupts whoever is using it; it needs a human decision and is blocked while permissions are bypassed.';
      return 'ask:Restart the device now? Whatever is on screen stops, and wireless debugging switches off.';
    }
    if (sub === 'apply' && rest.includes('--yes')) return 'ask:Make the approved changes on the device?';
    if (sub === 'restore' && rest.includes('--yes')) return 'ask:Undo this run\'s changes on the device?';
    return null;
  }
  return null;
}

export function checkCommand(command, ctx, depth = 0) {
  let ask = null;
  for (const words of segments(command)) {
    const r = checkWords(words, ctx, depth);
    if (r?.startsWith('deny:')) return r;
    if (r?.startsWith('ask:') && !ask) ask = r;
  }
  for (const sub of substitutions(command)) {
    if (depth >= MAX_DEPTH) break;
    const r = checkCommand(sub, ctx, depth + 1);
    if (r?.startsWith('deny:')) return r;
    if (r?.startsWith('ask:') && !ask) ask = r;
  }
  return ask;
}

function main() {
  if (process.env.ACA_HOOKS === 'off') return;
  let command = '';
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
    const input = JSON.parse(raw);
    command = String(input?.tool_input?.command ?? '');
    if (!command) return;
    const r = checkCommand(command, { cwd: input.cwd, permissionMode: input.permission_mode });
    if (r) decide(r.startsWith('deny:') ? 'deny' : 'ask', r.slice(r.indexOf(':') + 1));
  } catch (e) {
    // Judge the raw input too: a parse failure means `command` was never extracted.
    if (/\badb\b|android-cleanup-agent|fastboot/.test(command + raw) && (CHANGING_TOKEN.test(command) || CHANGING_TOKEN.test(raw))) {
      process.stderr.write(`android-cleanup-agent guard failed (${e?.message ?? e}); blocking a command that may change a device.\n`);
      process.exit(2);
    }
  }
}

// Run only when executed directly (not when imported by tests). Paths may contain spaces.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
