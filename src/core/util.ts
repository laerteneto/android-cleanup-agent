import { createHash, randomBytes } from 'node:crypto';

/** Stable opaque id for a plan item: same device + target → same id within a run. */
export function itemId(fingerprint: string, kind: string, key: string, salt: string): string {
  return 'i_' + createHash('sha256').update(`${salt}\0${fingerprint}\0${kind}\0${key}`).digest('hex').slice(0, 12);
}

export function newRunId(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `run_${stamp}_${randomBytes(3).toString('hex')}`;
}

export const RUN_ID = /^run_[0-9]{8}T[0-9]{6}_[a-f0-9]{6}$/;

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Decimal units, like Android's own Settings → Storage: 1 GB = 1,000,000,000 bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = -1;
  do {
    v /= 1000;
    u++;
  } while (v >= 1000 && u < units.length - 1);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
}

/** dumpsys and df report KiB. */
export function formatKb(kb: number): string {
  return formatBytes(kb * 1024);
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.round(h / 24)} days`;
}

/** Strips control and bidi characters from device-provided text before it is shown. Still untrusted. */
export function displayText(s: string, max = 120): string {
  let t = s.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '?');
  if (t.length > max) t = t.slice(0, max - 1) + '…';
  return t;
}

export function daysBetween(fromIso: string, to: Date): number {
  return (to.getTime() - Date.parse(fromIso)) / 86_400_000;
}

const STORES: Record<string, string> = {
  'com.android.vending': 'the Play Store',
  'com.sec.android.app.samsungapps': 'the Galaxy Store',
  'com.xiaomi.mipicks': 'GetApps',
  'com.huawei.appmarket': 'AppGallery',
};

/** Where an app came from, for "reinstall it from …". Carrier and unknown installers fall back to the Play Store. */
export function storeName(installer: string | null | undefined): string {
  return (installer && STORES[installer]) ?? 'the Play Store';
}
