# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/willcoliveira/android-cleanup-agent/security/advisories/new).
Do not open a public issue. You will get a reply within a week.

## What this tool does to your device

It runs adb commands as the `shell` user, which cannot touch other apps' private
data or the system partition. The only changes it makes are:

| Change | Command | Undo |
|---|---|---|
| Remove a preinstalled (system image) app for your user (data kept) | `pm uninstall -k --user N` | `cmd package install-existing --user N` |
| Remove an unused app you installed (data kept, code deleted by Android) | `pm uninstall -k --user N` | Reinstall from its store |
| Remove an app you installed (data kept where Android allows) | `pm uninstall -k --user N` | reinstall from the Play Store |
| Turn an app off | `pm disable-user --user N` | `pm enable --user N` |
| Change a catalog setting | `settings put`, `cmd location`, `cmd bluetooth_manager` / `svc bluetooth` | original value put back (or deleted) |
| Clear app caches | `pm trim-caches` | caches rebuild by themselves |
| Restart | `adb reboot` | n/a |
| Clear one app's data (only on request) | `pm clear --user N` | **none** |
| Keep the screen awake during a run | `settings put system screen_off_timeout` | restored at the end of the run |

Nothing is pushed to the device, nothing is installed, and root is never used.

## What it reads

Package lists, `dumpsys` output (package, usagestats, diskstats, meminfo, alarm,
cpuinfo, thermalservice, media_session, activity), `getprop`, a fixed list of
settings, and `settings get secure android_id`, which is only used to compute a
hashed device fingerprint. It never reads accounts, Wi-Fi details, messages,
contacts, photos or files.

## What leaves your computer

Nothing. There is no telemetry and no network access other than adb to your
device. Run data is stored with owner-only permissions in the state folder
(see README). The shareable report contains only the device class, Android
version, RAM/storage numbers and counts per category.

## Defences

- Every token sent to the device shell is validated (adb re-parses the command
  line on the device); adb is run with argument arrays, never a shell string.
- Approvals are pinned to the sha256 of the plan, expire after 24 hours, and only
  apply to the device whose fingerprint was audited.
- Each change is re-checked against the audited state right before it is made,
  and against the apps holding system roles at that moment.
- The plugin's hooks deny raw adb changes, fastboot, sudo and inline interpreters,
  and require a human for applying, restoring, restarting and clearing data.
- Device-provided text (package and process names) is treated as untrusted and is
  escaped in every report.

See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) for the full analysis.
