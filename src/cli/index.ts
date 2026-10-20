/**
 * android-cleanup-agent CLI. Every command works without Claude; the plugin skills
 * call the same commands and read their --json output.
 *
 * Exit codes: 0 ok · 1 error · 2 bad usage · 3 no device / not authorized ·
 * 4 needs a human confirmation that was not given · 5 device mismatch or dropped
 * (resumable) · 6 device not supported.
 */
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { parse } from 'yaml';
import { applyPlan, FingerprintMismatchError } from '../apply.js';
import { isApproved, verifyApprovals } from '../approvals.js';
import { runAudit } from '../audit.js';
import { catalogDir, loadCatalog, loadUserOverlay, userOverlayPath } from '../catalog/loader.js';
import { PackageFile } from '../catalog/schema.js';
import { adbVersion, connect, listDevices, mdnsServices, NoDeviceError, pair, resolveDevice, stateGuidance, versionAtLeast } from '../connect.js';
import { Answers, CATEGORIES, DEVICE_CLASSES, type DeviceClass, FEATURES, Power, SYMPTOMS } from '../core/schemas.js';

import { BusyError, clearAppData, rebootDevice } from '../device-actions.js';
import { UnsupportedDeviceError } from '../device.js';
import { buildPlan } from '../plan.js';
import { DeviceDroppedError } from '../platform/adb.js';
import { findAdb, RealAdb } from '../platform/adb-real.js';
import { buildArtifactPayload, renderArtifact } from '../report/artifact.js';
import { renderHtml } from '../report/html.js';
import { auditSummary, planSummary } from '../report/summary.js';
import { bold, dim, green, red, renderAudit, renderMarkdown, renderPlan, renderResults, renderVerify, yellow } from '../report/text.js';
import { executeRestore, pendingRestore, renderRestoreScript } from '../restore.js';
import { computeResults, inEffect } from '../results.js';
import { configDir, RunStore, stateRoot } from '../runs.js';
import { verifyRun } from '../verify.js';

const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
})();

class ExitError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

let adbInstance: RealAdb | null = null;
function adb(): RealAdb {
  if (adbInstance) return adbInstance;
  const bin = findAdb();
  if (!bin) throw new ExitError('adb not found. Install Android platform-tools (https://developer.android.com/tools/releases/platform-tools) or add it to PATH.', 3);
  adbInstance = new RealAdb(bin);
  return adbInstance;
}
const store = () => new RunStore(stateRoot());

function resolveRun(run: string | undefined): string {
  const id = run && run !== 'latest' ? run : store().latest();
  if (!id) throw new ExitError('no audit yet: run `android-cleanup-agent audit` first', 2);
  return id;
}

function print(json: boolean, data: unknown, text: () => string): void {
  process.stdout.write((json ? JSON.stringify(data, null, 2) : text()) + '\n');
}

function listOption(value: string | undefined, allowed: readonly string[], what: string): string[] {
  if (!value) return [];
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const i of items) if (!allowed.includes(i)) throw new ExitError(`unknown ${what} "${i}" (one of: ${allowed.join(', ')})`, 2);
  return items;
}

function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

async function device(serial: string | undefined, fingerprint?: string) {
  return resolveDevice(adb(), { ...(serial ? { serial } : {}), ...(fingerprint ? { fingerprint } : {}) });
}

const program = new Command();
program
  .name('android-cleanup-agent')
  .description('Clean up and speed up an Android phone, tablet or TV over adb: audit → plan → approve → apply → results.')
  .version(VERSION)
  .showHelpAfterError();

