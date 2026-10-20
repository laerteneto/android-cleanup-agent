/**
 * The contract between the CLI, the Claude Code plugin skills and the tests.
 *
 * Every JSON document the CLI writes carries `contract_version`. Skills pin the
 * value in references/output-contract.md and abort on a mismatch, because a
 * globally installed CLI on PATH can shadow the plugin's own `bin/` shim.
 *
 * Design rule: Claude never sends raw adb commands, only plan item ids. Each item
 * is bound to the device fingerprint and to the exact package or setting state
 * seen at audit time; approvals reference ids; `apply` takes no package names.
 */
import { z } from 'zod';

export const CONTRACT_VERSION = 1;

export const DEVICE_CLASSES = ['phone', 'tablet', 'android-tv', 'google-tv', 'tablet-tv'] as const;
export const DeviceClass = z.enum(DEVICE_CLASSES);
export type DeviceClass = z.infer<typeof DeviceClass>;

/** Approval categories. A category is always one of these ids, never device-provided text. */
export const CATEGORIES = [
  'google-apps',
  'media-apps',
  'oem-apps',
  'social-apps',
  'assistant-voice',
  'analytics',
  'games',
  'user-apps',
  'performance',
  'background-scanning',
  'radios',
  'caches',
] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

/** Features a user can say they use. Catalog entries and settings tied to a used feature are never offered. */
export const FEATURES = ['bluetooth', 'cast', 'location', 'voice', 'typing', 'camera', 'calls', 'sms', 'alarms', 'screensaver', 'accessibility', 'email', 'photos'] as const;
export const Feature = z.enum(FEATURES);
export type Feature = z.infer<typeof Feature>;

export const SYMPTOMS = ['slow-menus', 'slow-apps', 'storage', 'battery', 'heat', 'video-stutter'] as const;
export const Symptom = z.enum(SYMPTOMS);
export type Symptom = z.infer<typeof Symptom>;

export const Power = z.enum(['mains', 'battery', 'mixed']);
export type Power = z.infer<typeof Power>;

/**
 * low:    unused preload, trivially restorable, no known side effects.
 * medium: side effects possible (a feature disappears) or only community-verified.
 * high:   may affect the home screen, voice or system flows; done alone with a health check.
 */
export const Risk = z.enum(['low', 'medium', 'high']);
export type Risk = z.infer<typeof Risk>;

export const SettingNs = z.enum(['global', 'secure', 'system']);
export type SettingNs = z.infer<typeof SettingNs>;

/** How a setting is changed. `cmd-*`/`svc-*` go through the system service so the radio state really changes. */
export const SettingVia = z.enum(['settings', 'cmd-location', 'cmd-bluetooth', 'svc-bluetooth']);
export type SettingVia = z.infer<typeof SettingVia>;

const Pkg = z.string().regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/).max(200);
/** What the device lists: also single-segment names such as the framework package "android". */
const AnyPkg = z.string().regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/).max(200);
const SettingKey = z.string().regex(/^[a-z0-9_.]+$/).max(100);
const SettingValue = z.string().regex(/^[A-Za-z0-9_.:\/-]*$/).max(200);

export const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('uninstall-user'), keepData: z.boolean() }).strict(),
  z.object({ type: z.literal('disable') }).strict(),
  z.object({ type: z.literal('setting'), ns: SettingNs, key: SettingKey, value: SettingValue, via: SettingVia }).strict(),
  z.object({ type: z.literal('trim-caches') }).strict(),
  z.object({ type: z.literal('clear-data') }).strict(),
  z.object({ type: z.literal('report-only') }).strict(),
]);
export type Action = z.infer<typeof Action>;

/** State an approval is bound to. Re-read right before acting; any difference skips the item. */
export const Identity = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('package'),
      pkg: Pkg,
      versionCode: z.number().int().nullable(),
      lastUpdateTime: z.string().max(40).nullable(),
      enabled: z.boolean(),
      installed: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('setting'), ns: SettingNs, key: SettingKey, value: z.string().max(200) }).strict(),
  z.object({ kind: z.literal('device') }).strict(),
]);
export type Identity = z.infer<typeof Identity>;

