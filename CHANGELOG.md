# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- Claude Code plugin: `cleanup`, `audit`, `restore` skills; risk judge and report
  agents; bash and write guard hooks.

### Security
- Every token sent to the device shell is validated; adb runs with argument arrays.
- Removals keep app data (`pm uninstall -k --user N`) so restore brings apps back intact.
- Clearing app data is a separate, single-package command and never part of a plan.
