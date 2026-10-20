/**
 * apply: makes the approved changes, one verified item at a time.
 *
 * Per item:  live state == audited state → not protected by a live role → (risky
 * items) nothing playing → change → read the state back → manifest entry (fsync)
 * → (risky items) health check, rolled back on failure. Any mismatch is skipped
 * and reported. A dropped connection stops the run; `--resume` continues it.
 * Risky items need the screen on and unlocked (the health check presses Home),
 * so a locked device stops the run before anything changes.
 */
import { selectApproved, verifyApprovals } from './approvals.js';
import type { Catalog } from './catalog/loader.js';
import type { UserOverlay } from './catalog/schema.js';
import type { Approvals, Audit, Item, ManifestEntry, Plan, Results, Roles } from './core/schemas.js';
import { deviceFingerprint } from './connect.js';
import { readRoles } from './device.js';
import { dismissKnownPopup, healthCheck, pressHome } from './health.js';
import { deviceEpoch, disablePackage, enablePackage, installExisting, playing, readPackage, screenBlocker, readSetting, settleSetting, trimCaches, uninstallForUser, writeSetting } from './ops.js';
import { type Adb, DeviceDroppedError } from './platform/adb.js';
import { computeResults } from './results.js';
import type { RunStore } from './runs.js';
import { protectedReason } from './safety/never-touch.js';

export const AWAKE_MS = 600_000;
export const UNLOCK_WAIT_MS = 90_000;
export const DROPPED_REASON = 'device dropped';
export const PLAYING_REASON = 'something is playing on the device right now; run apply --resume when it is free';
export const LOCKED_REASON = 'the screen is locked; unlock the device and run apply --resume';
/** Skips that `--resume` tries again. */
const RESUMABLE = new Set([DROPPED_REASON, PLAYING_REASON, LOCKED_REASON]);

export class FingerprintMismatchError extends Error {}
export class DeviceLockedError extends Error {}

export interface ApplyContext {
  adb: Adb;
  store: RunStore;
  serial: string;
  audit: Audit;
  plan: Plan;
  planSha: string;
  approvals: Approvals;
  catalog: Catalog;
  overlay: UserOverlay;
  resume?: boolean;
  onEntry?: (e: ManifestEntry, item: Item | null) => void;
  /** Called once when the run waits for a person to unlock the device. */
  onWaiting?: (message: string) => void;
}

/** Items that already have a final outcome in the manifest. */
export function finishedItems(entries: ManifestEntry[]): Set<string> {
  return new Set(entries.filter((e) => e.itemId && (e.op === 'apply' || (e.op === 'skip' && !RESUMABLE.has(e.reason ?? '')))).map((e) => e.itemId as string));
}

export async function assertSameDevice(adb: Adb, serial: string, fingerprint: string): Promise<void> {
  const fp = await deviceFingerprint(adb, serial);
  if (fp !== fingerprint) throw new FingerprintMismatchError(`the connected device (${serial}) is not the device this run was audited on. Connect that device, or audit this one.`);
}

export async function applyPlan(ctx: ApplyContext): Promise<Results> {
  const { adb, store, serial, audit, plan } = ctx;
  verifyApprovals(plan, ctx.planSha, ctx.approvals, audit.created_at, adb.now());
  await assertSameDevice(adb, serial, plan.fingerprint);
  const existing = store.readManifest(plan.run_id);
  if (existing.some((e) => e.op === 'apply') && !ctx.resume) throw new Error('this run was already applied. Use --resume to continue an interrupted run, or audit again for a new one.');
  const done = finishedItems(existing);
  const selected = selectApproved(plan, ctx.approvals).filter((i) => !done.has(i.id));
  const user = audit.device.currentUser;
  const at = () => adb.now().toISOString();
  const record = (e: Omit<ManifestEntry, 'at'>, item: Item | null) => {
    const full: ManifestEntry = { at: at(), ...e };
    store.appendManifest(plan.run_id, full);
    ctx.onEntry?.(full, item);
  };

  if (selected.some((i) => i.homeCheck)) {
    let blocked = await screenBlocker(adb, serial);
    if (blocked) {
      ctx.onWaiting?.(`${blocked}: unlock the device now (waiting up to ${UNLOCK_WAIT_MS / 1000} s)…`);
      const until = adb.now().getTime() + UNLOCK_WAIT_MS;
      while (blocked && adb.now().getTime() < until) {
        await adb.sleep(1500);
        blocked = await screenBlocker(adb, serial);
      }
    }
    if (blocked) throw new DeviceLockedError(`${blocked}. Some changes are checked by opening the home screen and your main apps, so unlock the device, keep it unlocked, and run apply again. Nothing was changed.`);
  }

  const release = store.acquireLock();
  let awake: string | null = null;
  try {
    // Keep the screen on for the run: a sleeping screen drops wireless debugging.
    const timeout = await readSetting(adb, serial, user, 'system', 'screen_off_timeout');
    const prior = existing.find((e) => e.op === 'transient' && e.target === 'system.screen_off_timeout' && !existing.some((r) => r.op === 'transient-restore' && r.target === e.target && r.at > e.at));
    if (prior) awake = prior.before ?? null;
    else if (timeout !== 'null' && Number(timeout) < AWAKE_MS) {
      await writeSetting(adb, serial, user, 'system', 'screen_off_timeout', String(AWAKE_MS), 'settings');
      awake = timeout;
      record({ op: 'transient', status: 'ok', target: 'system.screen_off_timeout', before: timeout, after: String(AWAKE_MS), reason: 'kept the screen on during the run' }, null);
    }

    let roles = await readRoles(adb, serial, user, audit.device.sdk);
    for (const item of selected) {
      try {
        roles = (await applyItem(ctx, item, roles, record)) ?? roles;
      } catch (e) {
        if (e instanceof DeviceDroppedError) {
          record({ op: 'skip', status: 'skipped', itemId: item.id, target: item.pkg ?? item.title, reason: DROPPED_REASON }, item);
          awake = null; // can't restore it now; resume or restore will
        }
        throw e;
      }
    }
  } finally {
    if (awake !== null) {
      try {
        await writeSetting(adb, serial, user, 'system', 'screen_off_timeout', awake, 'settings');
        record({ op: 'transient-restore', status: 'ok', target: 'system.screen_off_timeout', before: String(AWAKE_MS), after: awake }, null);
      } catch {
        /* recorded transient stays open; `restore` puts it back */
      }
    }
    release();
  }
  return computeResults(adb, store, serial, audit);
}

