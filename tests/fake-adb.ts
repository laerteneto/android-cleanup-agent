/**
 * A stateful fake Android device. It answers the commands the CLI sends in the
 * same text formats real devices print, and its state (packages, settings,
 * foreground app) changes when the CLI changes it, so a whole
 * audit → plan → apply → restore round trip can be checked exactly.
 * Every device here is synthetic: no captured personal data.
 */
import type { Adb, ExecOptions, ExecResult } from '../src/platform/adb.js';
import { assertSafeArgv } from '../src/platform/argv.js';

export interface FakePackage {
  pkg: string;
  system: boolean;
  enabled?: boolean;
  installed?: boolean;
  installer?: string | null;
  versionCode?: number;
  lastUpdateTime?: string;
  /** "h:mm:ss" total and "YYYY-MM-DD HH:MM:SS" last use; omitted = never used. */
  usage?: { total: string; last: string; launches: number };
  size?: { app: number; data: number; cache: number };
  pssKb?: number;
  alarms?: { alarms: number; wakeups: number };
  launcher?: string;
}

export interface FakeSpec {
  serial: string;
  androidId: string;
  props: Record<string, string>;
  features: string[];
  packages: FakePackage[];
  settings: { global: Record<string, string>; secure: Record<string, string>; system: Record<string, string> };
  home: string;
  ime?: string;
  webview?: string;
  battery?: { present: boolean; ac: boolean };
  thermalC?: number;
  dataKb?: { total: number; used: number };
  memKb?: { total: number; used: number };
  capabilities?: { installExisting?: boolean; cmdLocation?: boolean; cmdBluetooth?: boolean; svcBluetooth?: boolean };
  usageWindow?: string;
}

export interface Faults {
  /** After this many shell calls, the device is gone (`device offline`). */
  dropAfter?: number;
  /** While this package is disabled or removed, the home screen does not come back. */
  homeBreaksWithout?: string;
  /** Turning location off opens the GMS warning popup. */
  popupOnLocationOff?: boolean;
  /** The device refuses changes to these packages (like Samsung Knox). */
  refuse?: string[];
  playing?: string[];
  /** The lock screen is up (a person has to unlock it). */
  locked?: boolean;
  /** The screen is off; KEYCODE_WAKEUP turns it on. */
  asleep?: boolean;
  /** After this many shell calls, a person unlocks the device. */
  unlockAfter?: number;
  /** After this many shell calls, the device locks itself (screen timeout). */
  lockAfter?: number;
  /** Packages that crash right after any change. */
  crashAfterChange?: string[];
  /** The fingerprint the device reports changes (another device or a reset). */
  androidIdOverride?: string;
}

interface PkgState extends FakePackage {
  enabled: boolean;
  installed: boolean;
  /** After `pm uninstall -k` (or for system apps) the package manager still knows it. */
  known: boolean;
  /** Code deleted, record and data kept: what `pm uninstall -k` leaves of a non-system app (dumpsys shows `pkg=null`). */
  codeGone: boolean;
  dataCleared: boolean;
}

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr: string, code = 1): ExecResult => ({ code, stdout: '', stderr });

export class FakeAdb implements Adb {
  readonly log: string[][] = [];
  readonly hostLog: string[][] = [];
  pkgs: Map<string, PkgState>;
  settings: FakeSpec['settings'];
  foregroundPkg: string;
  foregroundComponent: string;
  crashes: Array<{ at: number; proc: string }> = [];
  shellCalls = 0;
  rebooted = false;
  clock: number;
  connected = true;

  constructor(
    readonly spec: FakeSpec,
    readonly faults: Faults = {},
    now = Date.parse('2026-10-19T18:00:00Z'),
  ) {
    this.clock = now;
    this.pkgs = new Map(spec.packages.map((p) => [p.pkg, { ...p, enabled: p.enabled ?? true, installed: p.installed ?? true, known: true, codeGone: false, dataCleared: false }]));
    this.settings = structuredClone(spec.settings);
    this.foregroundComponent = spec.home;
    this.foregroundPkg = spec.home.split('/')[0] as string;
  }

