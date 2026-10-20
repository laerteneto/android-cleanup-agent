import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPlan, FingerprintMismatchError } from '../../src/apply.js';
import { isApproved } from '../../src/approvals.js';
import { runAudit } from '../../src/audit.js';
import { loadCatalog } from '../../src/catalog/loader.js';
import type { Answers, Approvals, Plan } from '../../src/core/schemas.js';
import { BusyError, clearAppData, rebootDevice } from '../../src/device-actions.js';
import { UnsupportedDeviceError } from '../../src/device.js';
import { buildPlan } from '../../src/plan.js';
import { DeviceDroppedError } from '../../src/platform/adb.js';
import { executeRestore, pendingRestore } from '../../src/restore.js';
import { RunStore } from '../../src/runs.js';
import { verifyRun } from '../../src/verify.js';
import { FakeAdb, type Faults, type FakeSpec } from '../fake-adb.js';
import { fireTv, googleTv, phone, tabletTv } from '../fixtures/devices.js';

const catalog = loadCatalog();
const overlay = { protect: [], disable: [] };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const THOMSON_ANSWERS: Answers = { uses: ['typing'], power: 'mains', symptoms: ['slow-menus', 'slow-apps'], keep: ['com.google.android.youtube', 'com.netflix.mediaclient'] };

async function setup(spec: FakeSpec, faults: Faults = {}, answers: Answers = THOMSON_ANSWERS) {
  const adb = new FakeAdb(spec, faults);
  const dir = mkdtempSync(join(tmpdir(), 'aca-'));
  dirs.push(dir);
  const store = new RunStore(dir);
  const audit = await runAudit(adb, { serial: spec.serial, transport: 'wifi', catalog });
  const auditPath = store.saveAudit(audit);
  const { sha } = store.loadAudit(audit.run_id);
  const plan = buildPlan({ audit, auditSha: sha, catalog, overlay, answers, now: adb.now() });
  store.savePlan(plan);
  const planSha = store.loadPlan(audit.run_id).sha;
  return { adb, store, audit, plan, planSha, auditPath };
}

function approveAll(plan: Plan, sha: string, extra: Record<string, boolean> = {}): Approvals {
  return {
    contract_version: 1,
    run_id: plan.run_id,
    plan_sha256: sha,
    categories: Object.fromEntries([...new Set(plan.items.map((i) => i.category))].map((c) => [c, true])),
    items: extra,
  };
}

const byPkg = (plan: Plan, pkg: string) => plan.items.find((i) => i.pkg === pkg);
const byKey = (plan: Plan, key: string) => plan.items.find((i) => i.identity.kind === 'setting' && `${i.identity.ns}.${i.identity.key}` === key);

