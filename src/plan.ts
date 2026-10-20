/**
 * plan: audit + catalog + the user's answers → the list of offered changes.
 * Pure and deterministic: the same inputs always give the same plan. Only catalog
 * packages are offered, plus unused apps the user installed (never pre-selected).
 */
import type { Catalog, CatalogPackage } from './catalog/loader.js';
import { fileMatches } from './catalog/loader.js';
import type { SettingEntry, UserOverlay } from './catalog/schema.js';
import type { Answers, Audit, AuditPackage, Item, Plan, Risk, SettingVia } from './core/schemas.js';
import { CONTRACT_VERSION } from './core/schemas.js';
import { formatDuration, itemId } from './core/util.js';
import { protectedReason } from './safety/never-touch.js';

/** A catalog app used within this window is not offered: the user clearly uses it. */
export const RECENT_USE_DAYS = 60;
/** An app the user installed is offered (unticked) when unused for this long. */
export const USER_APP_IDLE_DAYS = 90;
const MIN_REAL_USE_MS = 60_000;
const MIN_CACHE_BYTES = 50_000_000;

const ORDER: Record<Item['category'], number> = {
  performance: 0,
  'background-scanning': 1,
  radios: 2,
  'media-apps': 3,
  'google-apps': 4,
  'oem-apps': 5,
  'social-apps': 6,
  analytics: 7,
  games: 8,
  'assistant-voice': 9,
  'user-apps': 10,
  caches: 11,
};

const RISK_ORDER: Risk[] = ['low', 'medium', 'high'];
const atLeast = (r: Risk, min: Risk): Risk => (RISK_ORDER.indexOf(r) >= RISK_ORDER.indexOf(min) ? r : min);

/** Device-local "YYYY-MM-DDTHH:MM:SS" vs the audit time; good to a day, which is all this needs. */
function daysSince(local: string, now: Date): number {
  return (now.getTime() - Date.parse(local + 'Z')) / 86_400_000;
}

function usageEvidence(p: AuditPackage) {
  return {
    lastUsed: p.usage?.lastUsed ?? null,
    totalMs: p.usage?.totalMs ?? null,
    launches: p.usage?.launches ?? null,
    bytes: p.size ? p.size.app + p.size.data + p.size.cache : null,
    pssKb: p.pssKb,
    alarms: p.alarms,
  };
}

function recentUse(p: AuditPackage, now: Date): string | null {
  const u = p.usage;
  if (!u?.lastUsed || u.totalMs < MIN_REAL_USE_MS) return null;
  const days = daysSince(u.lastUsed, now);
  return days <= RECENT_USE_DAYS ? `used ${formatDuration(u.totalMs)} in total, last ${Math.max(0, Math.round(days))} day(s) ago` : null;
}

export function settingVia(s: SettingEntry, audit: Audit): SettingVia | null {
  const c = audit.device.capabilities;
  if (s.via === 'settings') return 'settings';
  if (s.via === 'location') return c.cmdLocation ? 'cmd-location' : 'settings';
  if (s.via === 'bluetooth') return c.cmdBluetooth ? 'cmd-bluetooth' : c.svcBluetooth ? 'svc-bluetooth' : null;
  return null;
}

export interface PlanInput {
  audit: Audit;
  auditSha: string;
  catalog: Catalog;
  overlay: UserOverlay;
  answers: Answers;
  now: Date;
}