  now(): Date {
    return new Date(this.clock);
  }

  async sleep(ms: number): Promise<void> {
    this.clock += ms;
  }

  pkg(name: string): PkgState | undefined {
    return this.pkgs.get(name);
  }

  async host(args: string[], _opts?: ExecOptions): Promise<ExecResult> {
    this.hostLog.push(args);
    const [a0, a1] = args;
    if (a0 === 'version') return ok('Android Debug Bridge version 1.0.41\nVersion 36.0.0-13206524\n');
    if (a0 === 'devices') return ok(`List of devices attached\n${this.connected ? `${this.spec.serial}\tdevice product:demo model:${this.spec.props['ro.product.model']?.replace(/ /g, '_')} device:demo transport_id:1` : ''}\n`);
    if (a0 === 'mdns' && a1 === 'services') return ok(`List of discovered mdns services\nadb-demo\t_adb-tls-connect._tcp\t192.0.2.10:37001\nadb-demo\t_adb-tls-pairing._tcp\t192.0.2.10:37002\n`);
    if (a0 === 'pair') return args[2] === '123456' ? ok('Successfully paired to 192.0.2.10:37002 [guid=adb-demo]\n') : fail('Failed: Wrong password or connection was dropped.');
    if (a0 === 'connect') return ok(`connected to ${a1}\n`);
    if (a0 === '-s' && args[2] === 'reboot') {
      this.rebooted = true;
      this.connected = false;
      return ok();
    }
    return fail(`unknown host command ${args.join(' ')}`);
  }

  async shell(serial: string, argv: string[], _opts?: ExecOptions): Promise<ExecResult> {
    assertSafeArgv(argv);
    this.log.push(argv);
    this.shellCalls++;
    this.clock += 50;
    if (serial !== this.spec.serial || !this.connected) return fail(`adb: device '${serial}' not found`);
    if (this.faults.unlockAfter !== undefined && this.shellCalls > this.faults.unlockAfter) {
      this.faults.locked = false;
      delete this.faults.unlockAfter;
    }
    if (this.faults.lockAfter !== undefined && this.shellCalls > this.faults.lockAfter) {
      this.faults.locked = true;
      delete this.faults.lockAfter;
    }
    if (this.faults.dropAfter !== undefined && this.shellCalls > this.faults.dropAfter) {
      this.connected = false;
      return fail('error: device offline');
    }
    return this.dispatch(argv);
  }

  private epoch(): number {
    return Math.floor(this.clock / 1000);
  }

