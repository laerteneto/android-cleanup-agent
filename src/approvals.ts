import type { Approvals, Item, Plan } from './core/schemas.js';

export const DEFAULT_MAX_AGE_HOURS = 24;

export function isApproved(item: Item, a: Approvals): boolean {
  if (item.action.type === 'report-only' || item.action.type === 'clear-data') return false;
  const explicit = a.items[item.id];
  if (explicit !== undefined) return explicit;
  // User-installed apps and high-risk changes never ride on a category approval.
  if (item.requiresExplicit) return false;
  return a.categories[item.category] ?? false;
}

export function verifyApprovals(plan: Plan, planSha: string, approvals: Approvals, auditCreatedAt: string, now: Date, maxAgeHours = DEFAULT_MAX_AGE_HOURS): void {
  if (approvals.run_id !== plan.run_id) throw new Error('approvals belong to a different run');
  if (approvals.plan_sha256 !== planSha) throw new Error('plan.json changed after the approvals were made (hash mismatch). Plan again and re-approve.');
  const age = (now.getTime() - Date.parse(auditCreatedAt)) / 3_600_000;
  if (age > maxAgeHours) throw new Error(`the audit is ${age.toFixed(1)} h old (limit ${maxAgeHours} h). Audit again so the plan matches the device.`);
  if (age < -0.1) throw new Error('audit timestamp is in the future');
  for (const id of Object.keys(approvals.items)) {
    if (!plan.items.some((i) => i.id === id)) throw new Error(`approvals mention ${id}, which is not in the plan`);
  }
}

export function selectApproved(plan: Plan, approvals: Approvals): Item[] {
  return plan.items.filter((i) => isApproved(i, approvals));
}