describe('audit and plan on a tablet-based TV', () => {
  it('detects the class, usage, memory and wakers', async () => {
    const { audit } = await setup(tabletTv());
    expect(audit.device.deviceClass).toBe('tablet-tv');
    expect(audit.device.classReason).toMatch(/KTC/);
    expect(audit.device.roles.home).toBe('com.android.launcher3');
    expect(audit.device.roles.ime).toBe('com.google.android.inputmethod.latin');
    const yt = audit.packages.find((p) => p.pkg === 'com.google.android.youtube');
    expect(yt?.usage?.totalMs).toBe(1_129_615_000);
    expect(audit.wakers[0]?.pkg).toBe('com.google.android.gms');
    expect(audit.wakers.some((w) => w.pkg === 'com.google.android.calendar' && w.wakeups === 64)).toBe(true);
    expect(audit.settings['system.screen_off_timeout']).toBe('60000');
    expect(audit.snapshot.memory?.usedKb).toBe(2_736_455);
  });

  it('offers what we removed by hand, and never the apps in use or the system', async () => {
    const { plan } = await setup(tabletTv());
    for (const pkg of ['com.amazon.avod.thirdpartyclient', 'com.google.android.calendar', 'com.google.android.gm', 'com.google.android.apps.youtube.music', 'com.android.camera2', 'com.kgzn.castscreen', 'com.google.android.tts', 'com.google.android.apps.wellbeing']) {
      expect(byPkg(plan, pkg), pkg).toBeDefined();
    }
    const gapp = byPkg(plan, 'com.google.android.googlequicksearchbox');
    expect(gapp?.homeCheck).toBe(true);
    expect(gapp?.requiresExplicit).toBe(true);
    for (const pkg of ['com.google.android.youtube', 'com.netflix.mediaclient', 'com.android.chrome', 'com.android.launcher3', 'com.google.android.inputmethod.latin', 'com.kgzn.dropdownmenu', 'com.kgzn.ota', 'com.google.android.gms', 'com.google.android.verifier']) {
      expect(byPkg(plan, pkg), pkg).toBeUndefined();
    }
    expect(plan.excluded.find((e) => e.target === 'com.google.android.youtube' || e.target === 'com.netflix.mediaclient')).toBeUndefined();
    expect(byKey(plan, 'global.window_animation_scale')?.action).toMatchObject({ value: '0.5' });
    expect(byKey(plan, 'global.animator_duration_scale')).toBeUndefined(); // already 0.5
    expect(byKey(plan, 'global.bluetooth_on')?.action).toMatchObject({ via: 'cmd-bluetooth' });
    expect(byKey(plan, 'secure.location_mode')?.action).toMatchObject({ via: 'cmd-location' });
  });

  it('offers unused apps the user installed, unticked and one by one', async () => {
    const { plan, planSha } = await setup(tabletTv());
    const game = byPkg(plan, 'com.example.oldgame');
    expect(game).toMatchObject({ category: 'user-apps', requiresExplicit: true, recommended: false, restore: 'store-reinstall' });
    expect(byPkg(plan, 'com.vodafone.demo.tv')).toMatchObject({ category: 'user-apps' }); // idle > 90 days
    expect(isApproved(game!, approveAll(plan, planSha))).toBe(false);
    expect(isApproved(game!, approveAll(plan, planSha, { [game!.id]: true }))).toBe(true);
  });

  it('respects what the user said they use', async () => {
    const { plan } = await setup(tabletTv(), {}, { uses: ['bluetooth', 'cast', 'location', 'voice'], power: 'mains', symptoms: [], keep: [] });
    expect(byKey(plan, 'global.bluetooth_on')).toBeUndefined();
    expect(byKey(plan, 'secure.location_mode')).toBeUndefined();
    expect(byKey(plan, 'global.wifi_scan_always_enabled')).toBeUndefined();
    expect(byPkg(plan, 'com.kgzn.castscreen')).toBeUndefined();
    expect(byPkg(plan, 'com.google.android.googlequicksearchbox')).toBeUndefined();
    expect(byKey(plan, 'global.window_animation_scale')).toBeUndefined(); // no slowness reported
    expect(plan.excluded.some((e) => e.target === 'com.kgzn.castscreen' && /cast/.test(e.reason))).toBe(true);
  });

  it('keeps the plan deterministic', async () => {
    const a = await setup(tabletTv());
    const again = buildPlan({ audit: a.audit, auditSha: a.planSha, catalog, overlay, answers: THOMSON_ANSWERS, now: a.adb.now() });
    expect(again.items.map((i) => i.id)).toEqual(a.plan.items.map((i) => i.id));
  });
});

