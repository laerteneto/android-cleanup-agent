import type { Category, DeviceClass } from '../core/schemas.js';

export const CATEGORY_TITLES: Record<Category, string> = {
  'google-apps': 'Preinstalled Google apps',
  'media-apps': 'Preinstalled media and streaming apps',
  'oem-apps': 'Manufacturer extras',
  'social-apps': 'Preinstalled social media stubs',
  'assistant-voice': 'Assistant and voice services',
  analytics: 'Analytics and ads services',
  games: 'Game launchers and services',
  'user-apps': 'Apps you installed and no longer use',
  performance: 'Speed settings',
  'background-scanning': 'Background scanning',
  radios: 'Bluetooth and location',
  caches: 'App caches',
};

export const CLASS_TITLES: Record<DeviceClass, string> = {
  phone: 'phone',
  tablet: 'tablet',
  'android-tv': 'Android TV',
  'google-tv': 'Google TV',
  'tablet-tv': 'TV running tablet Android',
};
