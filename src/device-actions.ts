/**
 * The two changes that are never part of `apply`: clearing one app's data (cannot
 * be undone) and restarting the device (interrupts whatever is on screen and turns
 * wireless debugging off).
 */
import type { Audit, ManifestEntry } from './core/schemas.js';
import type { Catalog } from './catalog/loader.js';
import type { UserOverlay } from './catalog/schema.js';
import { readRoles } from './device.js';
import { clearData, playing, readPackage } from './ops.js';
import type { Adb } from './platform/adb.js';
import { assertPkg } from './platform/argv.js';
import type { RunStore } from './runs.js';
import { protectedReason } from './safety/never-touch.js';

export async function clearAppData(adb: Adb, store: RunStore, serial: string, audit: Audit, catalog: Catalog, overlay: UserOverlay, pkg: string): Promise<ManifestEntry> {
  assertPkg(pkg);
  const audited = audit.packages.find((p) => p.pkg === pkg);
  if (!audited || !audited.installed) throw new Error(`${pkg} was not installed when this run was audited`);
  const roles = await readRoles(adb, serial, audit.device.currentUser, audit.device.sdk);
  const why = protectedReason(pkg, { neverTouch: catalog.neverTouch, roles, deviceClass: audit.device.deviceClass, userProtect: overlay.protect, keep: [] });
  if (why) throw new Error(`refusing to clear ${pkg}: ${why}`);
  const live = await readPackage(adb, serial, audit.device.currentUser, pkg);
  if (live.state === 'absent') throw new Error(`${pkg} is not installed now`);
  const release = store.acquireLock();
  try {
    const out = await clearData(adb, serial, audit.device.currentUser, pkg);
    const entry: ManifestEntry = { at: adb.now().toISOString(), op: 'clear-data', status: /Success/i.test(out) ? 'ok' : 'failed', target: pkg, action: 'clear-data', restore: 'none', ...(/Success/i.test(out) ? {} : { reason: out.slice(0, 200) || 'the device refused' }) };
    store.appendManifest(audit.run_id, entry);
    return entry;
  } finally {
    release();
  }
}

export class BusyError extends Error {}

export async function rebootDevice(adb: Adb, serial: string, opts: { force?: boolean; store?: RunStore; runId?: string }): Promise<void> {
  const busy = await playing(adb, serial);
  if (busy.length && !opts.force) throw new BusyError(`something is playing on the device (${busy.join(', ')}); restart later, or pass --force-while-playing`);
  if (opts.store && opts.runId) opts.store.appendManifest(opts.runId, { at: adb.now().toISOString(), op: 'reboot', status: 'ok', target: 'device' });
  await adb.host(['-s', serial, 'reboot'], { timeoutMs: 30_000 });
}