export function buildPlan(input: PlanInput): Plan {
  const { audit, catalog, overlay, answers } = input;
  const device = audit.device;
  const fp = device.fingerprint;
  const auditTime = new Date(audit.created_at);
  const uses = new Set(answers.uses);
  const items: Item[] = [];
  const excluded: Plan['excluded'] = [];
  const exclude = (target: string, reason: string) => excluded.push({ target, reason });
  const protection = { neverTouch: catalog.neverTouch, roles: device.roles, deviceClass: device.deviceClass, userProtect: overlay.protect, keep: answers.keep };
  const byPkg = new Map(audit.packages.map((p) => [p.pkg, p]));
  const installedSet = new Set(audit.packages.filter((p) => p.installed).map((p) => p.pkg));

  // Settings
  for (const s of catalog.settings) {
    const key = `${s.ns}.${s.key}`;
    const current = audit.settings[key];
    if (current === undefined || overlay.disable.includes(s.id)) continue;
    if (!s.classes.includes(device.deviceClass)) continue;
    if (device.sdk < s.minSdk) continue;
    const usedFeature = s.features.find((f) => uses.has(f));
    if (usedFeature) {
      exclude(key, `you use ${usedFeature}`);
      continue;
    }
    if (!s.power.includes(answers.power)) continue;
    if (s.symptoms.length && !s.symptoms.some((x) => answers.symptoms.includes(x))) continue;
    if (current === s.target || !s.from.includes(current)) continue;
    const via = settingVia(s, audit);
    if (!via) {
      exclude(key, 'this device has no way to change it that can be undone');
      continue;
    }
    items.push({
      id: itemId(fp, 'setting', key, audit.run_id),
      catalogId: s.id,
      category: s.category,
      title: s.title,
      risk: s.risk,
      action: { type: 'setting', ns: s.ns, key: s.key, value: s.target, via },
      identity: { kind: 'setting', ns: s.ns, key: s.key, value: current },
      evidence: { current },
      restore: 'setting',
      requiresExplicit: s.risk === 'high',
      recommended: s.risk === 'low',
      homeCheck: false,
      notes: s.notes,
    });
  }

  // Catalog packages
  const offerPackage = (entry: CatalogPackage) => {
    const p = byPkg.get(entry.id);
    if (!p || !p.installed) return;
    if (!entry.classes.includes(device.deviceClass)) return;
    if (!fileMatches(entry.match, device, installedSet)) return;
    if (overlay.disable.includes(entry.id)) return exclude(entry.id, 'switched off in your catalog.yaml');
    if (!p.enabled) return exclude(entry.id, 'already turned off');
    const why = protectedReason(entry.id, protection);
    if (why) return exclude(entry.id, why);
    const usedFeature = entry.features.find((f) => uses.has(f));
    if (usedFeature) return exclude(entry.id, `you use ${usedFeature}`);
    const recent = recentUse(p, auditTime);
    if (recent) return exclude(entry.id, recent);
    let action = entry.action;
    const notes = [...entry.notes];
    if (action === 'uninstall-user' && !device.capabilities.installExisting) {
      action = 'disable';
      notes.push('Turned off rather than removed: this device cannot reinstall removed system apps on its own.');
    }
    let risk = entry.riskByClass[device.deviceClass] ?? entry.risk;
    if (entry.confidence === 'community') risk = atLeast(risk, 'medium');
    items.push({
      id: itemId(fp, 'package', entry.id, audit.run_id),
      catalogId: entry.id,
      category: entry.category,
      title: entry.title,
      pkg: entry.id,
      risk,
      action: action === 'disable' ? { type: 'disable' } : { type: 'uninstall-user', keepData: true },
      identity: { kind: 'package', pkg: p.pkg, versionCode: p.versionCode, lastUpdateTime: p.lastUpdateTime, enabled: p.enabled, installed: p.installed },
      evidence: usageEvidence(p),
      restore: action === 'disable' ? 'enable' : 'install-existing',
      requiresExplicit: risk === 'high',
      recommended: risk === 'low' && entry.confidence === 'verified',
      homeCheck: entry.homeCheck,
      notes,
    });
  };
  for (const entry of catalog.packages) offerPackage(entry);

  // Apps the user installed and no longer uses
  const catalogIds = new Set(catalog.packages.map((c) => c.id));
  if (audit.usageWindow) {
    for (const p of audit.packages) {
      if (p.system || !p.installed || !p.enabled || catalogIds.has(p.pkg) || !p.usage) continue;
      if (protectedReason(p.pkg, protection)) continue;
      // Play-installed system-module updates (verifier, contactkeys, …) look user-installed but are not.
      if (p.pkg.startsWith('com.google.android.') && p.usage.launches === 0 && p.usage.totalMs === 0 && !p.usage.lastUsed) continue;
      const idle = p.usage.lastUsed ? daysSince(p.usage.lastUsed, auditTime) : Infinity;
      if (idle < USER_APP_IDLE_DAYS) continue;
      items.push({
        id: itemId(fp, 'package', p.pkg, audit.run_id),
        catalogId: null,
        category: 'user-apps',
        title: p.pkg,
        pkg: p.pkg,
        risk: 'medium',
        action: { type: 'uninstall-user', keepData: true },
        identity: { kind: 'package', pkg: p.pkg, versionCode: p.versionCode, lastUpdateTime: p.lastUpdateTime, enabled: p.enabled, installed: p.installed },
        evidence: usageEvidence(p),
        restore: 'store-reinstall',
        requiresExplicit: true,
        recommended: false,
        homeCheck: false,
        notes: [p.usage.lastUsed ? `Not opened for ${Math.round(idle)} days.` : 'Never opened since usage tracking began.', 'Reinstall from the Play Store if you want it back.'],
      });
    }
  }

  // App caches
  const cacheBytes = audit.packages.reduce((s, p) => s + (p.size?.cache ?? 0), 0);
  const sizesKnown = audit.packages.some((p) => p.size);
  if (!sizesKnown || cacheBytes >= MIN_CACHE_BYTES) {
    items.push({
      id: itemId(fp, 'device', 'trim-caches', audit.run_id),
      catalogId: 'trim-caches',
      category: 'caches',
      title: 'Clear all app caches',
      risk: 'low',
      action: { type: 'trim-caches' },
      identity: { kind: 'device' },
      evidence: { bytes: sizesKnown ? cacheBytes : null },
      restore: 'none',
      requiresExplicit: false,
      recommended: answers.symptoms.includes('storage'),
      homeCheck: false,
      notes: ['Logins and settings are kept. Apps rebuild their caches as you use them, so they may open a little slower the first time.'],
    });
  }

  items.sort((a, b) => ORDER[a.category] - ORDER[b.category] || Number(a.homeCheck) - Number(b.homeCheck) || (a.pkg ?? a.title).localeCompare(b.pkg ?? b.title));

  const unknownSystem = audit.packages
    .filter((p) => p.system && p.installed && p.enabled && !catalogIds.has(p.pkg) && !protectedReason(p.pkg, { ...protection, keep: [] }))
    .map((p) => p.pkg);

  return {
    contract_version: CONTRACT_VERSION,
    run_id: audit.run_id,
    created_at: input.now.toISOString(),
    audit_sha256: input.auditSha,
    fingerprint: fp,
    answers,
    items,
    excluded,
    unknownSystem,
  };
}
