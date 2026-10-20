import { snapshot } from './audit.js';
import type { Audit, ManifestEntry, Results } from './core/schemas.js';
import { CONTRACT_VERSION } from './core/schemas.js';
import type { Adb } from './platform/adb.js';
import { pendingRestore, renderRestoreScript } from './restore.js';
import type { RunStore } from './runs.js';

/** Applied changes that are still in effect (not rolled back or restored since). */
export function inEffect(entries: ManifestEntry[]): ManifestEntry[] {
  return entries.filter(
    (e, i) =>
      e.op === 'apply' &&
      e.status === 'ok' &&
      !entries.slice(i + 1).some((l) => l.itemId === e.itemId && (l.op === 'rollback' || l.op === 'restore') && l.status === 'ok'),
  );
}

export async function computeResults(adb: Adb, store: RunStore, serial: string, audit: Audit): Promise<Results> {
  const entries = store.readManifest(audit.run_id);
  const live = inEffect(entries);
  const steps = pendingRestore(entries);
  const script = steps.length ? store.writeFile(audit.run_id, 'restore.sh', renderRestoreScript(audit, steps), 0o700) : null;
  const results: Results = {
    contract_version: CONTRACT_VERSION,
    run_id: audit.run_id,
    before: audit.snapshot,
    after: await snapshot(adb, serial),
    applied: live.length,
    removed: live.filter((e) => e.action === 'uninstall-user').length,
    disabled: live.filter((e) => e.action === 'disable').length,
    settingsChanged: live.filter((e) => e.action === 'setting').length,
    cacheFreedKb: live.filter((e) => e.action === 'trim-caches').reduce((s, e) => s + (e.kb ?? 0), 0),
    skipped: entries.filter((e) => e.op === 'skip').length,
    failed: entries.filter((e) => e.op === 'apply' && e.status === 'failed').length,
    rolledBack: entries.filter((e) => e.op === 'rollback' && e.status === 'ok').length,
    restoreScript: script,
    notRestorable: [
      ...live.filter((e) => e.restore === 'store-reinstall').map((e) => `${e.target}: reinstall from the Play Store`),
      ...entries.filter((e) => e.op === 'clear-data' && e.status === 'ok').map((e) => `${e.target}: app data was cleared and cannot be brought back`),
    ],
  };
  store.saveResults(results);
  return results;
}
