/**
 * Validators for everything that reaches the device shell. adb concatenates the
 * shell arguments with spaces and the device's sh parses the result, so a token
 * with a quote, `;`, `$` or a space would be a second command. Only plain tokens
 * pass; package names and setting keys have their own stricter shapes.
 */
const SAFE = /^[A-Za-z0-9_.:\/=,@%+-]+$/;
export const PKG = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;
export const SETTING_KEY = /^[a-z0-9_.]+$/;
export const SETTING_VALUE = /^[A-Za-z0-9_.:\/-]*$/;
export const USER = /^\d{1,3}$/;

export function assertSafeArgv(argv: string[]): void {
  if (argv.length === 0) throw new Error('refusing an empty device command (it would open an interactive shell)');
  for (const t of argv) {
    if (!SAFE.test(t)) throw new Error(`refusing unsafe device shell token ${JSON.stringify(t.slice(0, 60))}`);
  }
}

export function assertPkg(pkg: string): string {
  if (!PKG.test(pkg) || pkg.length > 200) throw new Error(`invalid package name ${JSON.stringify(pkg.slice(0, 60))}`);
  return pkg;
}

export function assertSettingKey(key: string): string {
  if (!SETTING_KEY.test(key) || key.length > 100) throw new Error(`invalid setting key ${JSON.stringify(key.slice(0, 60))}`);
  return key;
}

export function assertSettingValue(value: string): string {
  if (!SETTING_VALUE.test(value) || value.length > 200) throw new Error(`invalid setting value ${JSON.stringify(value.slice(0, 60))}`);
  return value;
}

export function userArg(user: number): string {
  const s = String(user);
  if (!USER.test(s)) throw new Error(`invalid user id ${s}`);
  return s;
}
