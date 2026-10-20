/** Terminal and Markdown renderings of an audit, a plan and results. */
import type { Audit, Item, Plan, Results } from '../core/schemas.js';
import { formatBytes, formatDuration, formatKb } from '../core/util.js';
import type { VerifyRow } from '../verify.js';
import { CATEGORY_TITLES, CLASS_TITLES } from './common.js';

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s: string) => c('1', s);
export const dim = (s: string) => c('2', s);
export const green = (s: string) => c('32', s);
export const yellow = (s: string) => c('33', s);
export const red = (s: string) => c('31', s);

const riskColor = (r: string) => (r === 'low' ? green(r) : r === 'medium' ? yellow(r) : red(r));

function pad(s: string, n: number): string {
  // eslint-disable-next-line no-control-regex
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  return s + ' '.repeat(Math.max(0, n - visible.length));
}

export function lastUsedText(i: Pick<Item, 'evidence'>): string {
  const e = i.evidence;
  if (e.current !== undefined) return `now ${e.current}`;
  if (e.lastUsed === undefined || e.totalMs === undefined) return '';
  if (e.lastUsed === null) return 'never opened';
  return `last ${e.lastUsed.slice(0, 10)}, ${formatDuration(e.totalMs ?? 0)} total`;
}

export function renderAudit(a: Audit): string {
  const d = a.device;
  const lines: string[] = [];
  lines.push(bold(`android-cleanup-agent audit: ${a.run_id}`));
  lines.push(`${d.manufacturer} ${d.model} · Android ${d.release} (SDK ${d.sdk}) · ${CLASS_TITLES[d.deviceClass]} ${dim(`(${d.classReason})`)}`);
  const s = a.snapshot;
  if (s.memory) lines.push(`RAM:      ${formatKb(s.memory.usedKb)} used of ${formatKb(s.memory.totalKb)}`);
  if (s.storage) lines.push(`Storage:  ${formatKb(s.storage.freeKb)} free of ${formatKb(s.storage.totalKb)}`);
  if (s.uptimeSec !== null) lines.push(`Running:  ${formatDuration(s.uptimeSec * 1000)} since the last restart`);
  if (a.thermal.maxC !== null) lines.push(`Heat:     ${a.thermal.maxC} °C${a.thermal.status ? red(` (throttling level ${a.thermal.status})`) : ''}`);
  const apps = a.packages.filter((p) => p.installed);
  lines.push(`Apps:     ${apps.length} installed (${apps.filter((p) => !p.system).length} by you), ${apps.filter((p) => !p.enabled).length} turned off`);
  if (a.media.playing) lines.push(yellow(`Playing:  ${a.media.pkgs.join(', ')} (changes that interrupt the screen will wait)`));
  lines.push('');
  lines.push(bold('Biggest memory users'));
  for (const m of a.topMemory.slice(0, 8)) lines.push(`  ${pad(formatKb(m.pssKb), 10)}${m.name}`);
  if (a.wakers.length) {
    lines.push(bold('Wakes the device most often'));
    for (const w of a.wakers.slice(0, 5)) lines.push(`  ${pad(String(w.wakeups), 6)}${w.pkg} ${dim(`(${w.alarms} alarms)`)}`);
  }
  for (const w of a.warnings) lines.push(yellow('! ' + w));
  return lines.join('\n');
}