describe('apply → results → restore round trip', () => {
  it('applies every approved change, keeps data, and restore returns the device exactly to where it started', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec);
    const startSettings = structuredClone(adb.settings);
    const gapp = byPkg(plan, 'com.google.android.googlequicksearchbox')!;
    const approvals = approveAll(plan, planSha, { [gapp.id]: true });
    const results = await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals, catalog, overlay });

    expect(adb.isLive('com.amazon.avod.thirdpartyclient')).toBe(false);
    expect(adb.pkg('com.amazon.avod.thirdpartyclient')?.known).toBe(true);
    expect(adb.log.some((c) => c.join(' ') === 'pm uninstall -k --user 0 com.amazon.avod.thirdpartyclient')).toBe(true);
    expect(adb.pkg('com.google.android.googlequicksearchbox')?.enabled).toBe(false);
    expect(adb.settings.global.window_animation_scale).toBe('0.5');
    expect(adb.settings.global.bluetooth_on).toBe('0');
    expect(adb.settings.secure.location_mode).toBe('0');
    expect(adb.settings.system.screen_off_timeout).toBe('60000'); // transient bump reverted
    expect(adb.isLive('com.google.android.youtube')).toBe(true);
    expect(adb.isLive('com.example.oldgame')).toBe(true); // user app not explicitly approved
    expect(results.failed).toBe(0);
    expect(results.removed).toBeGreaterThan(5);
    expect(results.after.memory!.usedKb).toBeLessThan(results.before.memory!.usedKb);
    expect(results.cacheFreedKb).toBeGreaterThan(0);
    expect(results.restoreScript).toBeTruthy();
    const script = readFileSync(results.restoreScript!, 'utf8');
    expect(script).toContain('cmd package install-existing --user 0 com.amazon.avod.thirdpartyclient');
    expect(script).toContain(`FINGERPRINT='${audit.device.fingerprint}'`);
    expect(script).not.toContain('192.0.2');

    const manifest = store.readManifest(plan.run_id);
    expect(manifest.some((e) => e.op === 'health' && e.status === 'ok' && e.target === 'com.google.android.googlequicksearchbox')).toBe(true);
    expect((await verifyRun(adb, spec.serial, audit, manifest)).every((r) => r.status === 'held')).toBe(true);

    await executeRestore(adb, store, spec.serial, audit, pendingRestore(store.readManifest(plan.run_id)));
    for (const p of spec.packages) expect(adb.isLive(p.pkg), p.pkg).toBe(true);
    expect(adb.settings.global).toEqual(startSettings.global);
    expect(adb.settings.system).toEqual(startSettings.system);
    expect(adb.settings.secure.location_mode).toBe('3');
    expect(pendingRestore(store.readManifest(plan.run_id))).toEqual([]);
  });

  it('restores an unset setting by deleting it again', async () => {
    const spec = tabletTv();
    delete spec.settings.global.window_animation_scale;
    const { adb, store, audit, plan, planSha } = await setup(spec);
    const item = byKey(plan, 'global.window_animation_scale')!;
    expect(item.identity).toMatchObject({ value: 'null' });
    await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: { ...approveAll(plan, planSha), categories: {}, items: { [item.id]: true } }, catalog, overlay });
    expect(adb.settings.global.window_animation_scale).toBe('0.5');
    await executeRestore(adb, store, spec.serial, audit, pendingRestore(store.readManifest(plan.run_id)));
    expect('window_animation_scale' in adb.settings.global).toBe(false);
  });

  it('rolls back a change that breaks the home screen', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec, { homeBreaksWithout: 'com.google.android.googlequicksearchbox' });
    const gapp = byPkg(plan, 'com.google.android.googlequicksearchbox')!;
    const results = await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: approveAll(plan, planSha, { [gapp.id]: true }), catalog, overlay });
    expect(adb.isLive('com.google.android.googlequicksearchbox')).toBe(true);
    const m = store.readManifest(plan.run_id);
    expect(m.find((e) => e.op === 'health' && e.itemId === gapp.id)?.status).toBe('failed');
    expect(m.find((e) => e.op === 'rollback' && e.itemId === gapp.id)?.status).toBe('ok');
    expect(results.rolledBack).toBe(1);
    expect(pendingRestore(m).some((s) => s.target === 'com.google.android.googlequicksearchbox')).toBe(false);
  });

  it('rolls back when a main app crashes after the change', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec, { crashAfterChange: ['com.google.android.youtube'] });
    const gapp = byPkg(plan, 'com.google.android.googlequicksearchbox')!;
    await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: { ...approveAll(plan, planSha), categories: {}, items: { [gapp.id]: true } }, catalog, overlay });
    expect(adb.isLive('com.google.android.googlequicksearchbox')).toBe(true);
    expect(store.readManifest(plan.run_id).find((e) => e.op === 'health')?.reason).toMatch(/youtube/);
  });

  it('does not press Home or launch apps while something is playing', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec, { playing: ['com.google.android.youtube'] });
    const gapp = byPkg(plan, 'com.google.android.googlequicksearchbox')!;
    await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: approveAll(plan, planSha, { [gapp.id]: true }), catalog, overlay });
    expect(adb.isLive('com.google.android.googlequicksearchbox')).toBe(true);
    expect(adb.log.some((c) => c[0] === 'input' && c[2] === 'KEYCODE_HOME')).toBe(false);
    expect(adb.log.some((c) => c[0] === 'am' && c[1] === 'start')).toBe(false);
    expect(store.readManifest(plan.run_id).find((e) => e.itemId === gapp.id)?.reason).toMatch(/playing/);
    expect(adb.isLive('com.amazon.avod.thirdpartyclient')).toBe(false); // non-disruptive items still went ahead
  });

  it('dismisses the location-off popup it caused', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec, { popupOnLocationOff: true });
    const loc = byKey(plan, 'secure.location_mode')!;
    await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: { ...approveAll(plan, planSha), categories: {}, items: { [loc.id]: true } }, catalog, overlay });
    expect(adb.foregroundPkg).toBe('com.android.launcher3');
    expect(store.readManifest(plan.run_id).find((e) => e.itemId === loc.id)?.reason).toMatch(/popup/);
  });

  it('skips a package that changed since the audit', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec);
    adb.pkg('com.google.android.calendar')!.versionCode = 99;
    adb.pkg('com.google.android.gm')!.enabled = false;
    await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: approveAll(plan, planSha), catalog, overlay });
    const m = store.readManifest(plan.run_id);
    expect(m.find((e) => e.target === 'com.google.android.calendar')).toMatchObject({ op: 'skip', reason: expect.stringMatching(/updated/) });
    expect(m.find((e) => e.target === 'com.google.android.gm')).toMatchObject({ op: 'skip', reason: expect.stringMatching(/changed/) });
    expect(adb.isLive('com.google.android.calendar')).toBe(true);
  });

  it('records a refused change as failed and carries on', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec, { refuse: ['com.google.android.gm'] });
    const results = await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: approveAll(plan, planSha), catalog, overlay });
    expect(results.failed).toBe(1);
    expect(adb.isLive('com.amazon.avod.thirdpartyclient')).toBe(false);
  });

  it('stops on a dropped connection and resumes from the manifest', async () => {
    const spec = tabletTv();
    const first = await setup(spec);
    const { adb, store, audit, plan, planSha } = first;
    const approvals = approveAll(plan, planSha);
    adb.faults.dropAfter = adb.shellCalls + 40;
    await expect(applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals, catalog, overlay })).rejects.toBeInstanceOf(DeviceDroppedError);
    const partial = store.readManifest(plan.run_id);
    expect(partial.some((e) => e.reason === 'device dropped')).toBe(true);
    // Reconnect and resume.
    delete adb.faults.dropAfter;
    adb.connected = true;
    await expect(applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals, catalog, overlay })).rejects.toThrow(/--resume/);
    const results = await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals, catalog, overlay, resume: true });
    expect(results.failed).toBe(0);
    expect(adb.isLive('com.amazon.avod.thirdpartyclient')).toBe(false);
    expect(adb.settings.system.screen_off_timeout).toBe('60000');
    const applied = store.readManifest(plan.run_id).filter((e) => e.op === 'apply');
    expect(new Set(applied.map((e) => e.itemId)).size).toBe(applied.length); // nothing applied twice
  });

  it('refuses another device, stale approvals and a changed plan', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec);
    const approvals = approveAll(plan, planSha);
    adb.faults.androidIdOverride = 'feedfacefeedface';
    await expect(applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals, catalog, overlay })).rejects.toBeInstanceOf(FingerprintMismatchError);
    delete adb.faults.androidIdOverride;
    await expect(applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: { ...approvals, plan_sha256: 'x' }, catalog, overlay })).rejects.toThrow(/hash mismatch/);
    adb.clock += 25 * 3_600_000;
    await expect(applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals, catalog, overlay })).rejects.toThrow(/h old/);
  });

  it('never acts on a package that became the home screen after the audit', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec);
    adb.spec.home = 'com.google.android.gm/.FakeHome';
    await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: approveAll(plan, planSha), catalog, overlay });
    expect(adb.isLive('com.google.android.gm')).toBe(true);
    expect(store.readManifest(plan.run_id).find((e) => e.target === 'com.google.android.gm')?.reason).toMatch(/home screen/);
  });
});

