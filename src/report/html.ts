/**
 * Self-contained HTML report: one offline file, no scripts, no external requests
 * (CSP default-src 'none'), noindex. Every value is escaped; package names and
 * process names come from the device and are therefore untrusted.
 */
import type { Audit, ManifestEntry, Plan, Results } from '../core/schemas.js';
import { formatBytes, formatKb } from '../core/util.js';
import { CATEGORY_TITLES, CLASS_TITLES } from './common.js';
import { lastUsedText } from './text.js';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

export const PAGE_CSS = `
:root{--bg:#fbfbfd;--fg:#1d1d1f;--muted:#6e6e73;--card:#fff;--line:#e5e5ea;--accent:#1a8f5a;--low:#1f9d55;--medium:#b7791f;--high:#c53030;--bar:#1a8f5a22}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111114;--fg:#f5f5f7;--muted:#a1a1a6;--card:#1c1c1f;--line:#2c2c30;--accent:#3ddc84;--low:#48bb78;--medium:#ecc94b;--high:#fc8181;--bar:#3ddc8433}}
:root[data-theme="dark"]{--bg:#111114;--fg:#f5f5f7;--muted:#a1a1a6;--card:#1c1c1f;--line:#2c2c30;--accent:#3ddc84;--low:#48bb78;--medium:#ecc94b;--high:#fc8181;--bar:#3ddc8433}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 10px}
.muted{color:var(--muted)}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}.kpi b{display:block;font-size:24px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.risk{font-weight:600}.risk.low{color:var(--low)}.risk.medium{color:var(--medium)}.risk.high{color:var(--high)}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.warn{border-left:3px solid var(--medium);padding:6px 12px;background:var(--card);margin:8px 0}
.wrap{word-break:break-all}`;

const kpi = (label: string, value: string) => `<div class="kpi"><span class="muted">${esc(label)}</span><b>${esc(value)}</b></div>`;

export function renderHtml(a: Audit, plan: Plan | null, results: Results | null, manifest: ManifestEntry[] = []): string {
  const d = a.device;
  const s = a.snapshot;
  const resultsBlock = results
    ? `<h2>Results</h2><div class="kpis">${kpi('RAM in use before', results.before.memory ? formatKb(results.before.memory.usedKb) : '?')}${kpi('RAM in use after', results.after.memory ? formatKb(results.after.memory.usedKb) : '?')}${kpi('Storage free after', results.after.storage ? formatKb(results.after.storage.freeKb) : '?')}${kpi('Changes', `${results.applied}`)}</div>
${results.notRestorable.length ? `<div class="warn">Not restorable by this tool: ${results.notRestorable.map(esc).join('; ')}</div>` : ''}`
    : '';
  const planBlock = plan
    ? `<h2>Plan</h2><table><tr><th>Change</th><th>Category</th><th>Risk</th><th>Evidence</th></tr>${plan.items
        .map(
          (i) =>
            `<tr><td>${esc(i.title)}<br><code>${esc(i.id)}${i.pkg ? ' · ' + esc(i.pkg) : ''}</code>${i.notes.map((n) => `<div class="muted">${esc(n)}</div>`).join('')}</td><td>${esc(CATEGORY_TITLES[i.category])}</td><td class="risk ${i.risk}">${i.risk}</td><td>${esc(lastUsedText(i))}${i.evidence.bytes ? '<br>' + esc(formatBytes(i.evidence.bytes)) : ''}${i.evidence.pssKb ? '<br>' + esc(formatKb(i.evidence.pssKb)) + ' RAM' : ''}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const log = manifest.length
    ? `<h2>What was done</h2><table><tr><th>When</th><th>Step</th><th>Target</th><th>Outcome</th></tr>${manifest
        .map((e) => `<tr><td class="num">${esc(e.at.slice(11, 19))}</td><td>${esc(e.op)}${e.action ? ' · ' + esc(e.action) : ''}</td><td class="wrap">${esc(e.target ?? '')}</td><td>${esc(e.status)}${e.reason ? ' · ' + esc(e.reason) : ''}</td></tr>`)
        .join('')}</table>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="robots" content="noindex,nofollow">
<title>Android cleanup report</title><style>${PAGE_CSS}</style></head><body><main>
<h1>${esc(d.manufacturer)} ${esc(d.model)}</h1><div class="muted">Android ${esc(d.release)} · ${esc(CLASS_TITLES[d.deviceClass])} · ${esc(a.run_id)}</div>
<div class="kpis">${kpi('RAM in use', s.memory ? `${formatKb(s.memory.usedKb)} of ${formatKb(s.memory.totalKb)}` : '?')}${kpi('Storage free', s.storage ? formatKb(s.storage.freeKb) : '?')}${kpi('Since restart', s.uptimeSec !== null ? `${Math.round(s.uptimeSec / 86400)} days` : '?')}${kpi('Hottest sensor', a.thermal.maxC !== null ? `${a.thermal.maxC} °C` : '?')}</div>
${a.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
${resultsBlock}
${planBlock}
<h2>Biggest memory users</h2><table>${a.topMemory.map((m) => `<tr><td class="wrap">${esc(m.name)}</td><td class="num">${esc(formatKb(m.pssKb))}</td></tr>`).join('')}</table>
${a.wakers.length ? `<h2>Wakes the device most often</h2><table><tr><th>App</th><th>Wakeups</th><th>Alarms</th></tr>${a.wakers.map((w) => `<tr><td class="wrap">${esc(w.pkg)}</td><td class="num">${w.wakeups}</td><td class="num">${w.alarms}</td></tr>`).join('')}</table>` : ''}
${log}
<p class="muted">Generated locally by android-cleanup-agent. Nothing in this report left your computer.</p>
</main></body></html>`;
}
