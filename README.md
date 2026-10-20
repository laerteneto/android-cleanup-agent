# android-cleanup-agent

Clean up and speed up an Android **phone, tablet or TV** over adb, **without root**.
It audits the device, asks how you use it, proposes a plan you sign off item by
item, applies it with health checks, and shows the before/after numbers. Every
change is logged and can be undone.

A TypeScript CLI that does all the device work, plus a Claude Code plugin that
turns it into a conversation.

```text
$ android-cleanup-agent audit
DemoKTC Demo Go · Android 14 (SDK 34) · TV running tablet Android
RAM:      2.8 GB used of 8.2 GB
Storage:  44.6 GB free of 55.4 GB
Running:  76 days since the last restart
Biggest memory users
  263 MB    system
  256 MB    com.google.android.gms
  196 MB    com.google.android.googlequicksearchbox:googleapp
Wakes the device most often
  79    com.google.android.gms (412 alarms)
  64    com.google.android.calendar (206 alarms)
```

## Requirements

- Node.js 22.4 or newer
- adb from [Android platform-tools](https://developer.android.com/tools/releases/platform-tools) 30 or newer
  (found on PATH, or in the Android Studio SDK folder)
- A device running Android 8.0 or newer with USB debugging or Wireless debugging on.
  Phones, tablets, Android TV, Google TV and TVs that run tablet Android are supported.
  Amazon Fire TV is not.
- macOS or Linux (Windows through WSL)

## Install

```bash
npm i -g android-cleanup-agent
```

Claude Code plugin:

```text
/plugin marketplace add willcoliveira/android-cleanup-agent
/plugin install android-cleanup-agent@android-cleanup-agent
```

Then ask Claude "my Android TV is slow" or run `/android-cleanup-agent:cleanup`.

## Quick start (CLI only)

```bash
# Wi-Fi: on the device, Developer options → Wireless debugging → Pair device with pairing code
android-cleanup-agent pair --host 192.168.1.50 --code 123456
android-cleanup-agent connect --host 192.168.1.50      # or plug in over USB

android-cleanup-agent audit                            # read-only
android-cleanup-agent plan --uses typing --power mains --symptoms slow-menus,slow-apps \
  --keep com.google.android.youtube,com.netflix.mediaclient
android-cleanup-agent approvals set --category google-apps=true --category performance=true
android-cleanup-agent apply                            # dry run
android-cleanup-agent apply --yes
android-cleanup-agent reboot --yes                     # optional
android-cleanup-agent results
android-cleanup-agent report --format html
```

Undo everything, or one item:

```bash
android-cleanup-agent restore --yes
android-cleanup-agent restore --item i_0123456789ab --yes
```

## How it works

1. **Connect.** USB, or Wi-Fi pairing. Wireless-debugging ports change every time,
   so they are discovered over mDNS.
2. **Audit** (read-only). Installed apps, a year of usage history, per-app storage
   and memory, what wakes the device, heat, settings and days since the last restart.
3. **Interview.** What feels wrong, how it is powered, which features you use
   (Bluetooth, casting, location, voice…), and your main apps.
4. **Plan.** Deterministic. Only packages in the curated [catalog](catalog/) are
   offered, plus apps you installed and have not opened for 90 days (offered
   unticked). Anything used in the last 60 days, anything on the never-touch list
   and anything holding a system role right now is left alone. Unknown system apps
   are reported, never offered.
5. **Approve.** Per category. Apps you installed and high-risk changes need their
   own yes. In the plugin, a risk-judge sub-agent can veto, never add.
6. **Apply.** One item at a time: re-checked against the audited state, changed,
   read back, logged. Risky items (such as the Google app) are done alone, then
   the home screen and your main apps are opened and the crash log is checked;
   on failure the change is rolled back. Nothing presses Home while something is
   playing. A dropped connection stops the run; `--resume` continues it.
7. **Results.** RAM in use and storage free, before and after.

## The CLI

| Command | What it does |
|---|---|
| `doctor` | adb, devices, wireless debugging seen on the network |
| `pair` / `connect` / `devices` | Wi-Fi pairing and connection |
| `audit` | Read-only audit (`--summary`, `--json`, `--class`) |
| `plan` | Offered changes from the audit, the catalog and your answers |
| `approvals init\|set\|veto\|show` | What is approved (everything starts off) |
| `apply` | Make the approved changes (dry run unless `--yes`; `--resume`) |
| `reboot` | Restart (refused while something is playing) |
| `verify` | Are the changes still in place (after a restart or a system update)? |
| `restore` | Undo, newest first (dry run unless `--yes`; `--item`) |
| `results` | Before/after numbers |
| `report` | `terminal`, `md`, `html`, `json`, `artifact` |
| `clear-data` | Clear **one** app's data. Cannot be undone. Never part of a plan. |
| `runs`, `catalog list\|validate` | |

Exit codes: 0 ok · 1 error · 2 usage · 3 no device or not authorized · 4 needs a
human confirmation · 5 device mismatch or dropped (resumable) · 6 unsupported device.

## The Claude Code plugin

- **Skills:** `cleanup` (the whole flow), `audit` (read-only), `restore`.
- **Agents:** `aca-risk-judge-agent` (can only veto), `aca-report-agent`.
- **Hooks:** raw `adb shell pm uninstall`, `settings put`, `reboot`, `rm`, fastboot
  and similar are denied, so every change goes through the CLI. Applying,
  restoring, restarting and clearing data ask you first; restarting and clearing
  data are refused when permissions are bypassed.

## What is never touched

The Android framework, System UI, Settings, Google Play services, the Play Store,
WebView, the permission controller and package installer, system providers,
networking, setup, phone and emergency services, TV launchers and remote
services, system updaters, Samsung Knox, Xiaomi's security center, and whatever
app is your home screen, keyboard, dialer, SMS app, WebView provider,
accessibility service or device administrator right now (checked again before
every change). Full list: [`catalog/never-touch.yaml`](catalog/never-touch.yaml).

## Undo

- `restore` reverses the run's changes from its log: removed preinstalled apps come
  back with `cmd package install-existing` (their data was kept), disabled apps are
  re-enabled, settings are put back (unset ones are deleted again).
- Each run also writes a standalone `restore.sh` that finds the device by its
  fingerprint, for when the CLI is not around.
- **Not restorable by the tool:** apps that are not part of the system image, such
  as apps you installed yourself or ones the carrier added during setup. Android
  deletes their code when they are removed, even with `-k`, and keeps only their
  data, so the way back is reinstalling them from their store. A
  catalog app that is a store-installed copy on your device is turned off instead
  of removed for this reason. Also not restorable: cleared app data, and anything after a factory reset (a reset
  brings every preinstalled app back anyway).

## Security and privacy

No telemetry, no network calls except adb to your device. Audits, plans and logs
stay in `~/Library/Application Support/android-cleanup-agent` (macOS) or
`~/.local/state/android-cleanup-agent` (Linux). Device ids are hashed. The
shareable report contains no model name and no app names. See [SECURITY.md](SECURITY.md).

## Project structure

```text
src/            CLI (TypeScript): platform (adb), parsers, audit, plan, apply, restore, reports
catalog/        the curated catalog: packages/*.yaml, settings, never-touch, devices
.claude/        plugin skills and agents (mirrored to skills/ and agents/ on build)
hooks/          plugin safety hooks
bin/            plugin launcher (runs the pinned npm version)
tests/          unit tests and end-to-end tests against a simulated device
site/           documentation site
docs/           architecture decisions, threat model
```

## Contributing

New catalog entries are the most useful contribution: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
