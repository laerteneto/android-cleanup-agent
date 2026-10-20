import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../src/catalog/loader.js';
import { assertHost } from '../../src/connect.js';
import { DEVICE_CLASSES } from '../../src/core/schemas.js';
import { classify, globMatch, UnsupportedDeviceError } from '../../src/device.js';
import { assertPkg, assertSafeArgv, assertSettingValue } from '../../src/platform/argv.js';
import { RealAdb } from '../../src/platform/adb-real.js';
import { protectedReason } from '../../src/safety/never-touch.js';

describe('device shell tokens', () => {
  it.each([['pm', 'list', 'packages; rm -rf /'], ['settings', 'put', 'global', 'x', "$(reboot)"], ['echo', 'a b'], ['x', '`id`'], ['a', "'"], ['a', 'b|c'], ['a', 'b&c'], ['a', 'b>c'], ['a', '\n']])('refuses %j', (...argv) => {
    expect(() => assertSafeArgv(argv)).toThrow(/unsafe/);
  });
  it('refuses an empty command (interactive shell)', () => expect(() => assertSafeArgv([])).toThrow(/interactive/));
  it('allows normal commands', () => expect(() => assertSafeArgv(['pm', 'uninstall', '-k', '--user', '0', 'com.a.b'])).not.toThrow());
  it('validates packages and values', () => {
    expect(() => assertPkg('com.a.b')).not.toThrow();
    expect(() => assertPkg('com.a;b')).toThrow();
    expect(() => assertPkg('android')).toThrow();
    expect(() => assertSettingValue('0.5')).not.toThrow();
    expect(() => assertSettingValue('1 2')).toThrow();
  });
  it('the real runner validates before running anything', async () => {
    const adb = new RealAdb('/nonexistent/adb');
    expect(() => adb.shell('x', ['rm', '-rf', '/sdcard; reboot'])).toThrow(/unsafe/);
    expect(() => adb.host(['-s', 'x', 'shell', 'id'])).toThrow(/never runs a device shell/);
  });
  it('validates hosts', () => {
    expect(assertHost('192.0.2.10')).toBe('192.0.2.10');
    expect(() => assertHost('192.0.2.10;ls')).toThrow();
  });
});

describe('device class', () => {
  const base = { features: new Set<string>(), homePkg: null, packages: new Set<string>(), onMains: false };
  it('Fire TV is refused', () => expect(() => classify({ ...base, props: { 'ro.product.manufacturer': 'Amazon' } }, [])).toThrow(UnsupportedDeviceError));
  it('leanback → TV, launcherx → Google TV', () => {
    expect(classify({ ...base, props: {}, features: new Set(['android.software.leanback']) }, []).deviceClass).toBe('android-tv');
    expect(classify({ ...base, props: {}, features: new Set(['android.software.leanback']), homePkg: 'com.google.android.apps.tv.launcherx' }, []).deviceClass).toBe('google-tv');
  });
  it('known device rules, telephony, tablet on mains', () => {
    expect(classify({ ...base, props: {}, packages: new Set(['com.kgzn.ota']) }, [{ name: 'KTC', deviceClass: 'tablet-tv', packagesAny: ['com.kgzn.*'] }]).deviceClass).toBe('tablet-tv');
    expect(classify({ ...base, props: {}, features: new Set(['android.hardware.telephony']) }, []).deviceClass).toBe('phone');
    expect(classify({ ...base, props: { 'ro.build.characteristics': 'tablet' }, onMains: true }, []).deviceClass).toBe('tablet-tv');
    expect(classify({ ...base, props: { 'ro.build.characteristics': 'tablet' } }, []).deviceClass).toBe('tablet');
  });
  it('globs', () => {
    expect(globMatch('com.google.android.gms*', 'com.google.android.gms.policy')).toBe(true);
    expect(globMatch('*setupwizard*', 'com.google.android.setupwizard')).toBe(true);
    expect(globMatch('com.a.b', 'com.a.bc')).toBe(false);
    expect(globMatch('com.a.b', 'COM.A.B')).toBe(true);
  });
});

describe('catalog', () => {
  const catalog = loadCatalog();
  it('loads with no duplicates and no overlap with never-touch', () => {
    expect(catalog.packages.length).toBeGreaterThan(40);
    expect(new Set(catalog.packages.map((p) => p.id)).size).toBe(catalog.packages.length);
  });
  it('core system packages are protected on every class', () => {
    const roles = { home: null, ime: null, dialer: null, sms: null, assistant: null, webview: null, accessibility: [], deviceOwner: null };
    for (const deviceClass of DEVICE_CLASSES) {
      for (const pkg of ['android', 'com.android.systemui', 'com.google.android.gms', 'com.android.vending', 'com.android.settings', 'com.google.android.permissioncontroller', 'com.android.providers.media', 'com.android.phone', 'com.google.android.setupwizard', 'com.samsung.android.knox.containercore', 'com.miui.securitycenter']) {
        expect(protectedReason(pkg, { neverTouch: catalog.neverTouch, roles, deviceClass, userProtect: [], keep: [] }), `${pkg} on ${deviceClass}`).not.toBeNull();
      }
    }
  });
  it('live role holders are protected; the assistant is not', () => {
    const roles = { home: 'com.x.launcher', ime: 'com.x.kbd', dialer: null, sms: null, assistant: 'com.google.android.googlequicksearchbox', webview: null, accessibility: ['com.x.reader'], deviceOwner: null };
    const p = (pkg: string) => protectedReason(pkg, { neverTouch: [], roles, deviceClass: 'phone', userProtect: ['com.mine.*'], keep: ['com.keep.me'] });
    expect(p('com.x.launcher')).toMatch(/home screen/);
    expect(p('com.x.kbd')).toMatch(/keyboard/);
    expect(p('com.x.reader')).toMatch(/accessibility/);
    expect(p('com.mine.app')).toMatch(/catalog.yaml/);
    expect(p('com.keep.me')).toMatch(/use it/);
    expect(p('com.google.android.googlequicksearchbox')).toBeNull();
  });
  it('high-risk entries are checked alone; Bluetooth is never offered on TVs', () => {
    for (const p of catalog.packages.filter((x) => x.risk === 'high')) expect(p.homeCheck, p.id).toBe(true);
    const bt = catalog.settings.find((s) => s.id === 'bluetooth-off');
    expect(bt?.classes).not.toContain('android-tv');
    expect(bt?.classes).not.toContain('google-tv');
  });
});
