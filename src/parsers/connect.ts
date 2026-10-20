export interface MdnsService {
  name: string;
  type: 'connect' | 'pairing' | 'legacy';
  host: string;
  port: number;
}

/** `adb mdns services` → wireless-debugging endpoints. */
export function parseMdns(text: string): MdnsService[] {
  const out: MdnsService[] = [];
  for (const m of text.matchAll(/^(\S+)\s+_adb(-tls-connect|-tls-pairing)?\._tcp\.?\s+([\d.]+|\[[0-9a-f:]+\]):(\d+)/gim)) {
    const kind = m[2] === '-tls-connect' ? 'connect' : m[2] === '-tls-pairing' ? 'pairing' : 'legacy';
    out.push({ name: m[1] as string, type: kind, host: (m[3] as string).replace(/^\[|\]$/g, ''), port: Number(m[4]) });
  }
  return out;
}

export interface AdbDevice {
  serial: string;
  state: string;
  model: string | null;
  transport: 'usb' | 'wifi' | 'mdns';
}

/** `adb devices -l`. */
export function parseDevices(text: string): AdbDevice[] {
  const out: AdbDevice[] = [];
  for (const line of text.split('\n').slice(1)) {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|authorizing|no permissions|recovery|sideload|bootloader)\b(.*)$/);
    if (!m) continue;
    const serial = m[1] as string;
    const transport = /\._adb-tls-connect\._tcp/.test(serial) ? 'mdns' : /^[\d.]+:\d+$|^\[[0-9a-f:]+\]:\d+$/i.test(serial) ? 'wifi' : 'usb';
    out.push({ serial, state: m[2] as string, model: (m[3] ?? '').match(/model:(\S+)/)?.[1] ?? null, transport });
  }
  return out;
}

/** `adb version` → platform-tools version, e.g. "36.0.0". */
export function parseAdbVersion(text: string): string | null {
  return text.match(/Version (\d+\.\d+\.\d+)/)?.[1] ?? text.match(/Android Debug Bridge version (\d+\.\d+\.\d+)/)?.[1] ?? null;
}
