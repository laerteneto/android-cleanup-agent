/**
 * Finding and connecting to a device. Wireless-debugging ports change on every
 * toggle, so they are discovered through mDNS rather than remembered. Pairing
 * codes are passed straight to adb and never logged or stored.
 */
import { type Adb, normalize, out } from './platform/adb.js';
import { type AdbDevice, type MdnsService, parseAdbVersion, parseDevices, parseMdns } from './parsers/connect.js';
import { fingerprintOf } from './device.js';
import { parseGetprop } from './parsers/props.js';

export const MIN_ADB = [30, 0, 0];
const HOST = /^(?:\d{1,3}\.){3}\d{1,3}$|^[A-Za-z0-9.-]+\.local$/;

export class NoDeviceError extends Error {}

export function assertHost(host: string): string {
  if (!HOST.test(host)) throw new Error(`invalid host ${JSON.stringify(host.slice(0, 60))} (use an IP address such as 192.168.1.50)`);
  return host;
}

export function versionAtLeast(v: string | null, min = MIN_ADB): boolean {
  if (!v) return false;
  const parts = v.split('.').map(Number);
  for (let i = 0; i < min.length; i++) {
    const a = parts[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export async function adbVersion(adb: Adb): Promise<string | null> {
  return parseAdbVersion(normalize((await adb.host(['version'])).stdout));
}

export async function listDevices(adb: Adb): Promise<AdbDevice[]> {
  return parseDevices(normalize((await adb.host(['devices', '-l'])).stdout));
}

export async function mdnsServices(adb: Adb): Promise<MdnsService[]> {
  const r = await adb.host(['mdns', 'services'], { timeoutMs: 10_000 });
  return parseMdns(normalize(r.stdout));
}

async function findService(adb: Adb, host: string, type: MdnsService['type'], tries: number): Promise<MdnsService | null> {
  for (let i = 0; i < tries; i++) {
    const s = (await mdnsServices(adb)).find((x) => x.host === host && x.type === type);
    if (s) return s;
    await adb.sleep(2000);
  }
  return null;
}

export async function pair(adb: Adb, host: string, code: string, port?: number): Promise<{ ok: boolean; message: string }> {
  assertHost(host);
  if (!/^\d{6}$/.test(code)) throw new Error('the pairing code is the 6 digits shown on the device');
  let p = port;
  if (!p) {
    const s = await findService(adb, host, 'pairing', 5);
    if (!s) return { ok: false, message: `no pairing screen found for ${host}. On the device open Wireless debugging → Pair device with pairing code, keep it open and run this again.` };
    p = s.port;
  }
  const r = await adb.host(['pair', `${host}:${p}`, code], { timeoutMs: 30_000 });
  const text = normalize(r.stdout + r.stderr);
  const ok = r.code === 0 && /Successfully paired/i.test(text);
  return { ok, message: ok ? `paired with ${host}` : `pairing failed: ${text.replace(/\d{6}/g, '******').trim().slice(0, 200)}` };
}

export async function connect(adb: Adb, host: string, port?: number): Promise<{ serial: string | null; state: string; message: string }> {
  assertHost(host);
  const targets: string[] = [];
  if (port) targets.push(`${host}:${port}`);
  else {
    const s = await findService(adb, host, 'connect', 3);
    if (s) targets.push(`${host}:${s.port}`);
    targets.push(`${host}:5555`);
  }
  for (const t of targets) {
    await adb.host(['connect', t], { timeoutMs: 15_000 });
    for (let i = 0; i < 15; i++) {
      const d = (await listDevices(adb)).find((x) => x.serial === t);
      if (d?.state === 'device') return { serial: t, state: 'device', message: `connected to ${t}` };
      if (d?.state === 'unauthorized') {
        if (i === 0) process.stderr.write('Check the device screen: allow the debugging prompt (tick "Always allow").\n');
      } else if (!d) break;
      await adb.sleep(2000);
    }
  }
  return {
    serial: null,
    state: 'unreachable',
    message: `could not connect to ${host}. Turn on Wireless debugging (or Network debugging on some TVs) and pair first if this computer is new to the device.`,
  };
}

export interface ResolveOptions {
  serial?: string;
  /** Pick the device with this fingerprint (resume, restore, verify after a reconnect). */
  fingerprint?: string;
}

/** The one ready device, or the one matching --serial / the fingerprint. mDNS duplicates of a Wi-Fi device are ignored. */
export async function resolveDevice(adb: Adb, opts: ResolveOptions = {}): Promise<AdbDevice> {
  const all = await listDevices(adb);
  const ready = all.filter((d) => d.state === 'device');
  const pick = (list: AdbDevice[]) => list.filter((d) => d.transport !== 'mdns').concat(list.filter((d) => d.transport === 'mdns'));
  if (opts.serial) {
    const d = all.find((x) => x.serial === opts.serial);
    if (!d) throw new NoDeviceError(`device ${opts.serial} is not connected`);
    if (d.state !== 'device') throw new NoDeviceError(stateGuidance(d));
    return d;
  }
  if (opts.fingerprint) {
    for (const d of pick(ready)) if ((await deviceFingerprint(adb, d.serial)) === opts.fingerprint) return d;
    throw new NoDeviceError('the device this run belongs to is not connected. Turn on wireless debugging and run `android-cleanup-agent connect --host <ip>`.');
  }
  const unique = dedupe(ready);
  if (unique.length === 1) return unique[0] as AdbDevice;
  if (unique.length === 0) {
    const blocked = all.find((d) => d.state !== 'device');
    throw new NoDeviceError(blocked ? stateGuidance(blocked) : 'no device connected. Plug in over USB, or run `android-cleanup-agent connect --host <device ip>`.');
  }
  throw new NoDeviceError(`${unique.length} devices are connected; choose one with --serial (${unique.map((d) => d.serial).join(', ')})`);
}

/** The same device can be listed as ip:port and as its mDNS name. */
function dedupe(devices: AdbDevice[]): AdbDevice[] {
  const wifi = devices.filter((d) => d.transport !== 'mdns');
  return wifi.length ? wifi : devices;
}

export function stateGuidance(d: AdbDevice): string {
  switch (d.state) {
    case 'unauthorized':
      return `${d.serial} has not trusted this computer yet: allow the debugging prompt on the device screen (tick "Always allow"), then run the command again.`;
    case 'offline':
      return `${d.serial} is offline: wake the screen, toggle Wireless debugging off and on, then reconnect.`;
    default:
      return `${d.serial} is in state "${d.state}".`;
  }
}

export async function deviceFingerprint(adb: Adb, serial: string): Promise<string | null> {
  const id = (await out(adb, serial, ['settings', 'get', 'secure', 'android_id'])).trim();
  if (!/^[0-9a-f]{8,}$/i.test(id)) return null;
  const props = parseGetprop(await out(adb, serial, ['getprop']));
  return fingerprintOf(id, props['ro.product.manufacturer'] ?? '', props['ro.product.model'] ?? '');
}
