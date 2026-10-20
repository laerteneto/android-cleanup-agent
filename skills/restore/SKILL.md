---
name: restore
description: >
  Undo an android-cleanup-agent run: checks which changes are still in place,
  then brings removed apps back, re-enables disabled ones and puts settings back,
  newest first. Use when user says: "undo the cleanup", "bring back <app>",
  "restore my android", "something broke after the cleanup", "re-enable the
  google app", "check if the cleanup is still applied".
argument-hint: "[run id] [app to bring back]"
allowed-tools: Bash(android-cleanup-agent:*), AskUserQuestion
---

# Restore

1. `android-cleanup-agent runs` → pick the run (latest by default; ask if several).
2. Connect the same device (USB, or `connect --host <ip>`; pair again only if asked).
3. `android-cleanup-agent verify --run <id> --json` → tell the user what is still in
   place, what a system update already reverted, and what changed.
4. Ask what to undo: everything, or specific items (match the user's words to the
   rows; ask when unsure). Then `restore --run <id> [--item <id>…]` (dry run) →
   show it → `restore --run <id> [--item …] --yes --json` (Claude Code asks to confirm).
5. `verify --run <id>` again and report. Apps that are not in the system image (installed
   by the user or the carrier) were deleted by Android and come back only by
   reinstalling them from their store (the restore reason names it); Android kept
   their data on the device; cleared app data cannot come back. Say so.
