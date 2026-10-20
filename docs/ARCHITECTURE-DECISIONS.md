# Architecture decisions

## ADR-001: A deterministic CLI, a conversational plugin
The CLI measures, decides what can be offered, and makes every change; it works
without Claude. The plugin explains, interviews and asks for approvals. Claude
never sends raw adb changes (hooks deny them) and approves by item id only.

## ADR-002: Catalog-only offers
Only packages in `catalog/` are offered. Unknown system apps are reported and
left alone, because a wrong guess on a system package can break the home screen,
calls or updates. Exception: apps the user installed and has not opened for 90
days are offered unticked, since removing them is ordinary and they come back
from the Play Store.

## ADR-003: Device identity is a hashed android_id + manufacturer + model
Over Wi-Fi the adb serial is `ip:port` and changes on every connection, so it
cannot identify a device. `android_id` is stable until a factory reset. The build
fingerprint is left out on purpose: it changes with every system update, which
would make `restore` refuse after an OTA. The id is hashed; the raw value is
never stored.

## ADR-004: Keep app data on removal
`pm uninstall --user N` without `-k` deletes the app's data. The tool always uses
`-k`, so `cmd package install-existing` brings an app back as it was.

## ADR-005: Only offer what this device can undo
Capabilities are probed during the audit (`install-existing`, `cmd location`,
`cmd bluetooth_manager`, `svc bluetooth`). A removal becomes a disable when the
device cannot reinstall system apps; a radio setting is dropped when there is no
reversible way to switch it.

## ADR-006: clear-data and reboot are separate commands
Clearing data cannot be undone and a restart interrupts whoever is watching.
Neither is part of a plan or of `apply`. `clear-data` takes exactly one package
and a typed confirmation; the hooks ask a human for both and refuse them when
permissions are bypassed.

## ADR-007: Health checks and rollback for risky items
High-risk items (e.g. the Google app, which some launchers embed) are applied
alone. Then Home is pressed, the launcher must come back, the user's main apps
must open, and the crash buffer must show no new crash of the launcher, System UI
or those apps. Any failure rolls the change back immediately.

## ADR-008: Never interrupt playback
Before pressing Home, launching apps or restarting, `dumpsys media_session` is
checked. While something plays, risky items are skipped (resumable) and a
restart is refused. A known popup that a setting change throws over the screen
(the GMS "location off" warning) is dismissed with Back.

## ADR-009: The manifest is the truth
Every change, skip, health check and rollback is appended and fsynced to
`manifest.jsonl` before the next step. `restore`, `verify`, `results` and
`--resume` are all computed from it, never from the plan.

## ADR-010: Keep the screen awake during a run
Wireless debugging drops when the screen sleeps. The screen timeout is raised for
the duration of a run as a logged transient change and put back at the end (or by
`restore` if the run was interrupted).
