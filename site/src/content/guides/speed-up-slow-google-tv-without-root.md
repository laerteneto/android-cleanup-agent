---
title: Speed up a slow Google TV without root
description: Find out why a Google TV or Android TV feels slow and fix it over adb without root, by turning off unused Google TV services, home-screen recommendations and background scanning, clearing caches and restarting. Every change can be undone.
device: Google TV and Android TV (sticks, boxes, smart TVs)
date: 2026-10-20
steps:
  - name: Enable developer options
    text: On Google TV open Settings, System, About and tap Android TV OS build seven times. On Android TV open Settings, Device Preferences, About and tap Build seven times.
  - name: Turn on debugging and connect
    text: Turn on USB debugging or Wireless debugging in Developer options, then connect with android-cleanup-agent pair and connect, or Network debugging on port 5555 on older TVs.
  - name: Audit
    text: Run android-cleanup-agent audit --summary to see memory per app, what wakes the TV, free storage, heat and days since the last restart. Nothing changes.
  - name: Answer the interview
    text: Say what feels slow, which features you use (cast, voice, screensaver) and your main streaming apps, so they are protected and health-checked.
  - name: Approve and apply
    text: Approve by category; high-risk items such as voice search or Chromecast built-in need their own yes. Run apply, then apply --yes.
  - name: Restart and compare
    text: Run reboot --yes when nothing is playing, then results to compare RAM in use and storage free before and after.
---

<div class="note">

**Catalog status:** the Google TV and Android TV entries used in this guide are **community-verified**. They come from community debloat lists and have not yet been tested on a real Google TV by the author. The safeguards (role protection, health checks, automatic rollback, restore) apply to them like to every other entry. If you run it on your TV, reports are welcome on GitHub.

</div>

A Google TV that takes seconds to open the home screen is usually not broken. The common causes are things the tool can see in its read-only audit: it has not been restarted in weeks, preinstalled services you never use stay in memory, storage is nearly full, and animations add delay on slow hardware.

## What the audit looks at

- **Days since the last restart.** Long uptimes let memory fill up with background services.
- **Memory per app.** Which apps sit in RAM even though you never open them.
- **What wakes the TV.** Apps that schedule alarms in the background.
- **Storage per app and free storage.** A nearly full TV slows down and fails to update apps.
- **Heat**, **settings** and **usage history** (which apps you actually open).

## What can be offered on a Google TV

Only what is in the curated catalog, and nothing tied to a feature you said you use:

| Item | What it is | Action | Risk |
| --- | --- | --- | --- |
| Google voice search for TV | Powers the microphone button on the remote | Turn off | High (own yes, done alone, health-checked); not offered if you use voice |
| Chromecast built-in | Casting from your phone to the TV | Turn off | High; not offered if you use cast |
| TV home-screen recommendations | Fills the home screen with suggested content | Turn off | Medium |
| Ambient mode | The TV screensaver | Turn off | Medium; not offered if you use the screensaver |
| YouTube Music for TV | Preinstalled music app | Remove for this user | Low |
| Unused Google and preinstalled apps | For example Google TV (Play Movies) or a preinstalled Prime Video, if you never open them | Remove for this user | Low |
| Animations at half length | Only if you said menus or apps feel slow | Setting | Low |
| Background Wi-Fi scanning, location off | Only if you do not use location | Setting | Low |
| Background Bluetooth scanning | Only if you use neither location nor Bluetooth | Setting | Low |
| App caches | Cleared; logins and settings are kept | One-off | Low |

**Bluetooth is never turned off on Android TV or Google TV**, because the remote uses it. Apps you used in the last 60 days are not offered. Your launcher, keyboard and other apps holding a system role are never touched.

## Run it

```
android-cleanup-agent connect --host 192.168.1.60
android-cleanup-agent audit --summary
android-cleanup-agent plan --uses cast --power mains --symptoms slow-menus,video-stutter --keep com.google.android.youtube.tv
android-cleanup-agent approvals init
android-cleanup-agent approvals show
android-cleanup-agent approvals set --category google-apps=true --category performance=true
android-cleanup-agent apply
android-cleanup-agent apply --yes
android-cleanup-agent reboot --yes
android-cleanup-agent results
```

The IP address, answers and package names are examples. If something is playing, the health check waits instead of pressing Home, and `reboot` is refused until playback stops.

## If something feels wrong afterwards

`android-cleanup-agent restore --yes` undoes the run newest first, or `--item <id>` undoes one change. After a system update, `android-cleanup-agent verify` shows which changes the update reverted.
