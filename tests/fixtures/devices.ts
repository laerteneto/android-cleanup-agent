/**
 * Synthetic devices. The tablet-TV is modelled on a portable touchscreen TV that
 * runs tablet Android (the first device this tool was used on); every identifier
 * is made up and IPs use the 192.0.2.0/24 documentation range.
 */
import type { FakePackage, FakeSpec } from '../fake-adb.js';

const sys = (pkg: string, extra: Partial<FakePackage> = {}): FakePackage => ({ pkg, system: true, launcher: '.Main', ...extra });
const user = (pkg: string, extra: Partial<FakePackage> = {}): FakePackage => ({ pkg, system: false, installer: 'com.android.vending', launcher: '.Main', ...extra });
const MB = 1_000_000;

const CORE: FakePackage[] = [
  sys('android', { launcher: undefined }),
  sys('com.android.systemui', { launcher: undefined, pssKb: 108_917 }),
  sys('com.android.settings', { launcher: '.Settings' }),
  sys('com.android.shell', { launcher: undefined }),
  sys('com.google.android.gms', { launcher: undefined, pssKb: 250_272, alarms: { alarms: 412, wakeups: 79 } }),
  sys('com.google.android.gsf', { launcher: undefined }),
  sys('com.android.vending', { launcher: '.AssetBrowserActivity', pssKb: 103_293 }),
  sys('com.google.android.webview', { launcher: undefined }),
  sys('com.google.android.inputmethod.latin', { launcher: undefined, pssKb: 161_290 }),
  sys('com.google.android.permissioncontroller', { launcher: undefined }),
  sys('com.android.providers.media', { launcher: undefined }),
];

export function tabletTv(): FakeSpec {
  return {
    serial: '192.0.2.10:37001',
    androidId: 'c0ffee00decaf001',
    props: {
      'ro.product.model': 'Demo Go',
      'ro.product.brand': 'Demo',
      'ro.product.manufacturer': 'DemoKTC',
      'ro.board.platform': 'rk3576',
      'ro.build.version.sdk': '34',
      'ro.build.version.release': '14',
      'ro.build.fingerprint': 'Demo/Demo_Go/Demo_Go:14/AU2501/AU04:user/release-keys',
      'ro.build.characteristics': 'tablet',
    },
    features: ['android.hardware.touchscreen', 'android.hardware.camera', 'android.hardware.wifi'],
    home: 'com.android.launcher3/com.android.searchlauncher.SearchLauncher',
    ime: 'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME',
    battery: { present: true, ac: false },
    dataKb: { total: 54_117_456, used: 10_381_472 },
    memKb: { total: 8_045_076, used: 2_736_455 },
    packages: [
      ...CORE,
      sys('com.android.launcher3', { launcher: undefined, pssKb: 68_530, usage: { total: '1:40:17', last: '2026-10-19 18:15:06', launches: 364 } }),
      sys('com.kgzn.dropdownmenu', { launcher: '.typeccast.SignalLoadingActivity', pssKb: 34_607 }),
      sys('com.kgzn.ota', { launcher: undefined }),
      sys('com.kgzn.castscreen', { launcher: undefined, pssKb: 30_711 }),
      sys('com.google.android.youtube', { pssKb: 174_410, size: { app: 229 * MB, data: 898 * MB, cache: 876 * MB }, usage: { total: '313:46:55', last: '2026-10-19 10:10:54', launches: 223 } }),
      sys('com.netflix.mediaclient', { size: { app: 300 * MB, data: 1200 * MB, cache: 139 * MB }, usage: { total: '79:37:57', last: '2026-09-17 09:27:05', launches: 155 } }),
      sys('com.android.chrome', { size: { app: 500 * MB, data: 100 * MB, cache: 301 * MB }, usage: { total: '3:25:38', last: '2026-10-04 18:21:26', launches: 20 } }),
      sys('com.amazon.avod.thirdpartyclient', { pssKb: 116_446, size: { app: 98 * MB, data: 0, cache: 0 } }),
      sys('com.google.android.calendar', { pssKb: 99_586, alarms: { alarms: 206, wakeups: 64 }, size: { app: 85 * MB, data: 1 * MB, cache: 2 * MB } }),
      sys('com.google.android.gm', { size: { app: 250 * MB, data: 4 * MB, cache: 3 * MB } }),
      sys('com.google.android.apps.photos', { alarms: { alarms: 50, wakeups: 0 } }),
      sys('com.google.android.apps.maps'),
      sys('com.google.android.apps.youtube.music', { usage: { total: '36:55', last: '2026-05-21 16:50:27', launches: 10 } }),
      sys('com.android.camera2', { usage: { total: '00:24', last: '2026-05-17 20:03:06', launches: 10 } }),
      sys('com.google.android.googlequicksearchbox', { launcher: undefined, pssKb: 268_395, usage: { total: '08:20', last: '2026-08-08 17:43:54', launches: 63 } }),
      sys('com.google.android.tts', { launcher: undefined, pssKb: 109_534 }),
      sys('com.google.android.apps.wellbeing', { launcher: undefined, pssKb: 45_569 }),
      sys('com.google.android.deskclock'),
      user('com.vodafone.demo.tv', { usage: { total: '1:59:30', last: '2026-06-29 18:36:04', launches: 21 } }),
      user('com.google.android.verifier', { launcher: undefined }),
      user('com.example.oldgame', { usage: { total: '00:30', last: '2026-01-02 10:00:00', launches: 2 }, size: { app: 120 * MB, data: 40 * MB, cache: 5 * MB } }),
    ],
    settings: {
      global: { window_animation_scale: '1.0', transition_animation_scale: '1.0', animator_duration_scale: '0.5', wifi_scan_always_enabled: '1', ble_scan_always_enabled: '1', bluetooth_on: '1' },
      secure: { location_mode: '3' },
      system: { screen_off_timeout: '60000' },
    },
  };
}