program
  .command('doctor')
  .description('Check adb, wireless-debugging discovery and connected devices')
  .option('--json', 'machine-readable output')
  .action(async (o: { json?: boolean }) => {
    const bin = findAdb();
    const version = bin ? await adbVersion(adb()) : null;
    const devices = bin ? await listDevices(adb()) : [];
    const mdns = bin ? await mdnsServices(adb()).catch(() => []) : [];
    const data = { contract_version: 1, adb: bin, adbVersion: version, adbOk: versionAtLeast(version), devices, wirelessDebugging: mdns.map((m) => ({ type: m.type, host: m.host, port: m.port })), stateDir: stateRoot() };
    print(Boolean(o.json), data, () =>
      [
        bold('android-cleanup-agent doctor'),
        `adb:      ${bin ? `${bin} (${version ?? 'unknown version'})` : red('not found: install Android platform-tools')}`,
        bin && !versionAtLeast(version) ? yellow('          platform-tools 30 or newer is needed for wireless pairing') : '',
        `Devices:  ${devices.length ? devices.map((d) => `${d.serial} ${d.state === 'device' ? green(d.state) : yellow(d.state)}`).join(', ') : 'none connected'}`,
        ...devices.filter((d) => d.state !== 'device').map((d) => '          ' + stateGuidance(d)),
        `Wireless debugging on the network: ${mdns.length ? mdns.map((m) => `${m.host}:${m.port} (${m.type})`).join(', ') : 'none seen'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  });

program
  .command('devices')
  .description('List connected devices')
  .option('--json', 'machine-readable output')
  .action(async (o: { json?: boolean }) => {
    const devices = await listDevices(adb());
    print(Boolean(o.json), devices, () => (devices.length ? devices.map((d) => `${d.serial}  ${d.state}  ${d.model ?? ''}  ${d.transport}`).join('\n') : 'No devices connected.'));
  });

program
  .command('pair')
  .description('Pair with a device over Wi-Fi (Wireless debugging → Pair device with pairing code)')
  .requiredOption('--host <ip>', 'the device IP address')
  .requiredOption('--code <digits>', 'the 6-digit pairing code shown on the device')
  .option('--port <port>', 'pairing port (found automatically when omitted)', Number)
  .action(async (o: { host: string; code: string; port?: number }) => {
    const r = await pair(adb(), o.host, o.code, o.port);
    if (!r.ok) throw new ExitError(r.message, 3);
    process.stdout.write(r.message + '\n');
  });

program
  .command('connect')
  .description('Connect to a device over Wi-Fi (the port is found automatically)')
  .requiredOption('--host <ip>', 'the device IP address')
  .option('--port <port>', 'connect port', Number)
  .option('--json', 'machine-readable output')
  .action(async (o: { host: string; port?: number; json?: boolean }) => {
    const r = await connect(adb(), o.host, o.port);
    if (!r.serial) throw new ExitError(r.message, 3);
    print(Boolean(o.json), r, () => r.message);
  });

program
  .command('audit')
  .description('Read-only look at the device: apps, usage, memory, storage, background activity, settings')
  .option('--serial <serial>', 'device to audit when several are connected')
  .option('--class <class>', `override the detected device class (${DEVICE_CLASSES.join(', ')})`)
  .option('--summary', 'print the compact JSON summary the plugin reads')
  .option('--json', 'print the full audit JSON')
  .action(async (o: { serial?: string; class?: string; summary?: boolean; json?: boolean }) => {
    if (o.class && !DEVICE_CLASSES.includes(o.class as DeviceClass)) throw new ExitError(`unknown class "${o.class}"`, 2);
    const d = await device(o.serial);
    const catalog = loadCatalog();
    if (!o.json && !o.summary) process.stderr.write(dim(`Auditing ${d.serial} (read-only)…\n`));
    const audit = await runAudit(adb(), { serial: d.serial, transport: d.transport === 'usb' ? 'usb' : 'wifi', catalog, ...(o.class ? { deviceClass: o.class as DeviceClass } : {}) });
    store().saveAudit(audit);
    if (o.summary) print(true, auditSummary(audit), () => '');
    else print(Boolean(o.json), audit, () => renderAudit(audit) + '\n\n' + dim(`Next: android-cleanup-agent plan --run ${audit.run_id} --uses … --symptoms …`));
  });

program
  .command('plan')
  .description('Build the list of offered changes from the audit, the catalog and how the device is used')
  .option('--run <id>', 'run id (default: latest)')
  .option('--answers <file>', 'YAML/JSON file with uses, power, symptoms, keep')
  .option('--uses <list>', `features the user uses (${FEATURES.join(', ')})`)
  .option('--power <power>', 'mains, battery or mixed')
  .option('--symptoms <list>', `what feels wrong (${SYMPTOMS.join(', ')})`)
  .option('--keep <list>', 'package names of the main apps to protect and health-check')
  .option('--summary', 'print the compact JSON summary the plugin reads')
  .option('--json', 'print the full plan JSON')
  .action(async (o: { run?: string; answers?: string; uses?: string; power?: string; symptoms?: string; keep?: string; summary?: boolean; json?: boolean }) => {
    const runId = resolveRun(o.run);
    const s = store();
    const { audit, sha } = s.loadAudit(runId);
    const fromFile = o.answers ? (parse(readFileSync(o.answers, 'utf8')) as unknown) : {};
    const answers = Answers.parse({
      ...(fromFile as object),
      ...(o.uses !== undefined ? { uses: listOption(o.uses, FEATURES, 'feature') } : {}),
      ...(o.power !== undefined ? { power: Power.parse(o.power) } : {}),
      ...(o.symptoms !== undefined ? { symptoms: listOption(o.symptoms, SYMPTOMS, 'symptom') } : {}),
      ...(o.keep !== undefined ? { keep: o.keep.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
    });
    const plan = buildPlan({ audit, auditSha: sha, catalog: loadCatalog(), overlay: loadUserOverlay(configDir()), answers, now: new Date() });
    s.savePlan(plan);
    if (o.summary) print(true, planSummary(plan), () => '');
    else print(Boolean(o.json), plan, () => renderPlan(plan) + '\n\n' + dim(`Next: android-cleanup-agent approvals init --run ${runId}`));
  });

const approvals = program.command('approvals').description('Record which changes are approved (all start off)');

approvals
  .command('init')
  .option('--run <id>', 'run id (default: latest)')
  .action((o: { run?: string }) => {
    const s = store();
    const { plan, sha } = s.loadPlan(resolveRun(o.run));
    process.stdout.write(`Approvals template: ${s.initApprovals(plan, sha)}\n`);
  });

approvals
  .command('set')
  .description('Approve or reject categories and items')
  .option('--run <id>', 'run id (default: latest)')
  .option('--category <cat=bool>', 'e.g. google-apps=true (repeatable)', collect)
  .option('--item <id=bool>', 'e.g. i_0123456789ab=false (repeatable)', collect)
  .option('--json', 'machine-readable output')
  .action((o: { run?: string; category?: string[]; item?: string[]; json?: boolean }) => {
    const s = store();
    const runId = resolveRun(o.run);
    const { plan, sha } = s.loadPlan(runId);
    if (!s.hasApprovals(runId)) s.initApprovals(plan, sha);
    const a = s.loadApprovals(runId);
    if (a.plan_sha256 !== sha) throw new ExitError('the plan changed after approvals were started; run `approvals init` again', 1);
    const kv = (v: string) => {
      const m = v.match(/^([a-z0-9_-]+)=(true|false)$/);
      if (!m) throw new ExitError(`expected name=true|false, got "${v}"`, 2);
      return [m[1] as string, m[2] === 'true'] as const;
    };
    for (const c of o.category ?? []) {
      const [k, v] = kv(c);
      if (!(CATEGORIES as readonly string[]).includes(k)) throw new ExitError(`unknown category "${k}"`, 2);
      a.categories[k] = v;
    }
    for (const i of o.item ?? []) {
      const [k, v] = kv(i);
      if (!plan.items.some((x) => x.id === k)) throw new ExitError(`no item ${k} in this plan`, 2);
      a.items[k] = v;
    }
    s.saveApprovals(a);
    const approved = plan.items.filter((i) => isApproved(i, a));
    print(Boolean(o.json), { approved: approved.map((i) => i.id) }, () => `${approved.length} change(s) approved.`);
  });

approvals
  .command('veto')
  .description('Reject one item (used by the risk judge)')
  .requiredOption('--item <id>', 'item id')
  .option('--run <id>', 'run id (default: latest)')
  .option('--reason <text>', 'why')
  .action((o: { item: string; run?: string; reason?: string }) => {
    const s = store();
    const runId = resolveRun(o.run);
    const { plan } = s.loadPlan(runId);
    if (!plan.items.some((x) => x.id === o.item)) throw new ExitError(`no item ${o.item} in this plan`, 2);
    const a = s.loadApprovals(runId);
    a.items[o.item] = false;
    s.saveApprovals(a);
    process.stdout.write(`Vetoed ${o.item}${o.reason ? `: ${o.reason.slice(0, 200)}` : ''}\n`);
  });

approvals
  .command('show')
  .option('--run <id>', 'run id (default: latest)')
  .option('--json', 'machine-readable output')
  .action((o: { run?: string; json?: boolean }) => {
    const s = store();
    const runId = resolveRun(o.run);
    const { plan } = s.loadPlan(runId);
    const a = s.loadApprovals(runId);
    const approved = plan.items.filter((i) => isApproved(i, a));
    print(Boolean(o.json), { run_id: runId, approved: approved.map((i) => ({ id: i.id, title: i.title, category: i.category, risk: i.risk, action: i.action.type, homeCheck: i.homeCheck, notes: i.notes })) }, () =>
      approved.length ? approved.map((i) => `${i.id}  [${i.risk}] ${i.title}`).join('\n') : 'Nothing approved yet.',
    );
  });

program
  .command('apply')
  .description('Make the approved changes (dry run unless --yes)')
  .option('--run <id>', 'run id (default: latest)')
  .option('--serial <serial>', 'device serial when several are connected')
  .option('--yes', 'really make the changes')
  .option('--resume', 'continue an interrupted run')
  .option('--json', 'machine-readable output')
  .action(async (o: { run?: string; serial?: string; yes?: boolean; resume?: boolean; json?: boolean }) => {
    const s = store();
    const runId = resolveRun(o.run);
    const { audit } = s.loadAudit(runId);
    const { plan, sha } = s.loadPlan(runId);
    const a = s.loadApprovals(runId);
    verifyApprovals(plan, sha, a, audit.created_at, new Date());
    const approved = plan.items.filter((i) => isApproved(i, a));
    if (!o.yes) {
      print(Boolean(o.json), { dryRun: true, items: approved.map((i) => ({ id: i.id, title: i.title, action: i.action.type, homeCheck: i.homeCheck })) }, () =>
        [bold(`Dry run: ${approved.length} change(s) would be made`), ...approved.map((i) => `  ${i.id}  ${i.action.type.padEnd(14)} ${i.title}${i.homeCheck ? dim('  (alone, then health check)') : ''}`), '', dim(`Run again with --yes to apply.`)].join('\n'),
      );
      return;
    }
    if (!approved.length) throw new ExitError('nothing is approved', 2);
    const d = await device(o.serial, plan.fingerprint);
    const results = await applyPlan({
      adb: adb(),
      store: s,
      serial: d.serial,
      audit,
      plan,
      planSha: sha,
      approvals: a,
      catalog: loadCatalog(),
      overlay: loadUserOverlay(configDir()),
      resume: Boolean(o.resume),
      onEntry: (e, item) => {
        if (o.json) return;
        const mark = e.status === 'ok' ? green('ok') : e.status === 'skipped' ? yellow('skip') : red('fail');
        process.stderr.write(`  ${mark.padEnd(4)} ${e.op.padEnd(9)} ${item?.title ?? e.target ?? ''}${e.reason ? dim(` (${e.reason})`) : ''}\n`);
      },
    });
    print(Boolean(o.json), results, () => renderResults(results));
  });

program
  .command('clear-data')
  .description('Clear ONE app\'s data and logins. Cannot be undone.')
  .requiredOption('--package <name>', 'the package to clear')
  .requiredOption('--confirm-package <name>', 'type the package name again to confirm')
  .option('--run <id>', 'run id (default: latest)')
  .option('--serial <serial>', 'device serial')
  .option('--yes', 'really clear it')
  .action(async (o: { package: string; confirmPackage: string; run?: string; serial?: string; yes?: boolean }) => {
    if (o.confirmPackage !== o.package) throw new ExitError('--confirm-package does not match --package', 4);
    if (!o.yes) throw new ExitError(`This permanently deletes ${o.package}'s data, logins and settings on the device. Run again with --yes.`, 4);
    const s = store();
    const runId = resolveRun(o.run);
    const { audit } = s.loadAudit(runId);
    const d = await device(o.serial, audit.device.fingerprint);
    const e = await clearAppData(adb(), s, d.serial, audit, loadCatalog(), loadUserOverlay(configDir()), o.package);
    if (e.status !== 'ok') throw new ExitError(`could not clear ${o.package}: ${e.reason ?? 'refused'}`, 1);
    process.stdout.write(`Cleared ${o.package}. It starts fresh next time it opens (sign in again).\n`);
  });

program
  .command('reboot')
  .description('Restart the device (refused while something is playing)')
  .option('--run <id>', 'run id to log the restart in (default: latest)')
  .option('--serial <serial>', 'device serial')
  .option('--yes', 'really restart')
  .option('--force-while-playing', 'restart even if media is playing')
  .action(async (o: { run?: string; serial?: string; yes?: boolean; forceWhilePlaying?: boolean }) => {
    const s = store();
    const runId = o.run || s.latest() ? resolveRun(o.run) : null;
    const fp = runId ? s.loadAudit(runId).audit.device.fingerprint : undefined;
    const d = await device(o.serial, fp);
    if (!o.yes) throw new ExitError(`This restarts ${d.serial}. Wireless debugging switches off afterwards. Run again with --yes.`, 4);
    await rebootDevice(adb(), d.serial, { force: Boolean(o.forceWhilePlaying), store: s, ...(runId ? { runId } : {}) });
    process.stdout.write(`Restarting ${d.serial}. Wireless debugging will be off afterwards: turn it on, then run \`android-cleanup-agent connect --host <ip>\` and \`verify\`.\n`);
  });

program
  .command('verify')
  .description('Check that this run\'s changes are still in place (e.g. after a restart or a system update)')
  .option('--run <id>', 'run id (default: latest)')
  .option('--serial <serial>', 'device serial')
  .option('--json', 'machine-readable output')
  .action(async (o: { run?: string; serial?: string; json?: boolean }) => {
    const s = store();
    const runId = resolveRun(o.run);
    const { audit } = s.loadAudit(runId);
    const d = await device(o.serial, audit.device.fingerprint);
    const rows = await verifyRun(adb(), d.serial, audit, s.readManifest(runId));
    print(Boolean(o.json), { run_id: runId, rows }, () => renderVerify(rows));
  });

program
  .command('restore')
  .description('Undo this run\'s changes, newest first (dry run unless --yes)')
  .option('--run <id>', 'run id (default: latest)')
  .option('--serial <serial>', 'device serial')
  .option('--item <id>', 'restore only this item (repeatable)', collect)
  .option('--yes', 'really restore')
  .option('--json', 'machine-readable output')
  .action(async (o: { run?: string; serial?: string; item?: string[]; yes?: boolean; json?: boolean }) => {
    const s = store();
    const runId = resolveRun(o.run);
    const { audit } = s.loadAudit(runId);
    const entries = s.readManifest(runId);
    const steps = pendingRestore(entries, o.item?.length ? new Set(o.item) : undefined);
    s.writeFile(runId, 'restore.sh', renderRestoreScript(audit, pendingRestore(entries)), 0o700);
    const notRestorable = inEffect(entries).filter((e) => e.restore === 'store-reinstall').map((e) => e.target);
    if (!o.yes) {
      print(Boolean(o.json), { dryRun: true, steps, notRestorable }, () =>
        [bold(`Dry run: ${steps.length} step(s) would be undone`), ...steps.map((st) => `  ${st.kind.padEnd(17)} ${st.target}${st.value !== undefined ? ` → ${st.value}` : ''}`), ...notRestorable.map((t) => dim(`  ${t}: reinstall from the Play Store`)), '', dim('Run again with --yes to restore.')].join('\n'),
      );
      return;
    }
    const d = await device(o.serial, audit.device.fingerprint);
    const done = await executeRestore(adb(), s, d.serial, audit, steps, (e) => {
      if (!o.json) process.stderr.write(`  ${e.status === 'ok' ? green('ok') : red('fail')} ${e.target}${e.reason ? dim(` (${e.reason})`) : ''}\n`);
    });
    const failed = done.filter((e) => e.status !== 'ok').length;
    print(Boolean(o.json), { restored: done.length - failed, failed, notRestorable }, () => `Restored ${done.length - failed} of ${done.length}.${failed ? red(` ${failed} failed.`) : ''}`);
  });

program
  .command('results')
  .description('Before/after numbers for a run (re-measured on the device)')
  .option('--run <id>', 'run id (default: latest)')
  .option('--serial <serial>', 'device serial')
  .option('--json', 'machine-readable output')
  .action(async (o: { run?: string; serial?: string; json?: boolean }) => {
    const s = store();
    const runId = resolveRun(o.run);
    const { audit } = s.loadAudit(runId);
    let results = s.loadResults(runId);
    try {
      const d = await device(o.serial, audit.device.fingerprint);
      results = await computeResults(adb(), s, d.serial, audit);
    } catch (e) {
      if (!results) throw e;
      if (!o.json) process.stderr.write(dim('Device not connected: showing the numbers saved at the end of apply.\n'));
    }
    print(Boolean(o.json), results, () => renderResults(results!));
  });

program
  .command('report')
  .description('Write the run report')
  .option('--run <id>', 'run id (default: latest)')
  .option('--format <list>', 'terminal,md,html,json,artifact', 'terminal')
  .action((o: { run?: string; format: string }) => {
    const s = store();
    const runId = resolveRun(o.run);
    const { audit } = s.loadAudit(runId);
    const plan = s.hasPlan(runId) ? s.loadPlan(runId).plan : null;
    const results = s.loadResults(runId);
    const manifest = s.readManifest(runId);
    for (const f of listOption(o.format, ['terminal', 'md', 'html', 'json', 'artifact'], 'format')) {
      if (f === 'terminal') process.stdout.write(renderAudit(audit) + (plan ? '\n\n' + renderPlan(plan) : '') + (results ? '\n\n' + renderResults(results) : '') + '\n');
      if (f === 'md') process.stdout.write(`Markdown: ${s.writeFile(runId, 'report.md', renderMarkdown(audit, plan, results))}\n`);
      if (f === 'html') process.stdout.write(`HTML: ${s.writeFile(runId, 'report.html', renderHtml(audit, plan, results, manifest))}\n`);
      if (f === 'json') process.stdout.write(`JSON: ${s.writeFile(runId, 'report.json', JSON.stringify({ audit: auditSummary(audit), plan: plan ? planSummary(plan) : null, results }, null, 2))}\n`);
      if (f === 'artifact') {
        const applied = new Set(inEffect(manifest).map((e) => e.itemId).filter((x): x is string => Boolean(x)));
        process.stdout.write(`Artifact: ${s.writeFile(runId, 'artifact.html', renderArtifact(buildArtifactPayload(audit, plan, results, applied)))}\n`);
      }
    }
  });

program
  .command('runs')
  .description('List runs')
  .option('--json', 'machine-readable output')
  .action((o: { json?: boolean }) => {
    const s = store();
    const rows = s.list().map((id) => {
      try {
        const { audit } = s.loadAudit(id);
        const r = s.loadResults(id);
        return { run_id: id, device: `${audit.device.manufacturer} ${audit.device.model}`, applied: r?.applied ?? 0 };
      } catch {
        return { run_id: id, device: '?', applied: 0 };
      }
    });
    print(Boolean(o.json), rows, () => (rows.length ? rows.map((r) => `${r.run_id}  ${r.device}  ${r.applied} change(s)`).join('\n') : 'No runs yet.'));
  });

const catalog = program.command('catalog').description('The curated package catalog');
catalog
  .command('list')
  .option('--json', 'machine-readable output')
  .action((o: { json?: boolean }) => {
    const c = loadCatalog();
    print(Boolean(o.json), { packages: c.packages.map((p) => ({ id: p.id, title: p.title, vendor: p.vendor, category: p.category, risk: p.risk, confidence: p.confidence })), settings: c.settings.map((x) => x.id) }, () =>
      [...c.packages.map((p) => `${p.id.padEnd(48)} ${p.risk.padEnd(7)} ${p.confidence.padEnd(10)} ${p.title}`), '', `${c.packages.length} packages, ${c.settings.length} settings, ${c.neverTouch.length} never-touch rules (${catalogDir()})`].join('\n'),
    );
  });
catalog
  .command('validate [file]')
  .description('Validate the built-in catalog, your overlay, or a package file')
  .action((file?: string) => {
    if (file) {
      PackageFile.parse(parse(readFileSync(file, 'utf8')));
      process.stdout.write(`${file}: valid\n`);
      return;
    }
    const c = loadCatalog();
    loadUserOverlay(configDir());
    process.stdout.write(`catalog: valid (${c.packages.length} packages). Overlay: ${userOverlayPath(configDir())}\n`);
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  const code = e instanceof ExitError ? e.code : e instanceof NoDeviceError ? 3 : e instanceof UnsupportedDeviceError ? 6 : e instanceof DeviceDroppedError || e instanceof FingerprintMismatchError ? 5 : e instanceof BusyError ? 4 : 1;
  process.stderr.write(red('android-cleanup-agent: ') + (e instanceof Error ? e.message : String(e)) + '\n');
  process.exit(code);
});

