/**
 * Who the device is (fingerprint), what it is (class), what must never be touched
 * on it right now (role holders) and what it can undo (capabilities).
 */
import type { Capabilities, Device, DeviceClass, Roles } from './core/schemas.js';
import { sha256 } from './core/util.js';
import { type Adb, out } from './platform/adb.js';
import { userArg } from './platform/argv.js';
import { parseFeatures, parseGetprop } from './parsers/props.js';
import { parseAccessibility, parseDeviceOwner, parseResolveActivity, parseRoleHolders, parseWebview, pkgOfComponent } from './parsers/roles.js';

export const MIN_SDK = 26;

export class UnsupportedDeviceError extends Error {}

export interface DeviceMatchRule {
  name: string;
  deviceClass: DeviceClass;
  manufacturer?: string[];
  brand?: string[];
  platform?: string[];
  packagesAny?: string[];
}

/** Glob with `*` only, case-insensitive. */
export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return re.test(value);
}

export interface ClassInput {
  props: Record<string, string>;
  features: Set<string>;
  homePkg: string | null;
  packages: Set<string>;
  onMains: boolean;
}

export function classify(input: ClassInput, rules: DeviceMatchRule[]): { deviceClass: DeviceClass; reason: string } {
  const p = input.props;
  const manufacturer = p['ro.product.manufacturer'] ?? '';
  if (/^amazon$/i.test(manufacturer) || p['ro.build.characteristics']?.includes('fireos')) {
    throw new UnsupportedDeviceError('Fire TV and other Amazon Fire OS devices are not supported (their system apps and settings differ too much to change safely).');
  }
  if (input.features.has('android.software.leanback') || input.features.has('android.software.leanback_only')) {
    if (input.homePkg === 'com.google.android.apps.tv.launcherx') return { deviceClass: 'google-tv', reason: 'leanback feature + Google TV home screen' };
    return { deviceClass: 'android-tv', reason: 'leanback feature' };
  }
  const brand = p['ro.product.brand'] ?? '';
  const platform = p['ro.board.platform'] ?? '';
  for (const r of rules) {
    const ok =
      (!r.manufacturer || r.manufacturer.some((m) => globMatch(m, manufacturer))) &&
      (!r.brand || r.brand.some((b) => globMatch(b, brand))) &&
      (!r.platform || r.platform.some((x) => globMatch(x, platform))) &&
      (!r.packagesAny || r.packagesAny.some((g) => [...input.packages].some((pkg) => globMatch(g, pkg))));
    if (ok) return { deviceClass: r.deviceClass, reason: `matches known device "${r.name}"` };
  }
  const characteristics = (p['ro.build.characteristics'] ?? '').split(',');
  if (characteristics.includes('tv')) return { deviceClass: 'android-tv', reason: 'build characteristics: tv' };
  if (input.features.has('android.hardware.telephony')) return { deviceClass: 'phone', reason: 'telephony feature' };
  if (characteristics.includes('tablet') && input.onMains) return { deviceClass: 'tablet-tv', reason: 'tablet build on mains power (likely a screen/TV)' };
  return { deviceClass: 'tablet', reason: characteristics.includes('tablet') ? 'tablet build' : 'no telephony' };
}

/** android_id is per-device and resets on factory reset; hashed so it never leaves the machine in clear. */
export function fingerprintOf(androidId: string, manufacturer: string, model: string): string {
  return sha256(`${androidId}\0${manufacturer}\0${model}`).slice(0, 16);
}

export async function readRoles(adb: Adb, serial: string, user: number, sdk: number): Promise<Roles> {
  const u = userArg(user);
  const role = async (name: string) => (sdk >= 29 ? parseRoleHolders(await out(adb, serial, ['cmd', 'role', 'get-role-holders', '--user', u, `android.app.role.${name}`])) : null);
  const home = pkgOfComponent(parseResolveActivity(await out(adb, serial, ['cmd', 'package', 'resolve-activity', '--brief', '--user', u, '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME'])));
  const setting = async (key: string) => (await out(adb, serial, ['settings', 'get', '--user', u, 'secure', key])).trim();
  const ime = pkgOfComponent(await setting('default_input_method'));
  const dialer = (await role('DIALER')) ?? pkgOfComponent(await setting('dialer_default_application'));
  const sms = (await role('SMS')) ?? pkgOfComponent(await setting('sms_default_application'));
  const assistant = (await role('ASSISTANT')) ?? pkgOfComponent(await setting('assistant'));
  const webview = parseWebview(await out(adb, serial, ['dumpsys', 'webviewupdate']));
  const accessibility = parseAccessibility(await setting('enabled_accessibility_services'));
  const deviceOwner = parseDeviceOwner(await out(adb, serial, ['dpm', 'list-owners']));
  return { home: home ?? (await role('HOME')), ime, dialer, sms, assistant, webview, accessibility, deviceOwner };
}