  private dispatch(a: string[]): ExecResult {
    const cmd = a.join(' ');
    const [a0, a1, a2] = a;
    const user = () => {
      const i = a.indexOf('--user');
      return i >= 0 ? Number(a[i + 1]) : 0;
    };
    const lastPkg = () => a.at(-1) as string;

    if (cmd === 'getprop') return ok(Object.entries(this.spec.props).map(([k, v]) => `[${k}]: [${v}]`).join('\n') + '\n');
    if (cmd === 'pm list features') return ok(this.spec.features.map((f) => `feature:${f}`).join('\n') + '\n');
    if (cmd === 'am get-current-user') return ok('0\n');
    if (cmd === 'pm list users') return ok('Users:\n\tUserInfo{0:Owner:c13} running\n');
    if (cmd === 'cat /proc/uptime') return ok('6600000.50 50000000.00\n');
    if (cmd === 'date +%s') return ok(`${this.epoch()}\n`);
    if (cmd === 'df -k /data') {
      const d = this.spec.dataKb ?? { total: 54_000_000, used: 10_000_000 };
      return ok(`Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/block/dm-5 ${d.total} ${d.used} ${d.total - d.used} 20% /data/user/0\n`);
    }
    if (cmd === 'dumpsys battery') {
      const b = this.spec.battery ?? { present: true, ac: false };
      return ok(`Current Battery Service state:\n  AC powered: ${b.ac}\n  USB powered: false\n  present: ${b.present}\n  level: 100\n`);
    }
    if (a0 === 'settings' && a1 === 'get') {
      const ns = a.at(-2) as keyof FakeSpec['settings'];
      const key = a.at(-1) as string;
      if (ns === 'secure' && key === 'android_id') return ok((this.faults.androidIdOverride ?? this.spec.androidId) + '\n');
      if (ns === 'secure' && key === 'default_input_method') return ok((this.spec.ime ?? 'null') + '\n');
      return ok((this.settings[ns]?.[key] ?? 'null') + '\n');
    }
    if (a0 === 'settings' && a1 === 'list') {
      const ns = a.at(-1) as keyof FakeSpec['settings'];
      return ok(Object.entries(this.settings[ns] ?? {}).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    }
    if (a0 === 'settings' && (a1 === 'put' || a1 === 'delete')) {
      const ns = (a1 === 'put' ? a.at(-3) : a.at(-2)) as keyof FakeSpec['settings'];
      const key = (a1 === 'put' ? a.at(-2) : a.at(-1)) as string;
      if (a1 === 'put') this.settings[ns][key] = a.at(-1) as string;
      else delete this.settings[ns][key];
      return ok();
    }
    if (cmd.startsWith('cmd role get-role-holders')) return ok(cmd.endsWith('HOME') ? (this.spec.home.split('/')[0] as string) + '\n' : '\n');
    if (cmd === 'dumpsys webviewupdate') return ok(`Current WebView package (name, version): (${this.spec.webview ?? 'com.google.android.webview'}, 140.0)\n`);
    if (cmd === 'dpm list-owners') return ok('no owners\n');
    if (cmd === 'cmd package help') return ok(this.spec.capabilities?.installExisting === false ? 'Package manager commands:\n  list packages\n' : 'Package manager commands:\n  install-existing [--user USER_ID] PACKAGE\n');
    if (cmd === 'cmd location help') return ok(this.spec.capabilities?.cmdLocation === false ? '' : 'Location service commands:\n  set-location-enabled [--user <USER_ID>] true|false\n');
    if (cmd === 'cmd bluetooth_manager help') return ok(this.spec.capabilities?.cmdBluetooth === false ? "cmd: Can't find service: bluetooth_manager\n" : 'Bluetooth Manager Commands:\n  enable\n  disable\n');
    if (cmd === 'svc bluetooth') return ok(this.spec.capabilities?.svcBluetooth === false ? '' : 'Control the Bluetooth manager\nusage: svc bluetooth [enable|disable]\n');
    if (cmd === 'cmd location set-location-enabled --user 0 false' || cmd === 'cmd location set-location-enabled --user 0 true') {
      const on = a.at(-1) === 'true';
      this.settings.secure.location_mode = on ? '3' : '0';
      if (!on && this.faults.popupOnLocationOff) {
        this.foregroundPkg = 'com.google.android.gms';
        this.foregroundComponent = 'com.google.android.gms/.location.settings.LocationOffWarningActivity';
      }
      return ok();
    }
    if (a0 === 'cmd' && a1 === 'bluetooth_manager' && (a2 === 'enable' || a2 === 'disable')) {
      this.settings.global.bluetooth_on = a2 === 'enable' ? '1' : '0';
      return ok();
    }
    if (a0 === 'svc' && a1 === 'bluetooth') {
      this.settings.global.bluetooth_on = a2 === 'enable' ? '1' : '0';
      return ok();
    }
    if (cmd.startsWith('cmd package resolve-activity')) {
      if (cmd.includes('category.HOME')) return ok(`priority=0 preferredOrder=0 match=0x108000\n${this.spec.home}\n`);
      const p = this.pkg(lastPkg());
      if (!p || !p.installed || !p.enabled || !p.launcher) return ok('No activity found\n');
      return ok(`priority=0 preferredOrder=0 match=0x108000\n${p.pkg}/${p.launcher}\n`);
    }
    if (a0 === 'pm' && a1 === 'list' && a2 === 'packages') return ok(this.pmList(a));
    if (cmd === 'dumpsys package packages') return ok(this.dumpsysPackages([...this.pkgs.values()].filter((p) => p.known)));
    if (a0 === 'dumpsys' && a1 === 'package' && a2) {
      const p = this.pkg(a2);
      return ok(p && p.known ? this.dumpsysPackages([p]) : `Unable to find package: ${a2}\n`);
    }
    if (cmd === 'dumpsys usagestats') return ok(this.usagestats());
    if (cmd === 'dumpsys diskstats') return ok(this.diskstats());
    if (cmd === 'dumpsys meminfo') return ok(this.meminfo());
    if (cmd === 'dumpsys alarm') return ok(this.alarms());
    if (cmd === 'dumpsys cpuinfo') return ok('Load: 1.2 / 1.0 / 0.9\nCPU usage from 1000ms to 0ms ago:\n  9.1% 953/system_server: 5% user + 4.1% kernel\n  4.1% 339/surfaceflinger: 2.6% user + 1.4% kernel\n');
    if (cmd === 'dumpsys thermalservice') return ok(`IsStatusOverride: false\nThermal Status: 0\n\tTemperature{mValue=${this.spec.thermalC ?? 44.4}, mType=0, mName=CPU, mStatus=0}\n`);
    if (cmd === 'dumpsys media_session') {
      const lines = ['MEDIA SESSION SERVICE (dumpsys media_session)', 'Sessions Stack - have 1 sessions:'];
      for (const p of this.faults.playing ?? []) lines.push(`  demo ${p}/demo (userId=0)`, `    package=${p}`, '    active=true', '    state=PlaybackState {state=3, position=1000}');
      return ok(lines.join('\n') + '\n');
    }
    if (cmd === 'dumpsys activity activities') return ok(`ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)\n  topResumedActivity=ActivityRecord{5bc917d u0 ${this.foregroundComponent} t274}\n  KeyguardController:\n    mKeyguardShowing=${Boolean(this.faults.locked)}\n`);
    if (cmd === 'dumpsys power') return ok(`POWER MANAGER (dumpsys power)\n  mWakefulness=${this.faults.asleep ? 'Asleep' : 'Awake'}\n`);
    if (cmd === 'logcat -b crash -d -v epoch') return ok(this.crashes.map((c) => `  ${c.at}.000  1234  1234 E AndroidRuntime: Process: ${c.proc}, PID: 1234`).join('\n') + '\n');
    if (a0 === 'input' && a1 === 'keyevent') {
      if (a2 === 'KEYCODE_WAKEUP') {
        this.faults.asleep = false;
        return ok();
      }
      // A locked or sleeping device stays on the lock screen whatever is pressed.
      if (this.faults.locked || this.faults.asleep) return ok();
      if (a2 === 'KEYCODE_HOME') {
        const broken = this.faults.homeBreaksWithout && !this.isLive(this.faults.homeBreaksWithout);
        this.foregroundComponent = broken ? 'com.android.settings/.FallbackHome' : this.spec.home;
      } else if (a2 === 'KEYCODE_BACK') {
        this.foregroundComponent = this.spec.home;
      }
      this.foregroundPkg = this.foregroundComponent.split('/')[0] as string;
      return ok();
    }
    if (a0 === 'am' && a1 === 'start') {
      const comp = a.at(-1) as string;
      this.foregroundComponent = comp;
      this.foregroundPkg = comp.split('/')[0] as string;
      return ok(`Starting: Intent { cmp=${comp} }\n`);
    }
    // Mutations
    if (a0 === 'pm' && (a1 === 'uninstall' || a1 === 'disable-user' || a1 === 'enable' || a1 === 'clear')) return this.mutatePackage(a1, lastPkg(), a.includes('-k'));
    if (cmd.startsWith('cmd package install-existing')) {
      if (this.spec.capabilities?.installExisting === false) return fail('Unknown command: install-existing');
      const p = this.pkg(lastPkg());
      if (!p || !p.known || p.codeGone) return fail(`android.content.pm.PackageManager$NameNotFoundException: Package ${lastPkg()} doesn't exist`);
      p.installed = true;
      p.enabled = true;
      return ok(`Package ${p.pkg} installed for user: ${user()}\n`);
    }
    if (cmd === 'pm trim-caches 999G') {
      let freed = 0;
      for (const p of this.pkgs.values()) if (p.size) {
        freed += p.size.cache;
        p.size = { ...p.size, cache: 0 };
      }
      if (this.spec.dataKb) this.spec.dataKb = { ...this.spec.dataKb, used: this.spec.dataKb.used - Math.round(freed / 1024) };
      return ok();
    }
    return fail(`/system/bin/sh: unknown fake command: ${cmd}`, 127);
  }

  isLive(pkg: string): boolean {
    const p = this.pkg(pkg);
    return Boolean(p && p.installed && p.enabled);
  }

  private mutatePackage(op: string, name: string, keep: boolean): ExecResult {
    const p = this.pkg(name);
    if (!p || !p.known) return ok(op === 'uninstall' ? 'Failure [DELETE_FAILED_INTERNAL_ERROR]\n' : `Error: Unknown package: ${name}\n`);
    if (this.faults.refuse?.includes(name)) return ok(`Error: java.lang.SecurityException: Shell cannot change component state for ${name}\n`);
    const before = this.epoch();
    if (op === 'uninstall') {
      p.installed = false;
      // Real devices (checked on Android 16): a non-system app removed for its only
      // user loses its code even with -k; only the record and data stay.
      if (!p.system) {
        if (keep) p.codeGone = true;
        else p.known = false;
      }
    } else if (op === 'disable-user') {
      p.enabled = false;
    } else if (op === 'enable') {
      p.enabled = true;
    } else if (op === 'clear') {
      p.dataCleared = true;
      return ok('Success\n');
    }
    for (const proc of this.faults.crashAfterChange ?? []) this.crashes.push({ at: before + 1, proc });
    if (op === 'uninstall') return ok('Success\n');
    if (op === 'disable-user') return ok(`Package ${name} new state: disabled-user\n`);
    return ok(`Package ${name} new state: enabled\n`);
  }

  private pmList(a: string[]): string {
    const all = [...this.pkgs.values()].filter((p) => p.known);
    let list = a.includes('-u') ? all : all.filter((p) => p.installed);
    if (a.includes('-s')) list = list.filter((p) => p.system);
    if (a.includes('-3')) list = list.filter((p) => !p.system);
    if (a.includes('-d')) list = list.filter((p) => !p.enabled);
    if (a.includes('-e')) list = list.filter((p) => p.enabled);
    return list.map((p) => `package:${p.pkg}${a.includes('-i') ? `  installer=${p.installer ?? 'null'}` : ''}`).join('\n') + '\n';
  }

  private dumpsysPackages(list: PkgState[]): string {
    const lines = ['Packages:'];
    for (const p of list) {
      lines.push(`  Package [${p.pkg}] (a1b2c3):`, `    versionCode=${p.versionCode ?? 1} minSdk=26 targetSdk=34`, `    pkg=${p.codeGone ? 'null' : `Package{a1b2c3 ${p.pkg}}`}`, `    pkgFlags=[ ${p.system ? 'SYSTEM ' : ''}HAS_CODE ALLOW_CLEAR_USER_DATA ]`, `    lastUpdateTime=${p.lastUpdateTime ?? '2026-01-01 10:00:00'}`);
      lines.push(`    User 0: ceDataInode=1 installed=${p.installed} hidden=false suspended=false distractionFlags=0 stopped=false notLaunched=false enabled=${p.enabled ? 0 : 3} instant=false virtual=false`);
    }
    lines.push('', 'Hidden system packages:', '  Package [com.google.android.youtube] (ffff):', '    versionCode=1');
    return lines.join('\n') + '\n';
  }

  private usagestats(): string {
    const rows = [...this.pkgs.values()].map(
      (p) => `      package=${p.pkg} totalTimeUsed="${p.usage?.total ?? '00:00'}" lastTimeUsed="${p.usage?.last ?? '1970-01-01 01:00:00'}" totalTimeVisible="00:00" lastTimeVisible="1970-01-01 01:00:00" lastTimeComponentUsed="1970-01-01 01:00:00" totalTimeFS="00:00" lastTimeFS="1970-01-01 01:00:00" appLaunchCount=${p.usage?.launches ?? 0} `,
    );
    return ['user=0', '  In-memory daily stats', '  timeRange="10/18/2026, 6:33 PM – 10/19/2026, 6:19 PM" ', '    packages', '  In-memory yearly stats', `  timeRange="${this.spec.usageWindow ?? '12/18/2025, 8:52 PM – 10/19/2026, 6:19 PM'}" `, '    packages', ...rows, ''].join('\n');
  }

  private diskstats(): string {
    const list = [...this.pkgs.values()].filter((p) => p.size);
    return [
      'Latency: 0ms [512B Data Write]',
      `Package Names: ${JSON.stringify(list.map((p) => p.pkg))}`,
      `App Sizes: ${JSON.stringify(list.map((p) => p.size?.app))}`,
      `App Data Sizes: ${JSON.stringify(list.map((p) => p.size?.data))}`,
      `Cache Sizes: ${JSON.stringify(list.map((p) => p.size?.cache))}`,
      '',
    ].join('\n');
  }

  private meminfo(): string {
    const live = [...this.pkgs.values()].filter((p) => p.installed && p.enabled && p.pssKb);
    const m = this.spec.memKb ?? { total: 8_045_076, used: 2_339_462 };
    const used = m.used - [...this.pkgs.values()].filter((p) => p.pssKb && !(p.installed && p.enabled)).reduce((s, p) => s + (p.pssKb ?? 0), 0);
    const fmt = (n: number) => n.toLocaleString('en-US');
    return [
      'Applications Memory Usage (in Kilobytes):',
      '',
      'Total PSS by process:',
      `    ${fmt(256_832)}K: system (pid 953)`,
      ...live.sort((x, y) => (y.pssKb ?? 0) - (x.pssKb ?? 0)).map((p, i) => `    ${fmt(p.pssKb ?? 0)}K: ${p.pkg} (pid ${2000 + i})`),
      '',
      'Total PSS by OOM adjustment:',
      `Total RAM: ${fmt(m.total)}K (status normal)`,
      ` Free RAM: ${fmt(m.total - used)}K (1,000K cached pss + 1,000K cached kernel + 1,000K free)`,
      ` Used RAM: ${fmt(used)}K (1,000K used pss + 1,000K kernel)`,
      '',
    ].join('\n');
  }

  private alarms(): string {
    const rows = [...this.pkgs.values()].filter((p) => p.alarms && p.installed && p.enabled).map((p) => `    +1m0s0ms running, ${p.alarms?.wakeups} wakeups, ${p.alarms?.alarms} alarms: u0a87:${p.pkg}\n      *alarm*:demo`);
    return ['Current Alarm Manager state:', '  Top Alarms:', ...rows, '', 'Alarm Stats:', ''].join('\n');
  }
}
