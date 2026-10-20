/** `cmd package resolve-activity --brief …` → "pkg/cls" on the last line, or null. */
export function parseResolveActivity(text: string): string | null {
  const last = text.trim().split('\n').at(-1)?.trim() ?? '';
  return /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(last) ? last : null;
}

export function pkgOfComponent(component: string | null): string | null {
  if (!component || component === 'null') return null;
  const m = component.match(/^([A-Za-z0-9_.]+)(\/|$)/);
  return m ? (m[1] as string) : null;
}

/** `cmd role get-role-holders` → first holder. */
export function parseRoleHolders(text: string): string | null {
  const first = text.trim().split(/[\s;,]+/)[0] ?? '';
  return /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(first) ? first : null;
}

/** `dumpsys webviewupdate` → current WebView provider package. */
export function parseWebview(text: string): string | null {
  return text.match(/Current WebView package \(name, version\): \(([A-Za-z0-9_.]+),/)?.[1] ?? null;
}

/** `settings get secure enabled_accessibility_services` → packages. */
export function parseAccessibility(value: string): string[] {
  if (!value || value === 'null') return [];
  return [...new Set(value.split(':').map(pkgOfComponent).filter((p): p is string => Boolean(p)))];
}

/** `dpm list-owners` → device-owner package, if any. */
export function parseDeviceOwner(text: string): string | null {
  return text.match(/Device owner[^:]*:\s*(?:ComponentInfo\{)?([A-Za-z0-9_.]+)\//i)?.[1] ?? text.match(/User \d+: admin=([A-Za-z0-9_.]+)\/.*DeviceOwner/)?.[1] ?? null;
}
