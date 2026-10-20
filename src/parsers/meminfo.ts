const kb = (s: string) => Number(s.replace(/,/g, ''));

export interface MemInfo {
  totalKb: number;
  freeKb: number;
  usedKb: number;
  /** Process name → PSS KiB, largest first. */
  processes: Array<{ name: string; pssKb: number }>;
}

/** `dumpsys meminfo` (no args). */
export function parseMeminfo(text: string): MemInfo | null {
  const total = text.match(/^\s*Total RAM:\s+([\d,]+)K/m);
  const free = text.match(/^\s*Free RAM:\s+([\d,]+)K/m);
  const used = text.match(/^\s*Used RAM:\s+([\d,]+)K/m);
  if (!total || !free || !used) return null;
  const processes: MemInfo['processes'] = [];
  const start = text.indexOf('Total PSS by process:');
  if (start >= 0) {
    for (const line of text.slice(start).split('\n').slice(1)) {
      const m = line.match(/^\s+([\d,]+)K: (\S+)(?: \(pid \d+)?/);
      if (!m) break;
      processes.push({ name: m[2] as string, pssKb: kb(m[1] as string) });
    }
  }
  return { totalKb: kb(total[1] as string), freeKb: kb(free[1] as string), usedKb: kb(used[1] as string), processes };
}

/** Sums PSS per package: "com.google.android.gms.unstable" and "com.google.android.gms:ui" both count for the package. */
export function pssByPackage(processes: MemInfo['processes'], packages: Iterable<string>): Map<string, number> {
  const pkgs = [...packages].sort((a, b) => b.length - a.length);
  const out = new Map<string, number>();
  for (const p of processes) {
    const owner = pkgs.find((pkg) => p.name === pkg || p.name.startsWith(pkg + ':'));
    if (owner) out.set(owner, (out.get(owner) ?? 0) + p.pssKb);
  }
  return out;
}
