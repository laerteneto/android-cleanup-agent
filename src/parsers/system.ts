/** `dumpsys cpuinfo` → top processes by recent CPU %. */
export function parseCpuinfo(text: string, limit = 10): Array<{ name: string; pct: number }> {
  const out: Array<{ name: string; pct: number }> = [];
  for (const m of text.matchAll(/^\s+([\d.]+)% \d+\/([^:\s]+):/gm)) {
    out.push({ name: m[2] as string, pct: Number(m[1]) });
    if (out.length >= limit) break;
  }
  return out;
}

/** `dumpsys thermalservice` → status (0 none … 6 shutdown) and the hottest CPU/GPU/SoC/skin reading. */
export function parseThermal(text: string): { status: number | null; maxC: number | null } {
  const st = text.match(/^Thermal Status: (\d+)/m);
  let maxC: number | null = null;
  for (const m of text.matchAll(/Temperature\{mValue=([\d.]+), mType=(\d+)/g)) {
    const t = Number(m[1]);
    if ([0, 1, 3, 13].includes(Number(m[2])) && t > 0 && t < 150) maxC = Math.max(maxC ?? 0, t);
  }
  return { status: st ? Number(st[1]) : null, maxC: maxC === null ? null : Math.round(maxC * 10) / 10 };
}

/** `dumpsys alarm` "Top Alarms" → alarm and wakeup counts per package (background wakers). */
export function parseTopAlarms(text: string): Map<string, { alarms: number; wakeups: number }> {
  const out = new Map<string, { alarms: number; wakeups: number }>();
  const start = text.indexOf('Top Alarms:');
  if (start < 0) return out;
  for (const line of text.slice(start).split('\n').slice(1)) {
    if (/^\S/.test(line) || /^\s*$/.test(line)) break;
    const m = line.match(/running, (\d+) wakeups, (\d+) alarms: [^:]+:([A-Za-z0-9_.]+)/);
    if (!m) continue;
    const cur = out.get(m[3] as string) ?? { alarms: 0, wakeups: 0 };
    cur.wakeups += Number(m[1]);
    cur.alarms += Number(m[2]);
    out.set(m[3] as string, cur);
  }
  return out;
}

/** `dumpsys media_session` → packages whose session is currently playing (PlaybackState 3). */
export function parsePlaying(text: string): string[] {
  const playing = new Set<string>();
  let pkg: string | null = null;
  for (const line of text.split('\n')) {
    const p = line.match(/^\s+package=([A-Za-z0-9_.]+)/);
    if (p) pkg = p[1] as string;
    if (pkg && /state=PlaybackState \{state=3\b/.test(line)) playing.add(pkg);
  }
  return [...playing];
}

/** `dumpsys activity activities` → package of the resumed (foreground) activity. */
export function parseForeground(text: string): string | null {
  const m = text.match(/(?:topResumedActivity|mResumedActivity|ResumedActivity)[=:] ?ActivityRecord\{\S+ u\d+ ([A-Za-z0-9_.]+)\//);
  return m ? (m[1] as string) : null;
}

/** `logcat -b crash -d -v epoch` → crash lines after `sinceSec`, with the process name when present. */
export function parseCrashes(text: string, sinceSec: number): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+\.\d+)\s+\d+\s+\d+\s+[FE]\s+(.*)$/);
    if (!m || Number(m[1]) < sinceSec) continue;
    const msg = m[2] as string;
    const proc = msg.match(/Process: ([A-Za-z0-9_.:]+)/) ?? msg.match(/pid \d+ \(([^)]+)\)/);
    if (proc) out.push(proc[1] as string);
  }
  return [...new Set(out)];
}

/** Like parseForeground, but "pkg/.Activity" so known popups can be recognised. */
export function parseForegroundComponent(text: string): string | null {
  const m = text.match(/(?:topResumedActivity|mResumedActivity|ResumedActivity)[=:] ?ActivityRecord\{\S+ u\d+ ([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/);
  return m ? (m[1] as string) : null;
}
