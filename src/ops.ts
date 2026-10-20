/**
 * Every device change goes through these functions, and each one reads the state
 * back instead of trusting adb's exit code. Package names, keys and values are
 * validated again here, whatever the caller already checked.
 */
import type { SettingNs, SettingVia } from './core/schemas.js';
import { type Adb, out, sh } from './platform/adb.js';
import { assertPkg, assertSettingKey, assertSettingValue, userArg } from './platform/argv.js';
import { isEnabledState, parseDumpsysPackages } from './parsers/packages.js';
import { parseDf } from './parsers/props.js';
import { parseForeground, parseForegroundComponent, parseKeyguardShowing, parsePlaying, parseWakefulness } from './parsers/system.js';

export type PackageState = 'enabled' | 'disabled' | 'absent' | 'unknown';

export interface LivePackage {
  state: PackageState;
  versionCode: number | null;
  lastUpdateTime: string | null;
  /** `install-existing` can bring it back: the package manager still has its code (a system app, or one installed for another user). */
  restorable: boolean;
}

export async function readPackage(adb: Adb, serial: string, user: number, pkg: string): Promise<LivePackage> {
  assertPkg(pkg);
  const info = parseDumpsysPackages(await out(adb, serial, ['dumpsys', 'package', pkg])).get(pkg);
  if (!info) return { state: 'absent', versionCode: null, lastUpdateTime: null, restorable: false };
  const u = info.users.get(user);
  const restorable = !info.codeGone;
  if (!u) return { state: 'unknown', versionCode: info.versionCode, lastUpdateTime: info.lastUpdateTime, restorable };
  return {
    state: !u.installed ? 'absent' : isEnabledState(u.enabledState) ? 'enabled' : 'disabled',
    versionCode: info.versionCode,
    lastUpdateTime: info.lastUpdateTime,
    restorable,
  };
}

export async function uninstallForUser(adb: Adb, serial: string, user: number, pkg: string, keepData: boolean): Promise<string> {
  const argv = ['pm', 'uninstall', ...(keepData ? ['-k'] : []), '--user', userArg(user), assertPkg(pkg)];
  return (await sh(adb, serial, argv, { timeoutMs: 120_000 })).stdout.trim();
}

export async function installExisting(adb: Adb, serial: string, user: number, pkg: string): Promise<string> {
  return (await sh(adb, serial, ['cmd', 'package', 'install-existing', '--user', userArg(user), assertPkg(pkg)], { timeoutMs: 120_000 })).stdout.trim();
}

export async function disablePackage(adb: Adb, serial: string, user: number, pkg: string): Promise<string> {
  return (await sh(adb, serial, ['pm', 'disable-user', '--user', userArg(user), assertPkg(pkg)])).stdout.trim();
}

export async function enablePackage(adb: Adb, serial: string, user: number, pkg: string): Promise<string> {
  return (await sh(adb, serial, ['pm', 'enable', '--user', userArg(user), assertPkg(pkg)])).stdout.trim();
}

export async function clearData(adb: Adb, serial: string, user: number, pkg: string): Promise<string> {
  return (await sh(adb, serial, ['pm', 'clear', '--user', userArg(user), assertPkg(pkg)], { timeoutMs: 120_000 })).stdout.trim();
}

const nsUser = (ns: SettingNs, user: number) => (ns === 'global' ? [] : ['--user', userArg(user)]);

export async function readSetting(adb: Adb, serial: string, user: number, ns: SettingNs, key: string): Promise<string> {
  return (await out(adb, serial, ['settings', 'get', ...nsUser(ns, user), ns, assertSettingKey(key)])).trim() || 'null';
}

/**
 * Writes a setting the way that really changes the device: radios go through
 * their system service (writing bluetooth_on alone would only change the stored
 * flag). `null` deletes the key again, which is how an unset value is restored.
 */
export async function writeSetting(adb: Adb, serial: string, user: number, ns: SettingNs, key: string, value: string, via: SettingVia): Promise<void> {
  assertSettingKey(key);
  if (via === 'cmd-location') {
    await sh(adb, serial, ['cmd', 'location', 'set-location-enabled', '--user', userArg(user), value === '0' ? 'false' : 'true']);
    return;
  }
  if (via === 'cmd-bluetooth') {
    await sh(adb, serial, ['cmd', 'bluetooth_manager', value === '0' ? 'disable' : 'enable']);
    return;
  }
  if (via === 'svc-bluetooth') {
    await sh(adb, serial, ['svc', 'bluetooth', value === '0' ? 'disable' : 'enable']);
    return;
  }
  if (value === 'null') await sh(adb, serial, ['settings', 'delete', ...nsUser(ns, user), ns, key]);
  else await sh(adb, serial, ['settings', 'put', ...nsUser(ns, user), ns, key, assertSettingValue(value)]);
}

/** Reads a setting until it shows the expected value (radios switch asynchronously). */
export async function settleSetting(adb: Adb, serial: string, user: number, ns: SettingNs, key: string, expected: string, tries = 8): Promise<string> {
  let v = await readSetting(adb, serial, user, ns, key);
  for (let i = 1; i < tries && v !== expected; i++) {
    await adb.sleep(750);
    v = await readSetting(adb, serial, user, ns, key);
  }
  return v;
}

export async function trimCaches(adb: Adb, serial: string): Promise<number | null> {
  const before = parseDf(await out(adb, serial, ['df', '-k', '/data']));
  await sh(adb, serial, ['pm', 'trim-caches', '999G'], { timeoutMs: 300_000 });
  const after = parseDf(await out(adb, serial, ['df', '-k', '/data']));
  return before && after ? Math.max(0, before.usedKb - after.usedKb) : null;
}

export async function playing(adb: Adb, serial: string): Promise<string[]> {
  return parsePlaying(await out(adb, serial, ['dumpsys', 'media_session']));
}

export async function foreground(adb: Adb, serial: string): Promise<{ pkg: string | null; component: string | null }> {
  const text = await out(adb, serial, ['dumpsys', 'activity', 'activities']);
  return { pkg: parseForeground(text), component: parseForegroundComponent(text) };
}

/** Whether the screen is on and unlocked. `null` when this Android version does not say. */
export async function screenState(adb: Adb, serial: string): Promise<{ awake: boolean | null; locked: boolean | null }> {
  const wake = parseWakefulness(await out(adb, serial, ['dumpsys', 'power']));
  const locked = parseKeyguardShowing(await out(adb, serial, ['dumpsys', 'activity', 'activities']));
  return { awake: wake === null ? null : wake === 'Awake', locked };
}

/**
 * Wakes the screen and reports why the device can't be checked right now: the
 * lock screen covers the home screen, so a health check would fail and roll back.
 */
export async function screenBlocker(adb: Adb, serial: string): Promise<string | null> {
  let s = await screenState(adb, serial);
  if (s.awake === false) {
    await sh(adb, serial, ['input', 'keyevent', 'KEYCODE_WAKEUP']);
    await adb.sleep(800);
    s = await screenState(adb, serial);
  }
  if (s.awake === false) return 'the screen is off';
  if (s.locked) return 'the screen is locked';
  return null;
}

export async function deviceEpoch(adb: Adb, serial: string): Promise<number> {
  const n = Number((await out(adb, serial, ['date', '+%s'])).trim());
  return Number.isFinite(n) && n > 0 ? n : Math.floor(adb.now().getTime() / 1000);
}
