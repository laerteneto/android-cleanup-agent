import { describe, expect, it } from 'vitest';
import { parseDevices, parseMdns, parseAdbVersion } from '../../src/parsers/connect.js';
import { parseDiskstats } from '../../src/parsers/diskstats.js';
import { parseMeminfo, pssByPackage } from '../../src/parsers/meminfo.js';
import { parseDumpsysPackages, parsePmList } from '../../src/parsers/packages.js';
import { parseDf, parseGetprop, parseSettingsList, parseUptime } from '../../src/parsers/props.js';
import { parseAccessibility, parseDeviceOwner, parseResolveActivity, parseWebview } from '../../src/parsers/roles.js';
import { parseCpuinfo, parseCrashes, parseForeground, parseForegroundComponent, parseKeyguardShowing, parsePlaying, parseThermal, parseTopAlarms, parseWakefulness } from '../../src/parsers/system.js';
import { parseDurationField, parseUsageStats } from '../../src/parsers/usage.js';

// Excerpts in the exact formats an Android 14 device prints (identifiers replaced).
describe('connection output', () => {
  it('mdns services, devices, version', () => {
    const m = parseMdns('List of discovered mdns services\nadb-DEMO-abc\t_adb-tls-connect._tcp\t192.0.2.10:39715\nadb-DEMO-abc\t_adb-tls-pairing._tcp\t192.0.2.10:46327\n');
    expect(m).toEqual([
      { name: 'adb-DEMO-abc', type: 'connect', host: '192.0.2.10', port: 39715 },
      { name: 'adb-DEMO-abc', type: 'pairing', host: '192.0.2.10', port: 46327 },
    ]);
    const d = parseDevices('List of devices attached\n192.0.2.10:34479    device product:Demo model:Demo_Go device:Demo transport_id:3\nadb-DEMO-abc._adb-tls-connect._tcp device product:Demo model:Demo_Go\nR5CT00000      unauthorized usb:1-1 transport_id:4\n');
    expect(d.map((x) => [x.serial, x.state, x.transport])).toEqual([
      ['192.0.2.10:34479', 'device', 'wifi'],
      ['adb-DEMO-abc._adb-tls-connect._tcp', 'device', 'mdns'],
      ['R5CT00000', 'unauthorized', 'usb'],
    ]);
    expect(parseAdbVersion('Android Debug Bridge version 1.0.41\nVersion 37.0.1-13456\nInstalled as /x/adb\n')).toBe('37.0.1');
  });
});

describe('properties and settings', () => {
  it('getprop, settings list, uptime, df', () => {
    expect(parseGetprop('[ro.product.model]: [Demo Go]\n[ro.build.version.sdk]: [34]\n')).toEqual({ 'ro.product.model': 'Demo Go', 'ro.build.version.sdk': '34' });
    expect(parseSettingsList('window_animation_scale=1.0\nenabled_x=a=b\n')).toEqual({ window_animation_scale: '1.0', enabled_x: 'a=b' });
    expect(parseUptime('6600000.50 50000000.00\n')).toBe(6600001);
    expect(parseDf('Filesystem       1K-blocks     Used Available Use% Mounted on\n/dev/block/dm-54  54117456 10381472  43604912  20% /data/user/0\n')).toEqual({ totalKb: 54117456, usedKb: 10381472, freeKb: 43604912 });
    expect(parseDf('garbage')).toBeNull();
  });
});

describe('packages', () => {
  it('pm list with installers', () => {
    const m = parsePmList('package:com.vodafone.demo  installer=com.android.vending\npackage:android  installer=null\n');
    expect([...m]).toEqual([
      ['com.vodafone.demo', 'com.android.vending'],
      ['android', null],
    ]);
  });
  it('dumpsys package: per-user state, ignores hidden system copies', () => {
    const text = `Packages:
  Package [com.google.android.youtube] (a1b2c3):
    userId=10104
    versionCode=1546123456 minSdk=26 targetSdk=34
    pkgFlags=[ SYSTEM HAS_CODE ALLOW_CLEAR_USER_DATA ]
    lastUpdateTime=2026-10-01 12:00:00
    User 0: ceDataInode=1 installed=true hidden=false suspended=false distractionFlags=0 stopped=false notLaunched=false enabled=0 instant=false virtual=false
  Package [com.google.android.calendar] (d4e5):
    versionCode=2000
    pkgFlags=[ SYSTEM HAS_CODE ]
    User 0: ceDataInode=2 installed=false hidden=false suspended=false distractionFlags=0 stopped=true notLaunched=false enabled=3 instant=false virtual=false

Hidden system packages:
  Package [com.google.android.youtube] (ffff):
    versionCode=1
`;
    const m = parseDumpsysPackages(text);
    expect(m.get('com.google.android.youtube')).toMatchObject({ versionCode: 1546123456, system: true, lastUpdateTime: '2026-10-01 12:00:00' });
    expect(m.get('com.google.android.youtube')?.users.get(0)).toEqual({ installed: true, enabledState: 0 });
    expect(m.get('com.google.android.calendar')?.users.get(0)).toEqual({ installed: false, enabledState: 3 });
  });
});

