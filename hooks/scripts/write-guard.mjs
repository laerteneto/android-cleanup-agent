#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Write|Edit|MultiEdit|NotebookEdit).
 * Denies edits inside android-cleanup-agent's own state: the run folder (audits,
 * plans, approvals, manifests, restore scripts) and ~/.config/android-cleanup-agent
 * except catalog.yaml. Approvals change only through `approvals set|veto`, which
 * re-validate every id against the plan and keep the plan hash pin intact.
 * Fails closed on internal errors only when the target path looks like ours.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const inside = (child, parent) => child === parent || child.startsWith(parent + '/');
const expand = (p, cwd) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : isAbsolute(p) ? p : resolve(cwd || process.cwd(), p));

export function stateDirs(env = process.env) {
  const home = homedir();
  return [
    env.ACA_STATE_DIR,
    join(home, 'Library/Application Support/android-cleanup-agent'),
    join(env.XDG_STATE_HOME || join(home, '.local/state'), 'android-cleanup-agent'),
  ].filter(Boolean);
}

export function checkWrite(filePath, cwd, env = process.env) {
  const p = expand(filePath, cwd);
  if (stateDirs(env).some((d) => inside(p, d))) {
    return 'android-cleanup-agent run state (audits, plans, approvals, manifests) only changes through its CLI: approvals set / veto.';
  }
  const config = join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'android-cleanup-agent');
  // catalog.yaml is the user's overlay; it can only add protection, never add offers.
  if (inside(p, config) && p.slice(config.length + 1) !== 'catalog.yaml') {
    return 'only catalog.yaml in ~/.config/android-cleanup-agent may be edited.';
  }
  return null;
}

function main() {
  if (process.env.ACA_HOOKS === 'off') return;
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
    const input = JSON.parse(raw);
    const path = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
    if (!path) return;
    const reason = checkWrite(String(path), input.cwd);
    if (reason) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    }
  } catch (e) {
    if (raw.includes('android-cleanup-agent')) {
      process.stderr.write(`android-cleanup-agent write guard failed (${e?.message ?? e}); blocking.\n`);
      process.exit(2);
    }
  }
}

// Run only when executed directly (not when imported by tests). Paths may contain spaces.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
