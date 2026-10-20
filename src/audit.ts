/**
 * audit: one read-only pass over the device. Nothing here changes device state;
 * every command is a list, get or dumpsys. The result is the only input the
 * planner uses, so everything it decides on is visible in audit.json.
 */
import type { Catalog } from './catalog/loader.js';
import type { Audit, AuditPackage, DeviceClass, Snapshot } from './core/schemas.js';
import { CONTRACT_VERSION } from './core/schemas.js';
import { newRunId } from './core/util.js';
import { readDevice } from './device.js';
import { type Adb, out } from './platform/adb.js';
import { userArg } from './platform/argv.js';
import { parseDiskstats } from './parsers/diskstats.js';
import { parseMeminfo, pssByPackage } from './parsers/meminfo.js';
import { isEnabledState, parseDumpsysPackages, parsePmList } from './parsers/packages.js';
import { parseDf, parseSettingsList, parseUptime } from './parsers/props.js';
import { parseCpuinfo, parseForeground, parsePlaying, parseThermal, parseTopAlarms } from './parsers/system.js';
import { parseUsageStats } from './parsers/usage.js';

/** Settings the audit records besides the catalog's, so restore and reports know the starting point. */
const EXTRA_SETTINGS = ['system.screen_off_timeout', 'secure.screensaver_enabled'];

export async function snapshot(adb: Adb, serial: string): Promise<Snapshot> {
  const mem = parseMeminfo(await out(adb, serial, ['dumpsys', 'meminfo'], { timeoutMs: 120_000 }));
  return {
    at: adb.now().toISOString(),
    memory: mem ? { totalKb: mem.totalKb, freeKb: mem.freeKb, usedKb: mem.usedKb } : null,
    storage: parseDf(await out(adb, serial, ['df', '-k', '/data'])),
    uptimeSec: parseUptime(await out(adb, serial, ['cat', '/proc/uptime'])),
  };
}

export interface AuditOptions {
  serial: string;
  transport: 'usb' | 'wifi';
  catalog: Catalog;
  /** Overrides the detected class (the skill confirms the class with the user). */
  deviceClass?: DeviceClass;
  onStep?: (step: string) => void;
}

export async function runAudit(adb: Adb, opts: AuditOptions): Promise<Audit> {
  const { serial } = opts;
  const step = opts.onStep ?? (() => {});
  const warnings: string[] = [];

  step('device');
  const { device } = await readDevice(adb, { serial, transport: opts.transport, rules: opts.catalog.devices });
  if (opts.deviceClass && opts.deviceClass !== device.deviceClass) {
    device.classReason = `set by the user (detected ${device.deviceClass}: ${device.classReason})`;
    device.deviceClass = opts.deviceClass;
  }
  if (device.otherUsers.length) warnings.push(`This device has other users or a work profile (${device.otherUsers.join(', ')}); only user ${device.currentUser} is audited and changed.`);
  const u = userArg(device.currentUser);

  step('packages');
  const installed = parsePmList(await out(adb, serial, ['pm', 'list', 'packages', '--user', u, '-i']));
  const known = parsePmList(await out(adb, serial, ['pm', 'list', 'packages', '--user', u, '-u']));
  const system = parsePmList(await out(adb, serial, ['pm', 'list', 'packages', '--user', u, '-s']));
  const disabled = parsePmList(await out(adb, serial, ['pm', 'list', 'packages', '--user', u, '-d']));
  const details = parseDumpsysPackages(await out(adb, serial, ['dumpsys', 'package', 'packages'], { timeoutMs: 180_000 }));
  if (details.size === 0) warnings.push('Could not read package versions; changes will be matched by name and install state only.');

  step('usage');
  const usage = parseUsageStats(await out(adb, serial, ['dumpsys', 'usagestats'], { timeoutMs: 120_000 }));
  if (!usage) warnings.push('Could not read app usage history on this Android version; unused-app detection is off for this run.');

  step('storage');
  const sizes = parseDiskstats(await out(adb, serial, ['dumpsys', 'diskstats'], { timeoutMs: 120_000 }));
  if (!sizes) warnings.push('Per-app storage sizes are not available on this device.');

  step('memory');
  const mem = parseMeminfo(await out(adb, serial, ['dumpsys', 'meminfo'], { timeoutMs: 120_000 }));
  const pss = mem ? pssByPackage(mem.processes, known.keys()) : new Map<string, number>();

  step('background');
  const alarms = parseTopAlarms(await out(adb, serial, ['dumpsys', 'alarm'], { timeoutMs: 60_000 }));
  const cpu = parseCpuinfo(await out(adb, serial, ['dumpsys', 'cpuinfo']));
  const thermal = parseThermal(await out(adb, serial, ['dumpsys', 'thermalservice']));
  const playing = parsePlaying(await out(adb, serial, ['dumpsys', 'media_session']));
  const foreground = parseForeground(await out(adb, serial, ['dumpsys', 'activity', 'activities']));

  step('settings');
  const settings: Record<string, string> = {};
  const wanted = new Set([...opts.catalog.settings.map((s) => `${s.ns}.${s.key}`), ...EXTRA_SETTINGS]);
  for (const ns of ['global', 'secure', 'system'] as const) {
    const all = parseSettingsList(await out(adb, serial, ['settings', 'list', '--user', u, ns]));
    for (const key of wanted) if (key.startsWith(ns + '.')) settings[key] = all[key.slice(ns.length + 1)] ?? 'null';
  }

  const packages: AuditPackage[] = [...known.keys()].sort().map((pkg) => {
    const d = details.get(pkg);
    const userState = d?.users.get(device.currentUser);
    return {
      pkg,
      system: system.has(pkg) || Boolean(d?.system),
      enabled: userState ? isEnabledState(userState.enabledState) : !disabled.has(pkg),
      installed: installed.has(pkg),
      installer: installed.get(pkg) ?? null,
      versionCode: d?.versionCode ?? null,
      lastUpdateTime: d?.lastUpdateTime ?? null,
      usage: usage ? (usage.byPkg.get(pkg) ?? { totalMs: 0, lastUsed: null, launches: 0 }) : null,
      size: sizes?.get(pkg) ?? null,
      pssKb: mem ? (pss.get(pkg) ?? 0) : null,
      alarms: alarms.has(pkg) ? (alarms.get(pkg)?.alarms ?? 0) : null,
    };
  });

  step('snapshot');
  const snap = await snapshot(adb, serial);
  const now = adb.now();
  return {
    contract_version: CONTRACT_VERSION,
    run_id: newRunId(now),
    created_at: now.toISOString(),
    device,
    snapshot: snap,
    usageWindow: usage?.window ?? null,
    packages,
    settings,
    topMemory: (mem?.processes ?? []).slice(0, 12),
    topCpu: cpu,
    thermal,
    wakers: [...alarms.entries()]
      .map(([pkg, v]) => ({ pkg, alarms: v.alarms, wakeups: v.wakeups }))
      .sort((a, b) => b.wakeups - a.wakeups || b.alarms - a.alarms)
      .slice(0, 12),
    media: { playing: playing.length > 0, pkgs: playing },
    foreground,
    warnings,
  };
}