export const RestoreKind = z.enum(['install-existing', 'enable', 'setting', 'store-reinstall', 'none']);
export type RestoreKind = z.infer<typeof RestoreKind>;

export const Roles = z
  .object({
    home: z.string().nullable(),
    ime: z.string().nullable(),
    dialer: z.string().nullable(),
    sms: z.string().nullable(),
    assistant: z.string().nullable(),
    webview: z.string().nullable(),
    accessibility: z.array(z.string()),
    deviceOwner: z.string().nullable(),
  })
  .strict();
export type Roles = z.infer<typeof Roles>;

export const Capabilities = z
  .object({
    installExisting: z.boolean(),
    cmdLocation: z.boolean(),
    cmdBluetooth: z.boolean(),
    svcBluetooth: z.boolean(),
    cmdRole: z.boolean(),
    mediaSession: z.boolean(),
  })
  .strict();
export type Capabilities = z.infer<typeof Capabilities>;

export const Device = z
  .object({
    /** sha256 of android_id + manufacturer + model, truncated. Survives OTA updates, changes on factory reset. */
    fingerprint: z.string().regex(/^[a-f0-9]{16}$/),
    /** Display only. Over Wi-Fi this is ip:port and changes on every connect. */
    serial: z.string(),
    transport: z.enum(['usb', 'wifi']),
    model: z.string(),
    brand: z.string(),
    manufacturer: z.string(),
    platform: z.string(),
    sdk: z.number().int(),
    release: z.string(),
    buildFingerprint: z.string(),
    characteristics: z.array(z.string()),
    features: z.object({ leanback: z.boolean(), touchscreen: z.boolean(), telephony: z.boolean() }).strict(),
    deviceClass: DeviceClass,
    classReason: z.string(),
    currentUser: z.number().int().min(0),
    otherUsers: z.array(z.number().int()),
    roles: Roles,
    capabilities: Capabilities,
  })
  .strict();
export type Device = z.infer<typeof Device>;

export const Usage = z.object({ totalMs: z.number(), lastUsed: z.string().nullable(), launches: z.number().int() }).strict();
export type Usage = z.infer<typeof Usage>;

export const AuditPackage = z
  .object({
    pkg: AnyPkg,
    system: z.boolean(),
    enabled: z.boolean(),
    installed: z.boolean(),
    installer: z.string().nullable(),
    versionCode: z.number().int().nullable(),
    lastUpdateTime: z.string().nullable(),
    usage: Usage.nullable(),
    size: z.object({ app: z.number(), data: z.number(), cache: z.number() }).strict().nullable(),
    pssKb: z.number().nullable(),
    alarms: z.number().int().nullable(),
  })
  .strict();
export type AuditPackage = z.infer<typeof AuditPackage>;

export const Snapshot = z
  .object({
    at: z.string(),
    memory: z.object({ totalKb: z.number(), freeKb: z.number(), usedKb: z.number() }).strict().nullable(),
    storage: z.object({ totalKb: z.number(), usedKb: z.number(), freeKb: z.number() }).strict().nullable(),
    uptimeSec: z.number().nullable(),
  })
  .strict();
export type Snapshot = z.infer<typeof Snapshot>;

export const Audit = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    run_id: z.string(),
    created_at: z.string(),
    device: Device,
    snapshot: Snapshot,
    usageWindow: z.object({ from: z.string(), to: z.string() }).strict().nullable(),
    packages: z.array(AuditPackage),
    /** "ns.key" → value exactly as `settings get` printed it; "null" means unset. */
    settings: z.record(z.string(), z.string()),
    topMemory: z.array(z.object({ name: z.string(), pssKb: z.number() }).strict()),
    topCpu: z.array(z.object({ name: z.string(), pct: z.number() }).strict()),
    thermal: z.object({ status: z.number().int().nullable(), maxC: z.number().nullable() }).strict(),
    wakers: z.array(z.object({ pkg: z.string(), alarms: z.number().int(), wakeups: z.number().int() }).strict()),
    media: z.object({ playing: z.boolean(), pkgs: z.array(z.string()) }).strict(),
    foreground: z.string().nullable(),
    warnings: z.array(z.string()),
  })
  .strict();
