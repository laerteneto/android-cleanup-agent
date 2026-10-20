/**
 * restore: undoes what the manifest says was changed, newest first. Built from
 * the manifest (what really happened), never from the plan (what was intended).
 */
import type { Audit, ManifestEntry, SettingNs, SettingVia } from './core/schemas.js';
import { enablePackage, installExisting, readPackage, readSetting, settleSetting, writeSetting } from './ops.js';
import type { Adb } from './platform/adb.js';
import { PKG, SETTING_KEY, SETTING_VALUE } from './platform/argv.js';
import type { RunStore } from './runs.js';

export interface RestoreStep {
  itemId: string | null;
  target: string;
  kind: 'install-existing' | 'enable' | 'setting';
  /** For settings: the original value ("null" = it was unset). */
  value?: string;
  via?: SettingVia;
}

const reverted = (entries: ManifestEntry[], e: ManifestEntry, i: number) =>
  entries.slice(i + 1).some((l) => (e.itemId ? l.itemId === e.itemId : l.target === e.target) && ['rollback', 'restore', 'transient-restore'].includes(l.op) && l.status === 'ok');

export function pendingRestore(entries: ManifestEntry[], only?: Set<string>): RestoreStep[] {
  const steps: RestoreStep[] = [];
  entries.forEach((e, i) => {
    if (e.status !== 'ok' || !e.target || reverted(entries, e, i)) return;
    if (only && (!e.itemId || !only.has(e.itemId))) return;
    if (e.op === 'transient' && !only) steps.push({ itemId: null, target: e.target, kind: 'setting', value: e.before ?? 'null', via: 'settings' });
    if (e.op !== 'apply') return;
    if (e.restore === 'install-existing') steps.push({ itemId: e.itemId ?? null, target: e.target, kind: 'install-existing' });
    else if (e.restore === 'enable') steps.push({ itemId: e.itemId ?? null, target: e.target, kind: 'enable' });
    else if (e.restore === 'setting') steps.push({ itemId: e.itemId ?? null, target: e.target, kind: 'setting', value: e.before ?? 'null', via: e.via ?? 'settings' });
  });
  return steps.reverse();
}

function splitTarget(target: string): { ns: SettingNs; key: string } {
  const i = target.indexOf('.');
  const ns = target.slice(0, i) as SettingNs;
  if (!['global', 'secure', 'system'].includes(ns)) throw new Error(`invalid setting target ${target}`);
  return { ns, key: target.slice(i + 1) };
}

/** What a radio setting reads back as after it is switched on again (location_mode comes back as the device's own "on" mode). */
function restoredMatches(step: RestoreStep, value: string): boolean {
  if (step.via === 'cmd-location') return step.value === '0' ? value === '0' : value !== '0';
  return value === step.value;
}

