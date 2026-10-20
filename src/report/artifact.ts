/**
 * The shareable report (a claude.ai Artifact). Built from a typed payload of enums
 * and numbers ONLY: no model name, no package names, no user-installed apps, so
 * nothing that identifies the device or its owner can leave the machine in it.
 */
import { z } from 'zod';
import { Category, DeviceClass, type Plan, type Results, type Audit } from '../core/schemas.js';
import { formatKb } from '../core/util.js';
import { CATEGORY_TITLES, CLASS_TITLES } from './common.js';
import { esc, PAGE_CSS } from './html.js';

const Snap = z.object({ ramUsedKb: z.number().nonnegative().nullable(), ramTotalKb: z.number().nonnegative().nullable(), storageFreeKb: z.number().nonnegative().nullable() }).strict();

export const ArtifactPayload = z
  .object({
    generated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    deviceClass: DeviceClass,
    androidRelease: z.string().regex(/^[0-9.]{1,8}$/),
    before: Snap,
    after: Snap.nullable(),
    categories: z.array(z.object({ category: Category, offered: z.number().int().nonnegative(), applied: z.number().int().nonnegative() }).strict()),
    restartedAfterDays: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ArtifactPayload = z.infer<typeof ArtifactPayload>;

const snap = (s: Results['before']) => ({ ramUsedKb: s.memory?.usedKb ?? null, ramTotalKb: s.memory?.totalKb ?? null, storageFreeKb: s.storage?.freeKb ?? null });

export function buildArtifactPayload(a: Audit, plan: Plan | null, results: Results | null, appliedIds: Set<string>): ArtifactPayload {
  const cats = new Map<Category, { offered: number; applied: number }>();
  for (const i of plan?.items ?? []) {
    const c = cats.get(i.category) ?? { offered: 0, applied: 0 };
    c.offered++;
    if (appliedIds.has(i.id)) c.applied++;
    cats.set(i.category, c);
  }
  return ArtifactPayload.parse({
    generated: a.created_at.slice(0, 10),
    deviceClass: a.device.deviceClass,
    androidRelease: /^[0-9.]{1,8}$/.test(a.device.release) ? a.device.release : '0',
    before: snap(a.snapshot),
    after: results ? snap(results.after) : null,
    categories: [...cats].map(([category, v]) => ({ category, ...v })),
    restartedAfterDays: a.snapshot.uptimeSec !== null ? Math.round(a.snapshot.uptimeSec / 86400) : null,
  });
}

export function renderArtifact(p: ArtifactPayload): string {
  const v = (kb: number | null) => (kb === null ? '?' : formatKb(kb));
  const rows = p.categories.map((c) => `<tr><td>${esc(CATEGORY_TITLES[c.category])}</td><td class="num">${c.offered}</td><td class="num">${c.applied}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Android cleanup</title><style>${PAGE_CSS}</style></head><body><main>
<h1>Android cleanup</h1><div class="muted">${esc(CLASS_TITLES[p.deviceClass])} · Android ${esc(p.androidRelease)} · ${esc(p.generated)}</div>
<div class="kpis"><div class="kpi"><span class="muted">RAM in use before</span><b>${esc(v(p.before.ramUsedKb))}</b></div><div class="kpi"><span class="muted">RAM in use after</span><b>${esc(v(p.after?.ramUsedKb ?? null))}</b></div><div class="kpi"><span class="muted">Storage free after</span><b>${esc(v(p.after?.storageFreeKb ?? p.before.storageFreeKb))}</b></div>${p.restartedAfterDays !== null ? `<div class="kpi"><span class="muted">Restarted after</span><b>${p.restartedAfterDays} days</b></div>` : ''}</div>
<table><tr><th>Category</th><th>Offered</th><th>Applied</th></tr>${rows}</table>
<p class="muted">Made with android-cleanup-agent. Contains no app or device names.</p></main></body></html>`;
}
