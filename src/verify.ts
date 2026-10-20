/**
 * verify: are the changes still in place? System updates can bring removed apps
 * back or re-enable them; this reports that drift instead of silently re-applying.
 */
import type { Audit, ManifestEntry, SettingNs } from './core/schemas.js';
import { readPackage, readSetting } from './ops.js';
import type { Adb } from './platform/adb.js';
import { inEffect } from './results.js';

export interface VerifyRow {
  itemId: string | null;
  target: string;
  expected: string;
  now: string;
  status: 'held' | 'reverted' | 'changed';
}

export async function verifyRun(adb: Adb, serial: string, audit: Audit, entries: ManifestEntry[]): Promise<VerifyRow[]> {
  const user = audit.device.currentUser;
  const rows: VerifyRow[] = [];
  for (const e of inEffect(entries)) {
    if (!e.target || e.action === 'trim-caches') continue;
    const expected = e.after ?? '';
    let now: string;
    if (e.action === 'setting') {
      const i = e.target.indexOf('.');
      now = await readSetting(adb, serial, user, e.target.slice(0, i) as SettingNs, e.target.slice(i + 1));
    } else {
      now = (await readPackage(adb, serial, user, e.target)).state;
    }
    const status = now === expected ? 'held' : now === e.before ? 'reverted' : 'changed';
    rows.push({ itemId: e.itemId ?? null, target: e.target, expected, now, status });
  }
  return rows;
}
