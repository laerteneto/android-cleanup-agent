/**
 * Run storage. Runs live outside the working directory, in the per-user state
 * folder, so device inventories (package lists, model, usage) never land inside a
 * git repository.
 *
 *   macOS: ~/Library/Application Support/android-cleanup-agent/runs/<run_id>/
 *   Linux: ${XDG_STATE_HOME:-~/.local/state}/android-cleanup-agent/runs/<run_id>/
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { Approvals, Audit, CONTRACT_VERSION, ManifestEntry, Plan, Results } from './core/schemas.js';
import { RUN_ID, sha256 } from './core/util.js';
import { CATEGORY_TITLES } from './report/common.js';

export function stateRoot(env: NodeJS.ProcessEnv = process.env, home = homedir(), platform = process.platform): string {
  if (env.ACA_STATE_DIR) return env.ACA_STATE_DIR;
  if (platform === 'darwin') return join(home, 'Library/Application Support/android-cleanup-agent');
  return join(env.XDG_STATE_HOME || join(home, '.local/state'), 'android-cleanup-agent');
}

export function configDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'android-cleanup-agent');
}

function loadVersioned<T>(path: string, schema: { parse: (v: unknown) => T }, what: string): { value: T; sha: string } {
  const raw = readFileSync(path);
  const json = JSON.parse(raw.toString('utf8')) as { contract_version?: unknown };
  if (json.contract_version !== CONTRACT_VERSION) {
    throw new Error(`${what} uses contract version ${String(json.contract_version)}; this CLI speaks ${CONTRACT_VERSION}. Audit again.`);
  }
  return { value: schema.parse(json), sha: sha256(raw) };
}

export class RunStore {
  constructor(readonly root: string) {}

  get runsDir(): string {
    return join(this.root, 'runs');
  }

  dir(runId: string): string {
    if (!RUN_ID.test(runId)) throw new Error(`invalid run id "${runId}"`);
    return join(this.runsDir, runId);
  }

  private writeJson(runId: string, name: string, value: unknown): string {
    const dir = this.dir(runId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    return path;
  }

  saveAudit(a: Audit): string {
    return this.writeJson(a.run_id, 'audit.json', Audit.parse(a));
  }

  loadAudit(runId: string): { audit: Audit; sha: string } {
    const { value, sha } = loadVersioned(join(this.dir(runId), 'audit.json'), Audit, `run ${runId}`);
    return { audit: value, sha };
  }

  savePlan(p: Plan): string {
    return this.writeJson(p.run_id, 'plan.json', Plan.parse(p));
  }

  hasPlan(runId: string): boolean {
    return existsSync(join(this.dir(runId), 'plan.json'));
  }

  loadPlan(runId: string): { plan: Plan; sha: string } {
    const path = join(this.dir(runId), 'plan.json');
    if (!existsSync(path)) throw new Error(`no plan for ${runId}: run \`android-cleanup-agent plan --run ${runId}\` first`);
    const { value, sha } = loadVersioned(path, Plan, `plan ${runId}`);
    return { plan: value, sha };
  }

  latest(): string | null {
    return this.list().filter((n) => existsSync(join(this.runsDir, n, 'audit.json'))).at(-1) ?? null;
  }

  list(): string[] {
    if (!existsSync(this.runsDir)) return [];
    return readdirSync(this.runsDir).filter((n) => RUN_ID.test(n)).sort();
  }

  approvalsPath(runId: string): string {
    return join(this.dir(runId), 'approvals.yaml');
  }

  /** Writes an approvals template with every decision off, annotated for hand editing. */
  initApprovals(plan: Plan, sha: string): string {
    const path = this.approvalsPath(plan.run_id);
    const categories = [...new Set(plan.items.map((i) => i.category))];
    const header = [
      `# Approvals for ${plan.run_id}. Set a category or an item to true to approve it.`,
      '# An item set to false overrides its category. Items marked (explicit) are never',
      '# covered by a category and must be approved one by one. Nothing changes until',
      `#   android-cleanup-agent apply --run ${plan.run_id} --yes`,
      '#',
      ...categories.map((c) => `#   category ${c}: ${CATEGORY_TITLES[c]}`),
      '#',
      ...plan.items.filter((i) => i.action.type !== 'report-only').map((i) => `#   ${i.id}  [${i.risk}]${i.requiresExplicit ? ' (explicit)' : ''} ${i.category}  ${i.title}`),
      '',
    ].join('\n');
    const body: Approvals = {
      contract_version: CONTRACT_VERSION,
      run_id: plan.run_id,
      plan_sha256: sha,
      categories: Object.fromEntries(categories.map((c) => [c, false])),
      items: {},
    };
    writeFileSync(path, header + stringify(body), { mode: 0o600 });
    return path;
  }

  hasApprovals(runId: string): boolean {
    return existsSync(this.approvalsPath(runId));
  }

  loadApprovals(runId: string): Approvals {
    const path = this.approvalsPath(runId);
    if (!existsSync(path)) throw new Error(`no approvals for ${runId}: run \`android-cleanup-agent approvals init --run ${runId}\``);
    return Approvals.parse(parse(readFileSync(path, 'utf8')));
  }

  saveApprovals(a: Approvals): void {
    writeFileSync(this.approvalsPath(a.run_id), stringify(Approvals.parse(a)), { mode: 0o600 });
  }

  manifestPath(runId: string): string {
    return join(this.dir(runId), 'manifest.jsonl');
  }

  /** Append + fsync per entry, so an interrupted run still has an exact record of every change. */
  appendManifest(runId: string, entry: ManifestEntry): void {
    mkdirSync(this.dir(runId), { recursive: true, mode: 0o700 });
    const fd = openSync(this.manifestPath(runId), 'a', 0o600);
    try {
      appendFileSync(fd, JSON.stringify(ManifestEntry.parse(entry)) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  readManifest(runId: string): ManifestEntry[] {
    const path = this.manifestPath(runId);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => ManifestEntry.parse(JSON.parse(l)));
  }

  saveResults(r: Results): void {
    this.writeJson(r.run_id, 'results.json', Results.parse(r));
  }

  loadResults(runId: string): Results | null {
    const path = join(this.dir(runId), 'results.json');
    return existsSync(path) ? Results.parse(JSON.parse(readFileSync(path, 'utf8'))) : null;
  }

  writeFile(runId: string, name: string, content: string, mode = 0o600): string {
    if (!/^[a-z0-9.-]+$/.test(name)) throw new Error('invalid output file name');
    mkdirSync(this.dir(runId), { recursive: true, mode: 0o700 });
    const path = join(this.dir(runId), name);
    writeFileSync(path, content, { mode });
    return path;
  }

  lockPath(): string {
    return join(this.root, '.lock');
  }

  /** One mutating run at a time. The plugin's hooks also deny raw adb changes while this exists. */
  acquireLock(): () => void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = this.lockPath();
    if (existsSync(path)) {
      const pid = Number(readFileSync(path, 'utf8').trim());
      let alive = false;
      try {
        if (pid > 0) {
          process.kill(pid, 0);
          alive = true;
        }
      } catch {
        alive = false;
      }
      if (alive) throw new Error(`another android-cleanup-agent run is in progress (pid ${pid})`);
      unlinkSync(path);
    }
    const fd = openSync(path, 'wx', 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try {
        unlinkSync(path);
      } catch {
        /* already gone */
      }
    };
    // Node does not emit 'exit' when killed by an unhandled signal, so a Ctrl-C mid-apply
    // would leave the lock behind (and the plugin's hook would block every adb change).
    const onSignal = (sig: NodeJS.Signals) => {
      release();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    };
    process.once('exit', release);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    process.once('SIGHUP', onSignal);
    return () => {
      release();
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGHUP', onSignal);
    };
  }
}