describe('usage', () => {
  it('durations', () => {
    expect(parseDurationField('313:46:55')).toBe(1_129_615_000);
    expect(parseDurationField('08:20')).toBe(500_000);
    expect(parseDurationField('x')).toBeNull();
  });
  it('reads the yearly section only; 1970 means never', () => {
    const text = `user=0
  In-memory daily stats
  timeRange="10/18/2026, 6:33 PM – 10/19/2026, 6:19 PM"
    packages
      package=com.google.android.youtube totalTimeUsed="07:35" lastTimeUsed="2026-10-19 10:10:54" appLaunchCount=0
  In-memory yearly stats
  timeRange="12/18/2025, 8:52 PM – 10/19/2026, 6:19 PM"
    packages
      package=com.google.android.youtube totalTimeUsed="313:46:55" lastTimeUsed="2026-10-19 10:10:54" totalTimeVisible="314:24:28" lastTimeVisible="2026-10-19 10:10:54" lastTimeComponentUsed="2026-10-19 10:03:18" totalTimeFS="00:00" lastTimeFS="1970-01-01 01:00:00" appLaunchCount=223
      package=com.google.android.gm totalTimeUsed="00:00" lastTimeUsed="1970-01-01 01:00:00" totalTimeVisible="00:00" lastTimeVisible="1970-01-01 01:00:00" lastTimeComponentUsed="2026-10-19 18:11:06" totalTimeFS="00:00" lastTimeFS="1970-01-01 01:00:00" appLaunchCount=0
`;
    const u = parseUsageStats(text)!;
    expect(u.window).toEqual({ from: '12/18/2025, 8:52 PM', to: '10/19/2026, 6:19 PM' });
    expect(u.byPkg.get('com.google.android.youtube')).toEqual({ totalMs: 1_129_615_000, lastUsed: '2026-10-19T10:10:54', launches: 223 });
    expect(u.byPkg.get('com.google.android.gm')).toEqual({ totalMs: 0, lastUsed: null, launches: 0 });
  });
  it('returns null instead of guessing on an unknown format', () => {
    expect(parseUsageStats('Last 24 hour events\n')).toBeNull();
    expect(parseUsageStats('In-memory yearly stats\n  timeRange="x"\n')).toBeNull();
  });
});

