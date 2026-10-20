---
title: Debloat a Samsung phone safely with adb (no root)
description: Remove or turn off Samsung bloatware such as Bixby, Game Launcher, AR Emoji and Samsung Free over adb without root, keeping app data and Knox untouched, with a restore for every change.
device: Samsung Galaxy phones and tablets (One UI)
date: 2026-10-20
steps:
  - name: Enable developer options
    text: Open Settings, About phone, Software information and tap Build number seven times.
  - name: Turn on debugging
    text: In Settings, Developer options, turn on USB debugging, or Wireless debugging and Pair device with pairing code.
  - name: Connect and audit
    text: Connect over USB or with pair and connect, accept the Allow debugging prompt, then run android-cleanup-agent audit --summary. Nothing changes.
  - name: Plan with your answers
    text: Tell the plan which features you use (calls, SMS, camera, voice, Bluetooth, location) and your main apps, so related entries are not offered.
  - name: Approve and apply
    text: Approve by category, give a separate yes to high-risk items and apps you installed, then run apply and apply --yes. Knox refusals show as failed items.
  - name: Check and undo if needed
    text: Run results to compare before and after, verify after a system update, and restore to bring anything back.
---

<div class="note">

**Catalog status:** the Samsung entries in this guide are **community-verified**. They come from community debloat lists and have not yet been tested on a real Samsung device by the author. The safeguards (role protection, health checks, automatic rollback, restore) apply to them like to every other entry. Reports from real devices are welcome on GitHub.

</div>

Samsung phones ship with a second set of apps next to Google's: Bixby, Samsung Free, Game Launcher, AR features and more. You can remove many of them for your user over adb, without root and without deleting anything from the system, so they can be brought back at any time.

## What the Samsung catalog can offer

| Item | Action | Risk |
| --- | --- | --- |
| Bixby Voice | Turn off | Medium; not offered if you use voice |
| Bixby voice wake-up | Turn off | Medium; not offered if you use voice |
| Bixby Vision | Turn off | Low; not offered if you use the camera |
| Samsung Free (the left home-screen page) | Remove for this user | Medium |
| Game Launcher | Remove for this user | Low |
| Game Booster | Remove for this user | Low |
| AR Emoji | Remove for this user | Low; not offered if you use the camera |
| AR Doodle | Remove for this user | Low; not offered if you use the camera |
| Samsung Tips | Remove for this user | Low |
| Sticker Center | Remove for this user | Low |
| Samsung Digital Wellbeing | Turn off | Medium |

Google preinstalled apps you never open (for example Google Meet, Google News or Google Play Games) and preinstalled third-party apps such as Facebook App Manager or OneDrive can be offered too, if the catalog lists them and you have not used them in the last 60 days. Settings such as halved animations, Bluetooth off or location off are offered only when they fit your answers.

## What is never touched

- **Samsung Knox** packages are on the never-touch list.
- Your current launcher (One UI Home), keyboard (Samsung Keyboard or another), dialer, SMS app, WebView and accessibility services are protected live, right before every change.
- Core packages: Settings, System UI, Google Play services, the Play Store, system providers and others.
- Unknown Samsung system packages are listed in the audit but never offered.

## Knox refusals

On some Samsung devices Knox refuses certain removals. When the device refuses, the item is reported as **failed** in the run, nothing else is affected, and the rest of the plan continues. There is no workaround attempt.

## Run it

```
android-cleanup-agent devices
android-cleanup-agent audit --summary
android-cleanup-agent plan --uses calls,sms,camera,bluetooth,location,photos --power battery --symptoms battery,slow-apps
android-cleanup-agent approvals init
android-cleanup-agent approvals show
android-cleanup-agent approvals set --category oem-apps=true --category games=true
android-cleanup-agent apply
android-cleanup-agent apply --yes
android-cleanup-agent results
```

The answers are examples; use your own.

## Undo and system updates

`android-cleanup-agent restore --yes` brings removed apps back with `cmd package install-existing`, re-enables disabled ones and resets changed settings. One UI updates can re-enable or reinstall some apps; run `android-cleanup-agent verify` after an update to see what changed back. A factory reset brings all preinstalled apps back.