type Record = (e: Omit<ManifestEntry, 'at'>, item: Item | null) => void;

async function applyItem(ctx: ApplyContext, item: Item, roles: Roles, record: Record): Promise<Roles | null | undefined> {
  const { adb, serial, audit, plan } = ctx;
  const user = audit.device.currentUser;
  const skip = (reason: string) => record({ op: 'skip', status: 'skipped', itemId: item.id, target: item.pkg ?? item.title, action: item.action.type, reason }, item);
  const base = { itemId: item.id, action: item.action.type };

  if (item.action.type === 'trim-caches') {
    const kb = await trimCaches(adb, serial);
    record({ ...base, op: 'apply', status: 'ok', target: 'app caches', restore: 'none', ...(kb !== null ? { kb } : {}) }, item);
    return null;
  }

  if (item.action.type === 'setting' && item.identity.kind === 'setting') {
    const { ns, key, value, via } = item.action;
    const target = `${ns}.${key}`;
    const current = await readSetting(adb, serial, user, ns, key);
    if (current !== item.identity.value) return void skip(`changed since the audit (was ${item.identity.value}, now ${current}); audit again to include it`);
    await writeSetting(adb, serial, user, ns, key, value, via);
    const after = await settleSetting(adb, serial, user, ns, key, value);
    const popup = await dismissKnownPopup(adb, serial);
    const notes = [after === value ? '' : `the device kept ${after}`, popup ? `dismissed a popup it caused (${popup})` : ''].filter(Boolean);
    record({ ...base, op: 'apply', status: after === value ? 'ok' : 'failed', target, before: current, after, restore: 'setting', via, ...(notes.length ? { reason: notes.join('; ') } : {}) }, item);
    return null;
  }

  if (item.identity.kind !== 'package' || !item.pkg) return void skip('not a package change');
  if (item.action.type !== 'uninstall-user' && item.action.type !== 'disable') return void skip(`${item.action.type} is not done by apply`);
  const pkg = item.pkg;
  const live = await readPackage(adb, serial, user, pkg);
  const audited = item.identity.installed ? (item.identity.enabled ? 'enabled' : 'disabled') : 'absent';
  if (live.state !== audited) return void skip(`changed since the audit (${audited} then, ${live.state} now); audit again to include it`);
  if (item.identity.versionCode !== null && live.versionCode !== null && live.versionCode !== item.identity.versionCode) return void skip('was updated since the audit; audit again to include it');
  const why = protectedReason(pkg, { neverTouch: ctx.catalog.neverTouch, roles, deviceClass: audit.device.deviceClass, userProtect: ctx.overlay.protect, keep: plan.answers.keep });
  if (why) return void skip(`protected: ${why}`);
  if (item.homeCheck) {
    const busy = await playing(adb, serial);
    if (busy.length) return void skip(PLAYING_REASON);
    if (await screenBlocker(adb, serial)) return void skip(LOCKED_REASON);
  }

  const sinceSec = await deviceEpoch(adb, serial);
  const outText = item.action.type === 'disable' ? await disablePackage(adb, serial, user, pkg) : await uninstallForUser(adb, serial, user, pkg, item.action.keepData);
  const after = await readPackage(adb, serial, user, pkg);
  const expected = item.action.type === 'disable' ? 'disabled' : 'absent';
  const ok = after.state === expected;
  const restore = item.action.type === 'disable' ? 'enable' : after.restorable ? 'install-existing' : 'store-reinstall';
  record({ ...base, op: 'apply', status: ok ? 'ok' : 'failed', target: pkg, before: live.state, after: after.state, restore, ...(ok ? {} : { reason: outText.slice(0, 200) || 'the device refused the change' }) }, item);
  if (!ok || !item.homeCheck) return null;

  const health = await healthCheck(adb, serial, { user, homePkg: roles.home, keep: plan.answers.keep, sinceSec, watch: [roles.home ?? '', 'com.android.systemui', ...plan.answers.keep].filter(Boolean) });
  if (!health) {
    record({ op: 'health', status: 'ok', itemId: item.id, target: pkg, reason: 'home screen and your main apps still work' }, item);
    return readRoles(adb, serial, user, audit.device.sdk);
  }
  record({ op: 'health', status: 'failed', itemId: item.id, target: pkg, reason: health }, item);
  if (restore === 'enable') await enablePackage(adb, serial, user, pkg);
  else if (restore === 'install-existing') await installExisting(adb, serial, user, pkg);
  const back = await readPackage(adb, serial, user, pkg);
  record({ op: 'rollback', status: back.state === live.state ? 'ok' : 'failed', itemId: item.id, target: pkg, before: after.state, after: back.state, reason: health }, item);
  await pressHome(adb, serial);
  return null;
}
