import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import type { DeviceMatchRule } from '../device.js';
import { globMatch } from '../device.js';
import { DeviceRule, type Match, NeverTouchEntry, type PackageEntry, PackageFile, SettingEntry, UserOverlay } from './schema.js';

export interface CatalogPackage extends PackageEntry {
  file: string;
  match: Match | undefined;
}

export interface Catalog {
  packages: CatalogPackage[];
  settings: SettingEntry[];
  neverTouch: NeverTouchEntry[];
  devices: DeviceMatchRule[];
}

/** catalog/ ships next to dist/ (npm) and next to src/ (repo). */
export function catalogDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [join(here, '../../catalog'), join(here, '../catalog'), join(here, '../../../catalog')]) {
    if (existsSync(join(c, 'never-touch.yaml'))) return c;
  }
  throw new Error('catalog folder not found next to the CLI; reinstall android-cleanup-agent');
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'));
}

export function loadCatalog(dir = catalogDir()): Catalog {
  const neverTouch = z.object({ packages: z.array(NeverTouchEntry) }).strict().parse(readYaml(join(dir, 'never-touch.yaml'))).packages;
  const settings = z.object({ settings: z.array(SettingEntry) }).strict().parse(readYaml(join(dir, 'settings.yaml'))).settings;
  const devices = z.object({ devices: z.array(DeviceRule) }).strict().parse(readYaml(join(dir, 'devices.yaml'))).devices;
  const packages: CatalogPackage[] = [];
  const seen = new Map<string, string>();
  const pdir = join(dir, 'packages');
  for (const f of readdirSync(pdir).filter((n) => n.endsWith('.yaml')).sort()) {
    let file;
    try {
      file = PackageFile.parse(readYaml(join(pdir, f)));
    } catch (e) {
      throw new Error(`catalog/packages/${f}: ${(e as Error).message}`);
    }
    for (const p of file.packages) {
      const prev = seen.get(p.id);
      if (prev) throw new Error(`catalog: ${p.id} is listed in both ${prev} and ${f}`);
      seen.set(p.id, f);
      packages.push({ ...p, file: f, match: file.match });
    }
  }
  const settingIds = new Set<string>();
  for (const s of settings) {
    if (settingIds.has(s.id)) throw new Error(`catalog: setting ${s.id} is listed twice`);
    settingIds.add(s.id);
    if (!s.from.length) throw new Error(`catalog: setting ${s.id} needs at least one "from" value`);
  }
  for (const p of packages) {
    const nt = neverTouch.find((n) => globMatch(n.pattern, p.id) && !n.classes);
    if (nt) throw new Error(`catalog: ${p.id} (${p.file}) is also on the never-touch list (${nt.pattern})`);
  }
  return { packages, settings, neverTouch, devices };
}

export function userOverlayPath(cfgDir: string): string {
  return join(cfgDir, 'catalog.yaml');
}

/** The user's overlay can only add protection or switch entries off; it can never add offers. */
export function loadUserOverlay(cfgDir: string): UserOverlay {
  const path = userOverlayPath(cfgDir);
  if (!existsSync(path)) return UserOverlay.parse({});
  try {
    return UserOverlay.parse(readYaml(path) ?? {});
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
}

export function fileMatches(match: Match | undefined, device: { manufacturer: string; brand: string }, installed: Set<string>): boolean {
  if (!match) return true;
  if (match.manufacturer && !match.manufacturer.some((m) => globMatch(m, device.manufacturer))) return false;
  if (match.brand && !match.brand.some((b) => globMatch(b, device.brand))) return false;
  if (match.packagesAny && !match.packagesAny.some((g) => [...installed].some((p) => globMatch(g, p)))) return false;
  return true;
}
