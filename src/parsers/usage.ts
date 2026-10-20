import type { Usage } from '../core/schemas.js';

/** "313:46:55" | "1:40:17" | "08:20" → ms. */
export function parseDurationField(s: string): number | null {
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return ((parts[0] as number) * 3600 + (parts[1] as number) * 60 + (parts[2] as number)) * 1000;
  if (parts.length === 2) return ((parts[0] as number) * 60 + (parts[1] as number)) * 1000;
  return null;
}

/** "2026-10-19 10:10:54" (device local time) → "2026-10-19T10:10:54"; the 1970 epoch means never. */
function deviceTime(s: string): string | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m || Number(m[1]) < 2000) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}`;
}

export interface UsageStats {
  window: { from: string; to: string } | null;
  byPkg: Map<string, Usage>;
}

/**
 * `dumpsys usagestats`: the "In-memory yearly stats" section (the longest window
 * Android keeps in memory, typically since setup or the last year). Returns null
 * when the section or its per-package lines are missing: callers then report no
 * usage evidence instead of guessing.
 */
export function parseUsageStats(text: string): UsageStats | null {
  const start = text.indexOf('In-memory yearly stats');
  if (start < 0) return null;
  const section = text.slice(start);
  const end = section.slice(1).search(/\n\S|\n {2}In-memory|\nuser=/);
  const body = end > 0 ? section.slice(0, end + 1) : section;
  const range = body.match(/timeRange="([^"]+)"/);
  let window: UsageStats['window'] = null;
  if (range) {
    const [from, to] = (range[1] as string).split(/\s+[–-]\s+/);
    if (from && to) window = { from: from.trim(), to: to.trim() };
  }
  const byPkg = new Map<string, Usage>();
  for (const m of body.matchAll(/package=([A-Za-z0-9_.]+) totalTimeUsed="([^"]+)" lastTimeUsed="([^"]+)"[^\n]*?(?:appLaunchCount=(\d+))?\s*$/gm)) {
    const pkg = m[1] as string;
    if (byPkg.has(pkg)) continue;
    const totalMs = parseDurationField(m[2] as string);
    if (totalMs === null) continue;
    byPkg.set(pkg, { totalMs, lastUsed: deviceTime(m[3] as string), launches: Number(m[4] ?? 0) });
  }
  if (byPkg.size === 0) return null;
  return { window, byPkg };
}