describe('separate gates', () => {
  it('clear-data is never part of apply and refuses protected apps', async () => {
    const spec = tabletTv();
    const { adb, store, audit, plan, planSha } = await setup(spec);
    expect(plan.items.some((i) => i.action.type === 'clear-data')).toBe(false);
    await applyPlan({ adb, store, serial: spec.serial, audit, plan, planSha, approvals: approveAll(plan, planSha), catalog, overlay });
    expect(adb.log.some((c) => c[0] === 'pm' && c[1] === 'clear')).toBe(false);
    await expect(clearAppData(adb, store, spec.serial, audit, catalog, overlay, 'com.google.android.gms')).rejects.toThrow(/refusing/);
    await expect(clearAppData(adb, store, spec.serial, audit, catalog, overlay, 'com.android.launcher3')).rejects.toThrow(/home screen/);
    const e = await clearAppData(adb, store, spec.serial, audit, catalog, overlay, 'com.android.chrome');
    expect(e.status).toBe('ok');
    expect(adb.pkg('com.android.chrome')?.dataCleared).toBe(true);
  });

  it('reboot refuses while something is playing', async () => {
    const spec = tabletTv();
    const adb = new FakeAdb(spec, { playing: ['com.netflix.mediaclient'] });
    await expect(rebootDevice(adb, spec.serial, {})).rejects.toBeInstanceOf(BusyError);
    expect(adb.rebooted).toBe(false);
    await rebootDevice(adb, spec.serial, { force: true });
    expect(adb.rebooted).toBe(true);
  });
});