describe('storage, memory, background', () => {
  it('diskstats', () => {
    const d = parseDiskstats('Package Names: ["a.b","c.d"]\nApp Sizes: [1,2]\nApp Data Sizes: [3,4]\nCache Sizes: [5,6]\n')!;
    expect(d.get('c.d')).toEqual({ app: 2, data: 4, cache: 6 });
    expect(parseDiskstats('Package Names: ["a.b"]\nApp Sizes: [1,2]\nApp Data Sizes: [3]\nCache Sizes: [5]\n')).toBeNull();
  });
  it('meminfo and per-package PSS', () => {
    const m = parseMeminfo(`Total PSS by process:
    256,832K: system (pid 953)
    191,869K: com.google.android.googlequicksearchbox:googleapp (pid 3008)
     76,526K: com.google.android.googlequicksearchbox:interactor (pid 4180)
     66,961K: com.google.android.gms.unstable (pid 9296)

Total RAM: 8,045,076K (status normal)
 Free RAM: 5,680,145K (1,152,873K cached pss + 3,452,524K cached kernel + 1,074,748K free)
 Used RAM: 2,339,462K (1,609,974K used pss +   729,488K kernel)
`)!;
    expect(m).toMatchObject({ totalKb: 8_045_076, freeKb: 5_680_145, usedKb: 2_339_462 });
    const pss = pssByPackage(m.processes, ['com.google.android.googlequicksearchbox', 'com.google.android.gms']);
    expect(pss.get('com.google.android.googlequicksearchbox')).toBe(268_395);
    expect(pss.has('com.google.android.gms')).toBe(false); // gms.unstable is a different package name
    expect(parseMeminfo('nothing')).toBeNull();
  });
  it('alarms, cpu, thermal', () => {
    const alarms = parseTopAlarms(`  Top Alarms:
    +1m22s149ms running, 79 wakeups, 79 alarms: u0a87:com.google.android.gms
      *walarm*:com.google.android.gms.gcm.HEARTBEAT_ALARM
    +51s483ms running, 64 wakeups, 64 alarms: u0a111:com.google.android.calendar
      *alarm*:x
    +1m18s718ms running, 0 wakeups, 48 alarms: u0a111:com.google.android.calendar

 Alarm Stats:
`);
    expect(alarms.get('com.google.android.calendar')).toEqual({ alarms: 112, wakeups: 64 });
    expect(parseCpuinfo('Load: 1\n  9.1% 953/system_server: 5% user\n  5.7% 11165/com.android.settings: 4.2% user\n')).toEqual([
      { name: 'system_server', pct: 9.1 },
      { name: 'com.android.settings', pct: 5.7 },
    ]);
    expect(parseThermal('Thermal Status: 0\n\tTemperature{mValue=44.384, mType=0, mName=CPU, mStatus=0}\n\tTemperature{mValue=45.307, mType=1, mName=GPU, mStatus=0}\n\tTemperature{mValue=-273.0, mType=2, mName=BAT, mStatus=0}\n')).toEqual({ status: 0, maxC: 45.3 });
  });
  it('playback, foreground, crashes', () => {
    expect(parsePlaying('  YouTube com.google.android.youtube/YouTube (userId=0)\n    package=com.google.android.youtube\n    active=true\n    state=PlaybackState {state=3, position=12, buffered position=0}\n  x\n    package=com.spotify.music\n    state=PlaybackState {state=2, position=0}\n')).toEqual(['com.google.android.youtube']);
    const act = '  topResumedActivity=ActivityRecord{5bc917d u0 com.android.settings/.SubSettings t274}\n';
    expect(parseForeground(act)).toBe('com.android.settings');
    expect(parseForegroundComponent(act)).toBe('com.android.settings/.SubSettings');
    expect(parseForeground('  mResumedActivity: ActivityRecord{1 u0 com.example/.Main t3}\n')).toBe('com.example');
    const crash = '  1760000000.123  1234  1234 E AndroidRuntime: Process: com.android.launcher3, PID: 1234\n  1760000100.000  1  1 F libc    : Fatal signal 6 (SIGABRT), code -1 in tid 1438 (bt_stack), pid 1341 (droid.bluetooth)\n';
    expect(parseCrashes(crash, 1_760_000_050)).toEqual(['droid.bluetooth']);
    expect(parseCrashes(crash, 0)).toEqual(['com.android.launcher3', 'droid.bluetooth']);
  });
});

describe('roles', () => {
  it('resolve-activity, webview, accessibility, device owner', () => {
    expect(parseResolveActivity('priority=0 preferredOrder=0 match=0x108000\ncom.android.launcher3/com.android.searchlauncher.SearchLauncher\n')).toBe('com.android.launcher3/com.android.searchlauncher.SearchLauncher');
    expect(parseResolveActivity('No activity found\n')).toBeNull();
    expect(parseWebview('Current WebView package (name, version): (com.google.android.webview, 140.0.7339)\n')).toBe('com.google.android.webview');
    expect(parseAccessibility('com.a.b/.Svc:com.c.d/com.c.d.Other')).toEqual(['com.a.b', 'com.c.d']);
    expect(parseAccessibility('null')).toEqual([]);
    expect(parseDeviceOwner('no owners\n')).toBeNull();
    expect(parseDeviceOwner('Device owner (User 0): com.corp.mdm/.Admin\n')).toBe('com.corp.mdm');
  });

  it('reads whether the screen is on and locked (Android 16 format), null when absent', () => {
    expect(parseWakefulness('POWER MANAGER (dumpsys power)\n  mWakefulness=Dozing\n  mWakefulnessChanging=false\n')).toBe('Dozing');
    expect(parseWakefulness('nothing here')).toBeNull();
    expect(parseKeyguardShowing('  KeyguardController:\n    mKeyguardShowing=true\n    mKeyguardGoingAway=false\n')).toBe(true);
    expect(parseKeyguardShowing('    mKeyguardShowing=false\n')).toBe(false);
    expect(parseKeyguardShowing('ACTIVITY MANAGER ACTIVITIES\n')).toBeNull();
  });

  it('spots an app whose code was deleted but whose record and data were kept (pkg=null)', () => {
    const text = 'Packages:\n  Package [com.example.gone] (aec344a):\n    appId=10310\n    pkg=null\n    versionCode=5 targetSdk=36\n    pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]\n    User 0: ceDataInode=5794 installed=false hidden=false enabled=0 instant=false\n  Package [com.example.here] (b1):\n    pkg=Package{b1 com.example.here}\n    versionCode=1\n';
    const m = parseDumpsysPackages(text);
    expect(m.get('com.example.gone')).toMatchObject({ codeGone: true, system: false });
    expect(m.get('com.example.gone')!.users.get(0)).toEqual({ installed: false, enabledState: 0 });
    expect(m.get('com.example.here')!.codeGone).toBe(false);
  });
});

