---
title: Debloat a Xiaomi / Redmi phone with adb (no root)
description: Remove MIUI and HyperOS bloatware such as MIUI Analytics, system ads, GetApps, Mi Browser and Mi Video over adb without root, while Security center, Find Device and the updater are never touched. Every change can be undone.
device: Xiaomi, Redmi and POCO phones (MIUI and HyperOS)
date: 2026-10-20
steps:
  - name: Enable developer options
    text: Open Settings, About phone and tap MIUI version (or OS version on HyperOS) seven times.
  - name: Turn on debugging
    text: In Settings, Additional settings, Developer options, turn on USB debugging, or Wireless debugging and Pair device with pairing code.
  - name: Connect and audit
    text: Connect over USB or with pair and connect, accept the Allow debugging prompt, then run android-cleanup-agent audit --summary. Nothing changes.
  - name: Plan with your answers
    text: Tell the plan which features you use and your main apps, so related entries are not offered and your apps are health-checked.
  - name: Approve and apply
    text: Approve by category (analytics, manufacturer apps, media apps, games), then run apply and apply --yes.
  - name: Check and undo if needed
    text: Run results to compare before and after, verify after a MIUI or HyperOS update, and restore to bring anything back.
---

<div class="note">

**Catalog status:** the Xiaomi entries in this guide are **community-verified**. They come from community debloat lists and have not yet been tested on a real Xiaomi, Redmi or POCO device by the author. The safeguards (role protection, health checks, automatic rollback, restore) apply to them like to every other entry. Reports from real devices are welcome on GitHub.

</div>

Xiaomi phones are known for system ads and a second set of apps next to Google's. Some of them are safe to remove for your user; a few are not, and removing them is a well-known way to make MIUI boot-loop. The tool only offers the first kind.

## What is never touched on Xiaomi

These are on the never-touch list and are never offered, whatever an overlay or catalog entry says:

| Package | Why |
| --- | --- |
| `com.miui.securitycenter` (Security) | Xiaomi security and permissions; removing it can boot-loop MIUI |
| `com.xiaomi.finddevice` (Find Device) | Find Device and anti-theft |
| `com.miui.updater` | System updates |

On top of that, your launcher, keyboard, dialer, SMS app, WebView and accessibility services are protected live, right before every change, and unknown MIUI system packages are only listed in the audit, never offered.

## What the Xiaomi catalog can offer

| Item | Category | Risk |
| --- | --- | --- |
| MIUI Analytics | Analytics | Low |
| MIUI System Ads (`com.miui.msa.global`) | Analytics | Medium |
| GetApps (Xiaomi app store) | Manufacturer apps | Low |
| Mi Browser | Manufacturer apps | Low |
| Mi Video | Media apps | Low |
| Mi Music | Media apps | Low |
| Xiaomi Games | Games | Low |
| Yellow Pages | Manufacturer apps | Low |
| MIUI Feedback | Manufacturer apps | Low |

All of these are removed for your user with `pm uninstall -k --user`, which keeps their data and leaves the system image untouched. Unused Google apps and preinstalled third-party apps (for example Facebook services) can be offered too if the catalog lists them and you have not used them in the last 60 days.

## Run it

```
android-cleanup-agent devices
android-cleanup-agent audit --summary
android-cleanup-agent plan --uses calls,sms,camera,location,photos --power battery --symptoms battery,slow-apps
android-cleanup-agent approvals init
android-cleanup-agent approvals show
android-cleanup-agent approvals set --category analytics=true --category oem-apps=true --category media-apps=true
android-cleanup-agent apply
android-cleanup-agent apply --yes
android-cleanup-agent results
```

The answers are examples; use your own. If the device refuses a change, the item is reported as failed and the rest of the run continues.

## Undo and updates

`android-cleanup-agent restore --yes` brings removed preinstalled apps back with `cmd package install-existing`, newest first. Apps that came from GetApps or the Play Store are not in the system image; removing one deletes it and only a store reinstall brings it back (its data is kept). MIUI and HyperOS updates can reinstall removed apps; run `android-cleanup-agent verify` after an update to see what came back. A factory reset brings all preinstalled apps back.
