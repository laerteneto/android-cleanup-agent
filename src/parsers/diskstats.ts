export interface PackageSize {
  app: number;
  data: number;
  cache: number;
}

/** `dumpsys diskstats` → per-package byte sizes (Android 8+; the lists are computed periodically, not live). */
export function parseDiskstats(text: string): Map<string, PackageSize> | null {
  const list = (label: string): unknown[] | null => {
    const m = text.match(new RegExp(`^${label}: (\\[.*\\])$`, 'm'));
    if (!m) return null;
    try {
      const v = JSON.parse(m[1] as string) as unknown;
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const names = list('Package Names');
  const app = list('App Sizes');
  const data = list('App Data Sizes');
  const cache = list('Cache Sizes');
  if (!names || !app || !data || !cache || app.length !== names.length || data.length !== names.length || cache.length !== names.length) return null;
  const out = new Map<string, PackageSize>();
  names.forEach((n, i) => {
    if (typeof n === 'string') out.set(n, { app: Number(app[i]) || 0, data: Number(data[i]) || 0, cache: Number(cache[i]) || 0 });
  });
  return out;
}
