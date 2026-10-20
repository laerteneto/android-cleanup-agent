/**
 * The last word on what may be changed. Checked when the plan is built and again,
 * against live role holders, right before every change.
 */
import type { NeverTouchEntry } from '../catalog/schema.js';
import type { Device, Roles } from '../core/schemas.js';
import { globMatch } from '../device.js';

/** Roles whose holder must keep working. The assistant role is deliberately absent: switching the assistant off is a valid choice. */
const ROLE_NAMES: Array<[keyof Roles, string]> = [
  ['home', 'the home screen in use'],
  ['ime', 'the keyboard in use'],
  ['dialer', 'the phone app in use'],
  ['sms', 'the messaging app in use'],
  ['webview', 'the WebView provider in use'],
  ['deviceOwner', 'the device administrator'],
];

export interface ProtectionInput {
  neverTouch: NeverTouchEntry[];
  roles: Roles;
  deviceClass: Device['deviceClass'];
  userProtect: string[];
  keep: string[];
}

export function protectedReason(pkg: string, input: ProtectionInput): string | null {
  for (const [role, label] of ROLE_NAMES) {
    if (input.roles[role] === pkg) return `it is ${label}`;
  }
  if (input.roles.accessibility.includes(pkg)) return 'it provides an accessibility service that is switched on';
  for (const n of input.neverTouch) {
    if ((!n.classes || n.classes.includes(input.deviceClass)) && globMatch(n.pattern, pkg)) return n.reason;
  }
  if (input.userProtect.some((g) => globMatch(g, pkg))) return 'protected in your catalog.yaml';
  if (input.keep.includes(pkg)) return 'you said you use it';
  return null;
}