describe('other device classes', () => {
  it('phone: protects calls, keyboard, Knox and recently used apps; Samsung entries apply', async () => {
    const { plan, audit } = await setup(phone(), {}, { uses: ['calls', 'sms', 'bluetooth'], power: 'battery', symptoms: ['battery'], keep: [] });
    expect(audit.device.deviceClass).toBe('phone');
    expect(byPkg(plan, 'com.samsung.android.bixby.agent')).toBeDefined();
    expect(byPkg(plan, 'com.facebook.appmanager')).toBeDefined();
    expect(byPkg(plan, 'com.samsung.android.knox.containercore')).toBeUndefined();
    expect(byPkg(plan, 'com.android.phone')).toBeUndefined();
    expect(byPkg(plan, 'com.samsung.android.honeyboard')).toBeUndefined();
    expect(byPkg(plan, 'com.google.android.gm')).toBeUndefined(); // used yesterday
    expect(byPkg(plan, 'com.google.android.deskclock')).toBeUndefined(); // not offered on phones
    expect(byPkg(plan, 'com.whatsapp')).toBeUndefined();
    expect(byKey(plan, 'global.bluetooth_on')).toBeUndefined();
    expect(plan.items.find((i) => i.pkg === 'com.samsung.android.bixby.agent')?.recommended).toBe(false); // community entry
  });

  it('Google TV: never offers switching Bluetooth off (the remote needs it)', async () => {
    const { plan, audit } = await setup(googleTv(), {}, { uses: [], power: 'mains', symptoms: ['slow-menus'], keep: [] });
    expect(audit.device.deviceClass).toBe('google-tv');
    expect(byKey(plan, 'global.bluetooth_on')).toBeUndefined();
    expect(byPkg(plan, 'com.google.android.katniss')?.homeCheck).toBe(true);
    expect(byPkg(plan, 'com.google.android.apps.tv.launcherx')).toBeUndefined();
  });

  it('refuses Fire TV', async () => {
    const spec = fireTv();
    await expect(runAudit(new FakeAdb(spec), { serial: spec.serial, transport: 'wifi', catalog })).rejects.toBeInstanceOf(UnsupportedDeviceError);
  });

  it('turns removals into reversible disables when the device cannot reinstall system apps', async () => {
    const spec = tabletTv();
    spec.capabilities = { installExisting: false };
    const { plan } = await setup(spec);
    const prime = byPkg(plan, 'com.amazon.avod.thirdpartyclient')!;
    expect(prime.action.type).toBe('disable');
    expect(prime.restore).toBe('enable');
  });

  it('falls back to svc for Bluetooth and drops it when neither works', async () => {
    const spec = tabletTv();
    spec.capabilities = { cmdBluetooth: false };
    expect(byKey((await setup(spec)).plan, 'global.bluetooth_on')?.action).toMatchObject({ via: 'svc-bluetooth' });
    const spec2 = tabletTv();
    spec2.capabilities = { cmdBluetooth: false, svcBluetooth: false };
    const { plan } = await setup(spec2);
    expect(byKey(plan, 'global.bluetooth_on')).toBeUndefined();
    expect(plan.excluded.some((e) => e.target === 'global.bluetooth_on')).toBe(true);
  });
});
