---
title: Why is my Android TV slow? A checklist
description: A practical checklist for a slow Android TV or Google TV, from uptime and memory to background wake-ups, full storage, heat and animations, and which checks android-cleanup-agent can run for you without root.
device: Android TV, Google TV and TVs running tablet Android
date: 2026-10-20
steps:
  - name: Check how long since the last restart
    text: The audit reports days since restart. Weeks of uptime let background services pile up in memory; restart the TV first.
  - name: Look at memory per app
    text: Find apps sitting in memory that you never open, such as preinstalled streaming apps or assistant services.
  - name: Look at what wakes the TV
    text: Check which apps schedule alarms in the background, for example widgets refreshing on a TV where nobody sees them.
  - name: Check free storage
    text: A nearly full TV slows down and fails to update apps. Clearing app caches frees space and keeps logins.
  - name: Check heat
    text: A hot TV box or stick slows itself down. Give it air and check the temperature the audit reports.
  - name: Shorten animations
    text: On slow hardware, halving the animation scales makes menus feel faster.
  - name: Remove or turn off what you do not use
    text: Approve only unused catalog apps and services, apply with health checks, and keep restore available.
---

A slow Android TV is rarely one thing. Work down this list; the first item fixes more than you would expect. Every check marked **audit** is something `android-cleanup-agent audit` measures for you, read-only, over adb without root.

## 1. When was it last restarted? (audit)

TVs are rarely turned off properly; standby is not a restart. After weeks of uptime, background services fill the memory. The audit shows **days since restart**. On a real Thomson Go TV the count was 76 days. Restart first, then judge how slow it is.

## 2. What is sitting in memory? (audit)

The audit lists **memory per app** next to **usage history**. Look for apps that hold memory but that you never open: preinstalled streaming apps you do not subscribe to, the Google app or voice assistant on a TV you never talk to, a screensaver service.

## 3. What keeps waking it up? (audit)

The audit reads **alarms**: which apps wake the device in the background. A calendar or news widget refreshing on a TV home screen is a classic one.

## 4. Is the storage full? (audit)

The audit reports **storage per app** and free storage. Low free space slows the system and blocks app updates. Clearing app caches is offered in the plan (logins and settings are kept; caches rebuild as you use apps).

## 5. Is it hot? (audit)

The audit reports device **heat**. Sticks behind a TV and boxes in closed cabinets slow themselves down when hot. This is a placement problem, not a software one.

## 6. Are animations slowing the menus?

If you report slow menus or apps in the interview, the plan offers **animations at half length** (window, transition and animator scales to 0.5×). Settings you changed yourself before are left alone.

## 7. Is it scanning for things all the time?

Background Wi-Fi scanning and location can be turned off if you do not use location; background Bluetooth scanning only if you use neither location nor Bluetooth. **Bluetooth itself is never turned off on Android TV or Google TV**, because the remote uses it.

## 8. Are there services you never use?

On Google TV and Android TV the catalog can offer to turn off home-screen recommendations, Ambient mode, Chromecast built-in or voice search, and to remove apps like YouTube Music for TV, but never anything tied to a feature you said you use, and never an app you opened in the last 60 days. These TV entries are community-verified and not yet tested on a real Google TV by the author; see the [Google TV guide](/android-cleanup-agent/guides/speed-up-slow-google-tv-without-root/).

## Run the checks

```
android-cleanup-agent audit --summary
```

That is read-only. Or, with the Claude Code plugin, run `/android-cleanup-agent:audit` and ask "why is my TV slow?". If you then want to change things, `plan`, `approvals` and `apply` take it from there, and `restore` undoes it.

Not on the list: Amazon Fire TV, which the tool does not support.