export async function executeRestore(adb: Adb, store: RunStore, serial: string, audit: Audit, steps: RestoreStep[], onEntry?: (e: ManifestEntry) => void): Promise<ManifestEntry[]> {
  const user = audit.device.currentUser;
  const done: ManifestEntry[] = [];
  const release = store.acquireLock();
  try {
    for (const s of steps) {
      let status: ManifestEntry['status'] = 'ok';
      let after = '';
      let reason: string | undefined;
      if (s.kind === 'setting') {
        const { ns, key } = splitTarget(s.target);
        const value = s.value ?? 'null';
        await writeSetting(adb, serial, user, ns, key, value, s.via ?? 'settings');
        after = s.via === 'cmd-location' || value === 'null' ? await readSetting(adb, serial, user, ns, key) : await settleSetting(adb, serial, user, ns, key, value);
        if (value !== 'null' && !restoredMatches(s, after)) {
          status = 'failed';
          reason = `the device kept ${after}`;
        }
      } else {
        const out = s.kind === 'enable' ? await enablePackage(adb, serial, user, s.target) : await installExisting(adb, serial, user, s.target);
        const live = await readPackage(adb, serial, user, s.target);
        after = live.state;
        if (live.state !== 'enabled') {
          status = 'failed';
          reason = out.slice(0, 200) || `still ${live.state}`;
        }
      }
      const entry: ManifestEntry = {
        at: adb.now().toISOString(),
        op: s.itemId === null && s.kind === 'setting' ? 'transient-restore' : 'restore',
        status,
        ...(s.itemId ? { itemId: s.itemId } : {}),
        target: s.target,
        after,
        ...(reason ? { reason } : {}),
      };
      store.appendManifest(audit.run_id, entry);
      onEntry?.(entry);
      done.push(entry);
    }
  } finally {
    release();
  }
  return done;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A standalone script for when this CLI is not around. It finds the device by the
 * same fingerprint (android_id + manufacturer + model), so a changed Wi-Fi port
 * does not matter, and refuses to touch any other device.
 */
export function renderRestoreScript(audit: Audit, steps: RestoreStep[]): string {
  const user = String(audit.device.currentUser);
  const lines: string[] = [];
  for (const s of steps) {
    if (s.kind === 'setting') {
      const { ns, key } = splitTarget(s.target);
      if (!SETTING_KEY.test(key) || !SETTING_VALUE.test(s.value ?? '')) continue;
      const nsUser = ns === 'global' ? '' : ` --user ${user}`;
      if (s.via === 'cmd-location') lines.push(`run cmd location set-location-enabled --user ${user} ${s.value === '0' ? 'false' : 'true'}`);
      else if (s.via === 'cmd-bluetooth') lines.push(`run cmd bluetooth_manager ${s.value === '0' ? 'disable' : 'enable'}`);
      else if (s.via === 'svc-bluetooth') lines.push(`run svc bluetooth ${s.value === '0' ? 'disable' : 'enable'}`);
      else if (s.value === 'null') lines.push(`run settings delete${nsUser} ${ns} ${key}`);
      else lines.push(`run settings put${nsUser} ${ns} ${key} ${q(s.value ?? '')}`);
    } else {
      if (!PKG.test(s.target)) continue;
      lines.push(s.kind === 'enable' ? `run pm enable --user ${user} ${s.target}` : `run cmd package install-existing --user ${user} ${s.target}`);
    }
  }
  return `#!/usr/bin/env bash
# Generated by android-cleanup-agent for run ${audit.run_id}.
# Undoes the changes made to this device (${audit.device.manufacturer} ${audit.device.model}), newest first.
# Prefer \`android-cleanup-agent restore --run ${audit.run_id}\`; this script is for when the CLI is not around.
# Usage: ./restore.sh            (connect the device over USB or wireless debugging first)
set -euo pipefail
FINGERPRINT=${q(audit.device.fingerprint)}
command -v adb >/dev/null || { echo "adb not found (install Android platform-tools)"; exit 1; }
hash256() { if command -v sha256sum >/dev/null; then sha256sum | cut -c1-16; else shasum -a 256 | cut -c1-16; fi; }
SERIAL=""
for s in $(adb devices | awk 'NR>1 && $2=="device" {print $1}'); do
  id=$(adb -s "$s" shell settings get secure android_id | tr -d '\\r')
  man=$(adb -s "$s" shell getprop ro.product.manufacturer | tr -d '\\r')
  model=$(adb -s "$s" shell getprop ro.product.model | tr -d '\\r')
  if [ "$(printf '%s\\0%s\\0%s' "$id" "$man" "$model" | hash256)" = "$FINGERPRINT" ]; then SERIAL="$s"; break; fi
done
[ -n "$SERIAL" ] || { echo "The device this run belongs to is not connected (or was factory reset)."; exit 1; }
run() { echo "+ $*"; adb -s "$SERIAL" shell "$@" || echo "  (failed, continuing)"; }
${lines.join('\n')}
echo "Done."
`;
}
