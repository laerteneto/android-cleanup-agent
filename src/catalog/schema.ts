/**
 * The curated catalog. Only packages listed here are ever offered (plus unused
 * apps the user installed themselves). Everything else on the device is reported
 * and left alone. See CONTRIBUTING.md for how to add an entry.
 */
import { z } from 'zod';
import { Category, DeviceClass, DEVICE_CLASSES, Feature, Power, Risk, SettingNs, Symptom } from '../core/schemas.js';

const Pkg = z.string().regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/);
const Glob = z.string().regex(/^[A-Za-z0-9_.*]+$/);

export const PackageEntry = z
  .object({
    id: Pkg,
    title: z.string().min(3).max(80),
    vendor: z.string().regex(/^[a-z0-9-]+$/),
    category: Category,
    classes: z.array(DeviceClass).default([...DEVICE_CLASSES]),
    risk: Risk,
    riskByClass: z.partialRecord(DeviceClass, Risk).default({}),
    action: z.enum(['uninstall-user', 'disable']),
    /** Not offered when the user says they use any of these. */
    features: z.array(Feature).default([]),
    /** Done alone, then the home screen and the user's main apps are checked; rolled back on failure. */
    homeCheck: z.boolean().default(false),
    notes: z.array(z.string().max(300)).default([]),
    confidence: z.enum(['verified', 'community']),
    /** The kinds of device it was tested on; "verified" counts only there. */
    verifiedOn: z.array(DeviceClass).default([]),
  })
  .strict()
  .refine((e) => e.confidence !== 'verified' || e.verifiedOn.length > 0, { message: 'a verified entry must say which device classes it was verified on (verifiedOn)' });
export type PackageEntry = z.infer<typeof PackageEntry>;

export const Match = z
  .object({
    manufacturer: z.array(Glob).optional(),
    brand: z.array(Glob).optional(),
    packagesAny: z.array(Glob).optional(),
  })
  .strict();
export type Match = z.infer<typeof Match>;

export const PackageFile = z.object({ match: Match.optional(), packages: z.array(PackageEntry) }).strict();
export type PackageFile = z.infer<typeof PackageFile>;

export const SettingEntry = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(3).max(80),
    category: z.enum(['performance', 'background-scanning', 'radios']),
    ns: SettingNs,
    key: z.string().regex(/^[a-z0-9_.]+$/),
    target: z.string().regex(/^[A-Za-z0-9_.:\/-]*$/),
    /** Current values from which the change is offered. Anything else (e.g. a user's custom value) is left alone. */
    from: z.array(z.string()),
    via: z.enum(['settings', 'location', 'bluetooth']),
    classes: z.array(DeviceClass).default([...DEVICE_CLASSES]),
    features: z.array(Feature).default([]),
    /** Offered only when the user reports one of these symptoms; empty = always relevant. */
    symptoms: z.array(Symptom).default([]),
    power: z.array(Power).default(['mains', 'battery', 'mixed']),
    minSdk: z.number().int().default(26),
    risk: Risk,
    notes: z.array(z.string().max(300)).default([]),
  })
  .strict();
export type SettingEntry = z.infer<typeof SettingEntry>;

export const NeverTouchEntry = z.object({ pattern: Glob, reason: z.string().min(5), classes: z.array(DeviceClass).optional() }).strict();
export type NeverTouchEntry = z.infer<typeof NeverTouchEntry>;

export const DeviceRule = z
  .object({
    name: z.string(),
    deviceClass: DeviceClass,
    manufacturer: z.array(Glob).optional(),
    brand: z.array(Glob).optional(),
    platform: z.array(Glob).optional(),
    packagesAny: z.array(Glob).optional(),
  })
  .strict();

export const UserOverlay = z
  .object({
    /** Packages (globs) that are never offered on any device. */
    protect: z.array(Glob).default([]),
    /** Catalog package or setting ids to switch off. */
    disable: z.array(z.string()).default([]),
  })
  .strict();
export type UserOverlay = z.infer<typeof UserOverlay>;