export function renderPlan(p: Plan): string {
  const lines: string[] = [];
  lines.push(bold(`Plan for ${p.run_id}: ${p.items.length} change(s) offered`));
  const cats = [...new Set(p.items.map((i) => i.category))];
  for (const cat of cats) {
    lines.push('');
    lines.push(bold(CATEGORY_TITLES[cat]));
    for (const i of p.items.filter((x) => x.category === cat)) {
      const flags = [i.recommended ? green('recommended') : '', i.requiresExplicit ? yellow('ask one by one') : '', i.homeCheck ? 'checked alone' : ''].filter(Boolean).join(', ');
      const size = i.evidence.bytes ? formatBytes(i.evidence.bytes) : '';
      lines.push(`  ${dim(i.id)} ${pad(riskColor(i.risk), 8)} ${pad(i.title, 44)} ${pad(size, 9)} ${dim(lastUsedText(i))}${flags ? '  ' + flags : ''}`);
    }
  }
  if (p.excluded.length) {
    lines.push('');
    lines.push(bold('Not offered'));
    for (const e of p.excluded.slice(0, 20)) lines.push(`  ${pad(e.target, 46)} ${dim(e.reason)}`);
  }
  if (p.unknownSystem.length) lines.push('', dim(`${p.unknownSystem.length} other system app(s) are not in the catalog and are left alone.`));
  return lines.join('\n');
}

export function renderResults(r: Results): string {
  const mem = (s: Results['before']) => (s.memory ? formatKb(s.memory.usedKb) : '?');
  const free = (s: Results['before']) => (s.storage ? formatKb(s.storage.freeKb) : '?');
  const lines = [
    bold(`Results for ${r.run_id}`),
    `RAM in use:    ${mem(r.before)} → ${bold(mem(r.after))}`,
    `Storage free:  ${free(r.before)} → ${bold(free(r.after))}`,
    `Changes:       ${r.removed} removed, ${r.disabled} turned off, ${r.settingsChanged} setting(s)${r.cacheFreedKb ? `, ${formatKb(r.cacheFreedKb)} of caches cleared` : ''}`,
  ];
  if (r.skipped || r.failed || r.rolledBack) lines.push(yellow(`Skipped ${r.skipped}, failed ${r.failed}, rolled back ${r.rolledBack} (see the report for reasons)`));
  if (r.restoreScript) lines.push(`Undo:          android-cleanup-agent restore --run ${r.run_id}   ${dim(`(or ${r.restoreScript})`)}`);
  for (const n of r.notRestorable) lines.push(dim('  not restorable by this tool: ' + n));
  return lines.join('\n');
}

export function renderVerify(rows: VerifyRow[]): string {
  if (!rows.length) return 'Nothing from this run is in effect.';
  return rows.map((r) => `${pad(r.status === 'held' ? green('held') : r.status === 'reverted' ? red('reverted') : yellow('changed'), 10)} ${pad(r.target, 46)} ${dim(`expected ${r.expected}, now ${r.now}`)}`).join('\n');
}

export function renderMarkdown(a: Audit, p: Plan | null, r: Results | null): string {
  const d = a.device;
  const out: string[] = [`# Android cleanup: ${d.manufacturer} ${d.model}`, '', `Android ${d.release} · ${CLASS_TITLES[d.deviceClass]} · run \`${a.run_id}\``, ''];
  if (r) {
    out.push('## Results', '', '| | Before | After |', '|---|---|---|');
    out.push(`| RAM in use | ${r.before.memory ? formatKb(r.before.memory.usedKb) : '?'} | ${r.after.memory ? formatKb(r.after.memory.usedKb) : '?'} |`);
    out.push(`| Storage free | ${r.before.storage ? formatKb(r.before.storage.freeKb) : '?'} | ${r.after.storage ? formatKb(r.after.storage.freeKb) : '?'} |`, '');
    out.push(`${r.removed} removed, ${r.disabled} turned off, ${r.settingsChanged} settings changed. Skipped ${r.skipped}, failed ${r.failed}, rolled back ${r.rolledBack}.`, '');
  }
  if (p) {
    out.push('## Plan', '', '| Change | Category | Risk | Usage |', '|---|---|---|---|');
    for (const i of p.items) out.push(`| ${i.title} | ${CATEGORY_TITLES[i.category]} | ${i.risk} | ${lastUsedText(i)} |`);
    out.push('');
  }
  return out.join('\n');
}