export function phone(): FakeSpec {
  return {
    serial: 'DEMO0PHONE01',
    androidId: 'aa11bb22cc33dd44',
    props: {
      'ro.product.model': 'Demo Phone',
      'ro.product.brand': 'samsung',
      'ro.product.manufacturer': 'samsung',
      'ro.board.platform': 'demo',
      'ro.build.version.sdk': '34',
      'ro.build.version.release': '14',
      'ro.build.fingerprint': 'samsung/demo/demo:14/UP1A/1:user/release-keys',
      'ro.build.characteristics': 'phone',
    },
    features: ['android.hardware.touchscreen', 'android.hardware.telephony', 'android.hardware.camera'],
    home: 'com.sec.android.app.launcher/com.android.launcher3.uioverrides.QuickstepLauncher',
    ime: 'com.samsung.android.honeyboard/.service.HoneyBoardService',
    battery: { present: true, ac: false },
    packages: [
      ...CORE,
      sys('com.sec.android.app.launcher', { launcher: undefined }),
      sys('com.samsung.android.honeyboard', { launcher: undefined }),
      sys('com.android.phone', { launcher: undefined }),
      sys('com.samsung.android.bixby.agent', { launcher: undefined, pssKb: 80_000 }),
      sys('com.samsung.android.game.gamehome'),
      sys('com.samsung.android.knox.containercore', { launcher: undefined }),
      sys('com.facebook.appmanager', { launcher: undefined }),
      sys('com.google.android.gm', { usage: { total: '20:00:00', last: '2026-10-18 09:00:00', launches: 400 } }),
      sys('com.google.android.calendar'),
      sys('com.google.android.deskclock'),
      user('com.whatsapp', { usage: { total: '90:00:00', last: '2026-10-19 08:00:00', launches: 2000 } }),
    ],
    settings: {
      global: { window_animation_scale: '1.0', transition_animation_scale: '1.0', animator_duration_scale: '1.0', wifi_scan_always_enabled: '1', ble_scan_always_enabled: '0', bluetooth_on: '1' },
      secure: { location_mode: '3' },
      system: { screen_off_timeout: '30000' },
    },
  };
}

export function googleTv(): FakeSpec {
  return {
    serial: '192.0.2.20:5555',
    androidId: '0123456789abcdef',
    props: {
      'ro.product.model': 'Demo Streamer',
      'ro.product.brand': 'demo',
      'ro.product.manufacturer': 'Demo',
      'ro.board.platform': 'demo',
      'ro.build.version.sdk': '33',
      'ro.build.version.release': '13',
      'ro.build.fingerprint': 'demo/streamer:13/TP1A/1:user/release-keys',
      'ro.build.characteristics': 'tv',
    },
    features: ['android.software.leanback', 'android.software.leanback_only'],
    home: 'com.google.android.apps.tv.launcherx/.home.HomeActivity',
    battery: { present: false, ac: false },
    packages: [
      ...CORE,
      sys('com.google.android.apps.tv.launcherx', { launcher: undefined }),
      sys('com.google.android.katniss', { launcher: undefined }),
      sys('com.google.android.youtube.tvmusic'),
      sys('com.google.android.apps.mediashell', { launcher: undefined }),
      sys('com.google.android.youtube.tv', { usage: { total: '200:00:00', last: '2026-10-19 20:00:00', launches: 300 } }),
    ],
    settings: {
      global: { window_animation_scale: '1.0', transition_animation_scale: '1.0', animator_duration_scale: '1.0', wifi_scan_always_enabled: '1', bluetooth_on: '1' },
      secure: { location_mode: '0' },
      system: { screen_off_timeout: '1800000' },
    },
  };
}

export function fireTv(): FakeSpec {
  const s = googleTv();
  s.props['ro.product.manufacturer'] = 'Amazon';
  return s;
}