export async function readCapabilities(adb: Adb, serial: string, sdk: number): Promise<Capabilities> {
  const help = async (argv: string[]) => {
    const r = await adb.shell(serial, argv, { timeoutMs: 15_000 });
    return (r.stdout + r.stderr).toLowerCase();
  };
  const pkgHelp = await help(['cmd', 'package', 'help']);
  const loc = sdk >= 30 ? await help(['cmd', 'location', 'help']) : '';
  const bt = await help(['cmd', 'bluetooth_manager', 'help']);
  const svc = await help(['svc', 'bluetooth']);
  const media = await help(['dumpsys', 'media_session']);
  return {
    installExisting: pkgHelp.includes('install-existing'),
    cmdLocation: loc.includes('set-location-enabled'),
    cmdBluetooth: /\benable\b/.test(bt) && /\bdisable\b/.test(bt) && !bt.includes("can't find service"),
    svcBluetooth: svc.includes('enable') && !svc.includes('unknown command'),
    cmdRole: sdk >= 29,
    mediaSession: media.includes('sessions') || media.includes('media session'),
  };
}

export async function currentUser(adb: Adb, serial: string): Promise<{ current: number; others: number[] }> {
  const cur = Number((await out(adb, serial, ['am', 'get-current-user'])).trim());
  const users = [...(await out(adb, serial, ['pm', 'list', 'users'])).matchAll(/UserInfo\{(\d+):/g)].map((m) => Number(m[1]));
  const current = Number.isInteger(cur) && cur >= 0 ? cur : 0;
  return { current, others: users.filter((u) => u !== current) };
}

export interface ReadDeviceOptions {
  serial: string;
  transport: 'usb' | 'wifi';
  rules: DeviceMatchRule[];
}

export async function readDevice(adb: Adb, opts: ReadDeviceOptions): Promise<{ device: Device; props: Record<string, string>; packages: Set<string> }> {
  const { serial } = opts;
  const props = parseGetprop(await out(adb, serial, ['getprop']));
  const sdk = Number(props['ro.build.version.sdk'] ?? 0);
  if (!sdk) throw new Error('could not read the device properties (getprop returned nothing)');
  if (sdk < MIN_SDK) throw new UnsupportedDeviceError(`Android ${props['ro.build.version.release'] ?? sdk} (SDK ${sdk}) is too old; Android 8.0 (SDK ${MIN_SDK}) or newer is required.`);
  const features = parseFeatures(await out(adb, serial, ['pm', 'list', 'features']));
  const { current, others } = await currentUser(adb, serial);
  const roles = await readRoles(adb, serial, current, sdk);
  const packages = new Set([...(await out(adb, serial, ['pm', 'list', 'packages', '--user', userArg(current)])).matchAll(/^package:(\S+)/gm)].map((m) => m[1] as string));
  const battery = await out(adb, serial, ['dumpsys', 'battery']);
  const onMains = !/present: true/.test(battery) || /AC powered: true/.test(battery);
  const { deviceClass, reason } = classify({ props, features, homePkg: roles.home, packages, onMains }, opts.rules);
  const androidId = (await out(adb, serial, ['settings', 'get', 'secure', 'android_id'])).trim();
  if (!/^[0-9a-f]{8,}$/i.test(androidId)) throw new Error('could not read the device id (settings get secure android_id)');
  const manufacturer = props['ro.product.manufacturer'] ?? '';
  const model = props['ro.product.model'] ?? '';
  const device: Device = {
    fingerprint: fingerprintOf(androidId, manufacturer, model),
    serial,
    transport: opts.transport,
    model,
    brand: props['ro.product.brand'] ?? '',
    manufacturer,
    platform: props['ro.board.platform'] ?? '',
    sdk,
    release: props['ro.build.version.release'] ?? '',
    buildFingerprint: props['ro.build.fingerprint'] ?? '',
    characteristics: (props['ro.build.characteristics'] ?? '').split(',').filter(Boolean),
    features: {
      leanback: features.has('android.software.leanback'),
      touchscreen: features.has('android.hardware.touchscreen'),
      telephony: features.has('android.hardware.telephony'),
    },
    deviceClass,
    classReason: reason,
    currentUser: current,
    otherUsers: others,
    roles,
    capabilities: await readCapabilities(adb, serial, sdk),
  };
  return { device, props, packages };
}
