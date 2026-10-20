/**
 * Health checks after a risky change: the home screen still comes up, the user's
 * main apps still open, and nothing new crashed. Never run while something is
 * playing (pressing Home would interrupt it).
 */
import { type Adb, out, sh } from './platform/adb.js';
import { assertPkg, userArg } from './platform/argv.js';
import { parseResolveActivity } from './parsers/roles.js';
import { parseCrashes } from './parsers/system.js';
import { deviceEpoch, foreground } from './ops.js';

/** Activities that pop over whatever is on screen after a settings change; dismissed with Back. */
export const KNOWN_POPUPS = ['com.google.android.gms/.location.settings.LocationOffWarningActivity', 'com.google.android.gms/com.google.android.location.settings.LocationOffWarningActivity'];

async function waitForeground(adb: Adb, serial: string, pkg: string, timeoutMs = 10_000): Promise<boolean> {
  const until = adb.now().getTime() + timeoutMs;
  do {
    if ((await foreground(adb, serial)).pkg === pkg) return true;
    await adb.sleep(700);
  } while (adb.now().getTime() < until);
  return false;
}

export async function pressHome(adb: Adb, serial: string): Promise<void> {
  await sh(adb, serial, ['input', 'keyevent', 'KEYCODE_HOME']);
}

export async function homeComesUp(adb: Adb, serial: string, homePkg: string | null): Promise<string | null> {
  await pressHome(adb, serial);
  if (!homePkg) return null;
  return (await waitForeground(adb, serial, homePkg)) ? null : `the home screen (${homePkg}) did not come back after pressing Home`;
}

export async function launcherComponent(adb: Adb, serial: string, user: number, pkg: string): Promise<string | null> {
  for (const category of ['android.intent.category.LAUNCHER', 'android.intent.category.LEANBACK_LAUNCHER']) {
    const c = parseResolveActivity(await out(adb, serial, ['cmd', 'package', 'resolve-activity', '--brief', '--user', userArg(user), '-a', 'android.intent.action.MAIN', '-c', category, assertPkg(pkg)]));
    if (c) return c;
  }
  return null;
}

export async function appOpens(adb: Adb, serial: string, user: number, pkg: string): Promise<string | null> {
  const component = await launcherComponent(adb, serial, user, pkg);
  if (!component) return `${pkg} has no launchable screen any more`;
  await sh(adb, serial, ['am', 'start', '--user', userArg(user), '-n', component]);
  const ok = await waitForeground(adb, serial, pkg, 15_000);
  return ok ? null : `${pkg} did not open`;
}

export async function crashesSince(adb: Adb, serial: string, sinceSec: number): Promise<string[]> {
  return parseCrashes(await out(adb, serial, ['logcat', '-b', 'crash', '-d', '-v', 'epoch']), sinceSec);
}

export interface HealthInput {
  user: number;
  homePkg: string | null;
  keep: string[];
  /** Device epoch seconds when the change was made; crashes before it are old news. */
  sinceSec: number;
  /** Processes whose crash means the change broke something. */
  watch: string[];
}

export async function healthCheck(adb: Adb, serial: string, h: HealthInput): Promise<string | null> {
  const home = await homeComesUp(adb, serial, h.homePkg);
  if (home) return home;
  for (const pkg of h.keep) {
    const why = await appOpens(adb, serial, h.user, pkg);
    if (why) return why;
    await pressHome(adb, serial);
  }
  const crashed = (await crashesSince(adb, serial, h.sinceSec)).filter((p) => h.watch.some((w) => p === w || p.startsWith(w + ':')) || p === 'system_server');
  if (crashed.length) return `crashed after the change: ${crashed.join(', ')}`;
  return null;
}

/** Dismisses a known popup that a settings change put over the screen. Returns what was dismissed. */
export async function dismissKnownPopup(adb: Adb, serial: string): Promise<string | null> {
  await adb.sleep(1200);
  const fg = await foreground(adb, serial);
  if (fg.component && KNOWN_POPUPS.includes(fg.component)) {
    await sh(adb, serial, ['input', 'keyevent', 'KEYCODE_BACK']);
    return fg.component;
  }
  return null;
}

export { deviceEpoch };
