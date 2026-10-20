---
title: Remove bloatware from a Thomson Go TV without root
description: A real cleanup of a Thomson Go Plus Pro portable touchscreen TV over adb, without root. 17 unused apps removed, 4 turned off, 2.1 GB of caches cleared, and RAM in use down from 2.74 GB to 1.91 GB after a restart.
device: Thomson Go Plus Pro (tablet Android 14)
date: 2026-10-20
steps:
  - name: Enable debugging
    text: Open Settings, About, tap Build number seven times, then turn on USB debugging or Wireless debugging in Developer options.
  - name: Connect
    text: Plug in a USB cable, or run pair --host and connect --host with the IP address and pairing code shown on the TV. Accept the Allow debugging prompt.
  - name: Audit
    text: Run android-cleanup-agent audit --summary to see installed apps, usage, memory per app, what wakes the device and days since the last restart. Nothing changes.
  - name: Plan
    text: Answer what feels wrong, the power source, the features you use and your main apps (for example YouTube and Netflix). The plan offers only catalog apps and apps you have not used.
  - name: Approve and apply
    text: Approve by category, give a separate yes to high-risk items such as the Google app, then run apply --yes. Risky items are applied alone with a health check.
  - name: Restart and compare
    text: Run reboot --yes when nothing is playing, then results to see RAM in use and storage free before and after.
---

The Thomson Go range are portable touchscreen TVs on a stand with a battery. They do not run Android TV or Google TV: they run **tablet Android**, so they come with phone-style preinstalled apps that you will never use on a TV. android-cleanup-agent detects them as the `tablet-tv` class.

This guide follows a real run on a **Thomson Go Plus Pro** (Android 14, Rockchip RK3576, 8 GB RAM). The Thomson catalog entry used here (the screen-cast receiver) is marked as verified on this device.

## What the audit found

- The TV had been running for **76 days without a restart**.
- Preinstalled apps that had **never been opened** were still running in the background. The Calendar app had woken the device about **64 times** to refresh its widgets. Prime Video and the Google app sat in memory.
- The real usage was **YouTube and Netflix**. Those were named as the main apps in the interview, so they were protected and opened during every health check.

## What was changed

| Change | Count / detail |
| --- | --- |
| Unused apps removed (`pm uninstall -k --user`, data kept) | 17 |
| Apps turned off (disabled) | 4: the Google app, Speech Services by Google, the Thomson screen-cast receiver, Digital Wellbeing |
| Animations | Halved (0.5×), because menus felt slow |
| Radios and scanning | Bluetooth off, location off, Wi-Fi and Bluetooth background scanning off |
| Caches | 2.1 GB of app caches cleared (logins and settings kept) |
| Restart | Yes, after the changes |

The Google app is a high-risk item, so it needed its own yes and was turned off alone, followed by a health check: press Home, open YouTube and Netflix, read the crash log. It passed. Had it failed, it would have been turned back on automatically.

Bluetooth off is offered on tablet-class devices like this one only if you say you do not use Bluetooth. On Android TV and Google TV it is never offered, because the remote uses it. Turning off the screen-cast receiver is skipped if you say you use cast.

## The result

**RAM in use went from 2.74 GB to 1.91 GB**, measured right after the restart. Be fair about that number: part of the drop is simply the fresh restart after 76 days. What the cleanup changes is that the never-used apps no longer come back into memory or wake the device as the days go by.

## Restarting a Thomson Go TV

The Thomson menus have no Restart option. A hidden power menu exists, with **Go out screen**, **Shutdown** and **Restart**; holding the power button may show it. Or let the tool do it once nothing is playing:

```
android-cleanup-agent reboot --yes
```

Restarting every few weeks helps on its own. The audit shows the days since the last restart, so you can see when it is due.

## The commands

```
android-cleanup-agent connect --host 192.168.1.50
android-cleanup-agent audit --summary
android-cleanup-agent plan --uses typing --power mixed --symptoms slow-menus,storage --keep com.google.android.youtube,com.netflix.mediaclient
android-cleanup-agent approvals init
android-cleanup-agent approvals set --category google-apps=true --category oem-apps=true --category performance=true
android-cleanup-agent apply
android-cleanup-agent apply --yes
android-cleanup-agent reboot --yes
android-cleanup-agent results
```

The IP address and answers are examples; use your own. With the Claude Code plugin, `/android-cleanup-agent:cleanup` asks the same questions in conversation.

## Undo

Everything above except the cleared caches can be undone with `android-cleanup-agent restore --yes`, or with the `restore.sh` script saved with the run. Removed apps come back with `cmd package install-existing`; disabled apps are turned back on; settings return to their previous values. A factory reset also brings all the apps back.
