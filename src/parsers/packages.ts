/** `pm list packages [-i]` → package names (and installers when -i was used). */
export function parsePmList(text: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const m of text.matchAll(/^package:([A-Za-z0-9_.]+)(?:\s+installer=(\S+))?/gm)) {
    const installer = m[2] && m[2] !== 'null' ? m[2] : null;
    out.set(m[1] as string, installer);
  }
  return out;
}

export interface PackageInfo {
  pkg: string;
  versionCode: number | null;
  lastUpdateTime: string | null;
  system: boolean;
  /**
   * The app's code is gone but Android still holds its record and data (`pkg=null`).
   * That is what `pm uninstall -k` leaves of an app that is not part of the system
   * image: only a store reinstall brings it back; `install-existing` cannot.
   */
  codeGone: boolean;
  /** Per-user state: installed, and the enabled setting (0 default, 1 enabled, 2 disabled, 3 disabled-user, 4 disabled-until-used). */
  users: Map<number, { installed: boolean; enabledState: number }>;
}

/**
 * `dumpsys package packages` (all) or `dumpsys package <pkg>` (one). Parses the
 * "Packages:" section only; the "Hidden system packages:" section repeats the
 * factory copies of updated system apps and is ignored.
 */
export function parseDumpsysPackages(text: string): Map<string, PackageInfo> {
  const out = new Map<string, PackageInfo>();
  let cur: PackageInfo | null = null;
  let inHidden = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) {
      inHidden = /^Hidden system packages:/.test(line);
      if (!/^Packages:/.test(line)) cur = null;
      continue;
    }
    if (inHidden) continue;
    const head = line.match(/^ {2}Package \[([A-Za-z0-9_.]+)\] \(/);
    if (head) {
      cur = { pkg: head[1] as string, versionCode: null, lastUpdateTime: null, system: false, codeGone: false, users: new Map() };
      out.set(cur.pkg, cur);
      continue;
    }
    if (!cur) continue;
    const vc = line.match(/^\s+versionCode=(\d+)/);
    if (vc) cur.versionCode = Number(vc[1]);
    const lu = line.match(/^\s+lastUpdateTime=(.+)$/);
    if (lu) cur.lastUpdateTime = (lu[1] as string).trim();
    if (/^\s+pkg=null\s*$/.test(line)) cur.codeGone = true;
    if (/^\s+pkgFlags=\[.*\bSYSTEM\b/.test(line)) cur.system = true;
    const u = line.match(/^\s+User (\d+):.*\binstalled=(true|false)\b.*\benabled=(\d)\b/);
    if (u) cur.users.set(Number(u[1]), { installed: u[2] === 'true', enabledState: Number(u[3]) });
  }
  return out;
}

export function isEnabledState(state: number): boolean {
  return state === 0 || state === 1;
}
