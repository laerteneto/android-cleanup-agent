# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-20

First public release. Tested end to end (audit, plan, apply, restart, verify,
restore) on a Galaxy S22 with Android 16; the tablet-TV entries come from a
cleanup of a Thomson Go Plus Pro (Android 14).

### Added
- CLI: `doctor`, `devices`, `pair`, `connect`, `audit`, `plan`, `approvals`, `apply`,
  `reboot`, `verify`, `restore`, `results`, `report`, `clear-data`, `runs`, `catalog`.
- Read-only audit: apps, usage history, per-app storage and memory, background
  wakeups, heat, settings, uptime; device class detection (phone, tablet,
  Android TV, Google TV, tablet-based TV) and live role holders.
- Curated catalog: Google/AOSP, Android TV, Thomson/KTC, common preloads,
  Samsung and Xiaomi entries; settings; never-touch list.
- Apply engine: identity re-checks, live role protection, playback guard, health
  checks with automatic rollback, keep-awake during runs, resume after a drop.
- Restore from the run log, standalone `restore.sh`, `verify` for drift.
- Reports: terminal, Markdown, offline HTML, redacted shareable artifact.

### Fixed (from the first phone test: Galaxy S22, Android 16)
- A removed app that is not in the system image was recorded as restorable with
  `install-existing`; Android deletes its code. It is now a store reinstall, and
  store-installed copies of catalog apps are turned off instead of removed.
- Health checks on a locked phone failed and rolled back a good change. `apply`
  now wakes the screen, waits for an unlock, and skips (resumably) if the device
  locks mid-run.
- `apply --resume` did not retry items skipped because something was playing.
- Running `plan` with no answers replaced the saved plan; it now shows it.
- "Verified" catalog entries count only on the kind of device they were tested on.
- A restart right after a run lost the run's changes: Android saves app on/off
  state about 10 s later and a raw `adb reboot` skips the normal shutdown.
  `reboot` now waits until the last change is 15 s old and restarts through
  the power manager (`svc power reboot`), falling back to `adb reboot`.
- Claude Code plugin: `cleanup`, `audit`, `restore` skills; risk judge and report
  agents; bash and write guard hooks.

### Security
- Every token sent to the device shell is validated; adb runs with argument arrays.
- Removals keep app data (`pm uninstall -k --user N`) so restore brings apps back intact.
- Clearing app data is a separate, single-package command and never part of a plan.
