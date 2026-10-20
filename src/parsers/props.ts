/** `getprop` → { 'ro.product.model': 'Pixel 8', … } */
export function parseGetprop(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^\[([^\]]+)\]: \[(.*)\]$/gm)) out[m[1] as string] = m[2] as string;
  return out;
}

/** `pm list features` → Set of feature names. */
export function parseFeatures(text: string): Set<string> {
  return new Set([...text.matchAll(/^feature:([^=\s]+)/gm)].map((m) => m[1] as string));
}

/** `settings list <ns>` → { key: value }. Values may contain '='. */
export function parseSettingsList(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** `cat /proc/uptime` → seconds. */
export function parseUptime(text: string): number | null {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s/);
  return m ? Math.round(Number(m[1])) : null;
}

/** `df -k /data` → KiB numbers for the data partition. */
export function parseDf(text: string): { totalKb: number; usedKb: number; freeKb: number } | null {
  const line = text.split('\n').find((l) => /\s\/data(\/|\s|$)/.test(l) || /^\S+\s+\d+\s+\d+\s+\d+/.test(l));
  const m = line?.match(/^\S+\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%/);
  return m ? { totalKb: Number(m[1]), usedKb: Number(m[2]), freeKb: Number(m[3]) } : null;
}
