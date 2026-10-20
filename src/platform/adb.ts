/**
 * The only way the CLI talks to a device. `RealAdb` runs the adb binary with
 * argument arrays; `FakeAdb` (tests) is a stateful device model. Every token sent
 * to the device shell passes `assertSafeArgv` first, because adb joins the
 * arguments into one string that the device's /system/bin/sh parses again.
 */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeoutMs?: number;
}

export interface Adb {
  /** Host-side adb: devices, connect, pair, mdns, version. Never `shell`. */
  host(args: string[], opts?: ExecOptions): Promise<ExecResult>;
  /** `adb -s <serial> shell <argv…>`. */
  shell(serial: string, argv: string[], opts?: ExecOptions): Promise<ExecResult>;
  now(): Date;
  sleep(ms: number): Promise<void>;
}

/** Thrown when adb reports the device is gone; `apply --resume` picks up from the manifest. */
export class DeviceDroppedError extends Error {
  constructor(readonly serial: string, detail: string) {
    super(`lost the connection to ${serial} (${detail.trim().slice(0, 120)}). Reconnect, then run the same command with --resume.`);
  }
}

const DROPPED = /device offline|device '[^']*' not found|no devices\/emulators found|device unauthorized|closed|connection reset|protocol fault|cannot connect/i;

export function isDropped(r: ExecResult): boolean {
  return r.code !== 0 && DROPPED.test(r.stderr + r.stdout);
}

/** Runs a device shell command and fails loudly on a dropped connection. */
export async function sh(adb: Adb, serial: string, argv: string[], opts?: ExecOptions): Promise<ExecResult> {
  const r = await adb.shell(serial, argv, opts);
  if (isDropped(r)) throw new DeviceDroppedError(serial, r.stderr || r.stdout);
  return r;
}

/** stdout of a shell command, '\r\n' normalized; empty string on failure. */
export async function out(adb: Adb, serial: string, argv: string[], opts?: ExecOptions): Promise<string> {
  const r = await sh(adb, serial, argv, opts);
  return r.code === 0 ? normalize(r.stdout) : '';
}

export function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '');
}