export type Audit = z.infer<typeof Audit>;

export const Answers = z
  .object({
    uses: z.array(Feature).default([]),
    power: Power.default('mixed'),
    symptoms: z.array(Symptom).default([]),
    /** The user's main apps: never offered, and launched as a health check after risky changes. */
    keep: z.array(Pkg).default([]),
  })
  .strict();
export type Answers = z.infer<typeof Answers>;

export const Evidence = z
  .object({
    lastUsed: z.string().nullable().optional(),
    totalMs: z.number().nullable().optional(),
    launches: z.number().int().nullable().optional(),
    bytes: z.number().nullable().optional(),
    pssKb: z.number().nullable().optional(),
    alarms: z.number().int().nullable().optional(),
    current: z.string().optional(),
  })
  .strict();
export type Evidence = z.infer<typeof Evidence>;

export const Item = z
  .object({
    id: z.string().regex(/^i_[a-f0-9]{12}$/),
    catalogId: z.string().nullable(),
    category: Category,
    /** From the catalog, never from the device (app labels are attacker-controlled). */
    title: z.string(),
    pkg: Pkg.optional(),
    risk: Risk,
    action: Action,
    identity: Identity,
    evidence: Evidence,
    restore: RestoreKind,
    /** Never covered by a category approval: user-installed apps, high risk, data loss. */
    requiresExplicit: z.boolean(),
    recommended: z.boolean(),
    /** Done on its own, followed by a home-screen and keep-apps health check, rolled back on failure. */
    homeCheck: z.boolean(),
    notes: z.array(z.string()),
  })
  .strict();
export type Item = z.infer<typeof Item>;

export const Plan = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    run_id: z.string(),
    created_at: z.string(),
    audit_sha256: z.string(),
    fingerprint: z.string(),
    answers: Answers,
    items: z.array(Item),
    excluded: z.array(z.object({ target: z.string(), reason: z.string() }).strict()),
    /** System packages the catalog does not know. Reported, never offered. */
    unknownSystem: z.array(z.string()),
  })
  .strict();
export type Plan = z.infer<typeof Plan>;

export const Approvals = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    run_id: z.string(),
    plan_sha256: z.string(),
    categories: z.record(z.string(), z.boolean()),
    items: z.record(z.string(), z.boolean()),
  })
  .strict();
export type Approvals = z.infer<typeof Approvals>;

export const ManifestOp = z.enum(['apply', 'rollback', 'transient', 'transient-restore', 'skip', 'health', 'restore', 'clear-data', 'reboot']);
export type ManifestOp = z.infer<typeof ManifestOp>;

export const ManifestEntry = z
  .object({
    at: z.string(),
    op: ManifestOp,
    status: z.enum(['ok', 'failed', 'skipped']),
    itemId: z.string().optional(),
    /** Package name or "ns.key". */
    target: z.string().optional(),
    action: z.string().optional(),
    /** Exact state before and after: "enabled" | "disabled" | "absent" for packages, the raw value for settings. */
    before: z.string().optional(),
    after: z.string().optional(),
    restore: RestoreKind.optional(),
    via: SettingVia.optional(),
    reason: z.string().optional(),
    kb: z.number().optional(),
  })
  .strict();
export type ManifestEntry = z.infer<typeof ManifestEntry>;

export const Results = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    run_id: z.string(),
    before: Snapshot,
    after: Snapshot,
    applied: z.number().int(),
    removed: z.number().int(),
    disabled: z.number().int(),
    settingsChanged: z.number().int(),
    cacheFreedKb: z.number(),
    skipped: z.number().int(),
    failed: z.number().int(),
    rolledBack: z.number().int(),
    restoreScript: z.string().nullable(),
    notRestorable: z.array(z.string()),
    /** Health checks opened the main apps just before "after" was measured, so RAM reads high for a few minutes. */
    appsOpened: z.boolean().default(false),
  })
  .strict();
export type Results = z.infer<typeof Results>;
