import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Adb, ExecOptions, ExecResult } from './adb.js';
import { assertSafeArgv } from './argv.js';

const DEFAULT_TIMEOUT = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** PATH first, then the usual SDK locations, so a fresh Android Studio install works without PATH changes. */
export function findAdb(env: NodeJS.ProcessEnv = process.env): string | null {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const dirs = [
    ...(env.PATH ?? '').split(delimiter).filter(Boolean),
    ...[env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter((d): d is string => Boolean(d)).map((d) => join(d, 'platform-tools')),
    join(homedir(), 'Library/Android/sdk/platform-tools'),
    join(homedir(), 'Android/Sdk/platform-tools'),
  ];
  for (const d of dirs) {
    const p = join(d, exe);
    if (existsSync(p)) return p;
  }
  return null;
}

function run(bin: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : 1) : 0;
      const killed = err && (err as { killed?: boolean }).killed;
      resolve({ code, stdout: stdout ?? '', stderr: (stderr ?? '') + (killed ? '\ntimed out' : '') });
    });
  });
}

export class RealAdb implements Adb {
  constructor(readonly bin: string) {}

  host(args: string[], opts?: ExecOptions): Promise<ExecResult> {
    if (args[0] === 'shell' || args.includes('shell')) throw new Error('host() never runs a device shell; use shell()');
    return run(this.bin, args, opts);
  }

  shell(serial: string, argv: string[], opts?: ExecOptions): Promise<ExecResult> {
    assertSafeArgv(argv);
    return run(this.bin, ['-s', serial, 'shell', ...argv], opts);
  }

  now(): Date {
    return new Date();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
