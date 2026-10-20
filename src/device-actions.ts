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
import { type Adb, DeviceDroppedError, sh } from './platform/adb.js';
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

/**
 * Android saves app on/off changes to disk about 10 s after they are made. A raw
 * `adb reboot` skips the normal shutdown, so changes from the last few seconds
 * were lost (seen on a Galaxy S22: all 7 changes of a run came back). So: wait
 * until the run's last change is this old, then restart through the power
 * manager, whose shutdown saves pending package state.
 */
export const SETTLE_MS = 15_000;

export async function rebootDevice(adb: Adb, serial: string, opts: { force?: boolean; store?: RunStore; runId?: string; onWaiting?: (message: string) => void }): Promise<void> {
  const busy = await playing(adb, serial);
  if (busy.length && !opts.force) throw new BusyError(`something is playing on the device (${busy.join(', ')}); restart later, or pass --force-while-playing`);
  if (opts.store && opts.runId) {
    const lastChange = Math.max(0, ...opts.store.readManifest(opts.runId).filter((e) => e.op !== 'skip' && e.op !== 'health' && e.op !== 'reboot').map((e) => Date.parse(e.at)));
    const wait = lastChange + SETTLE_MS - adb.now().getTime();
    if (wait > 0) {
      opts.onWaiting?.(`waiting ${Math.ceil(wait / 1000)} s so the device saves the changes before restarting…`);
      await adb.sleep(wait);
    }
    opts.store.appendManifest(opts.runId, { at: adb.now().toISOString(), op: 'reboot', status: 'ok', target: 'device' });
  }
  let viaPowerManager = true;
  try {
    const r = await sh(adb, serial, ['svc', 'power', 'reboot', 'userrequested'], { timeoutMs: 30_000 });
    if (r.code !== 0 || /usage:|unknown|not found/i.test(r.stdout + r.stderr)) viaPowerManager = false;
  } catch (e) {
    if (!(e instanceof DeviceDroppedError)) throw e; // the connection going away is the restart
  }
  if (!viaPowerManager) await adb.host(['-s', serial, 'reboot'], { timeoutMs: 30_000 });
}
