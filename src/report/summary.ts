/**
 * The compact view the plugin skills read instead of audit.json / plan.json.
 * Size-capped so a phone with 400 packages never floods Claude's context.
 * Titles come from the catalog; device-provided names are only package ids.
 */
import type { Audit, Plan } from '../core/schemas.js';
import { CONTRACT_VERSION } from '../core/schemas.js';

export function auditSummary(a: Audit) {
  const d = a.device;
  const apps = a.packages.filter((p) => p.installed);
  return {
    contract_version: CONTRACT_VERSION,
    run_id: a.run_id,
    device: { manufacturer: d.manufacturer, model: d.model, release: d.release, sdk: d.sdk, deviceClass: d.deviceClass, classReason: d.classReason, transport: d.transport, otherUsers: d.otherUsers.length },
    snapshot: a.snapshot,
    apps: { installed: apps.length, userInstalled: apps.filter((p) => !p.system).length, turnedOff: apps.filter((p) => !p.enabled).length },
    usageHistory: a.usageWindow,
    topMemory: a.topMemory.slice(0, 8),
    topCpu: a.topCpu.slice(0, 5),
    wakers: a.wakers.slice(0, 6),
    thermal: a.thermal,
    playing: a.media.pkgs,
    mostUsed: apps
      .filter((p) => p.usage && p.usage.totalMs > 0)
      .sort((x, y) => (y.usage?.totalMs ?? 0) - (x.usage?.totalMs ?? 0))
      .slice(0, 8)
      .map((p) => ({ pkg: p.pkg, totalMs: p.usage?.totalMs, lastUsed: p.usage?.lastUsed })),
    settings: a.settings,
    warnings: a.warnings,
  };
}

export function planSummary(p: Plan) {
  return {
    contract_version: CONTRACT_VERSION,
    run_id: p.run_id,
    answers: p.answers,
    items: p.items.map((i) => ({
      id: i.id,
      category: i.category,
      title: i.title,
      pkg: i.pkg,
      risk: i.risk,
      action: i.action.type,
      recommended: i.recommended,
      requiresExplicit: i.requiresExplicit,
      homeCheck: i.homeCheck,
      evidence: i.evidence,
      restore: i.restore,
      notes: i.notes,
    })),
    excluded: p.excluded.slice(0, 40),
    unknownSystemCount: p.unknownSystem.length,
  };
}
