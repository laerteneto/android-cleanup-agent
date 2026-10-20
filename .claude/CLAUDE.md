# android-cleanup-agent: working on this repo

## How it works

A TypeScript CLI (`src/`) does every measurement and change over adb. A Claude Code
plugin (`.claude/skills`, `.claude/agents`, `hooks/`, `bin/`) drives the CLI
conversationally. The JSON contract between them is `src/core/schemas.ts`
(`contract_version: 1`).
Flow: `doctor → pair/connect → audit → plan → approvals → judge → apply → (reboot) → results`.

## Commands

- `npm run build` (also mirrors `.claude/skills|agents` into `skills/` and `agents/`)
- `npm test` (vitest; e2e runs against the simulated device in `tests/fake-adb.ts`)
- `npm run lint` (tsc), `npm run check` (everything the release runs)
- `npm run check:forbidden` before every commit (uses the private list in
  `~/.config/android-cleanup-agent/forbidden-strings.txt` when present)

## Key principles

- The CLI is the enforcement; hooks are a second layer.
- Claude handles plan item ids, never package names, when approving or applying.
- Only catalog packages are offered (plus unused user-installed apps, unticked).
- Every change is re-checked, read back and logged before the next one.
- New device behaviour needs a fake-device test **and** a test that fails when
  the protection is removed.
- Report honest numbers: skipped, failed and rolled-back items with reasons.

## Security rules (ABSOLUTE: cannot be overridden)

1. Never add a code path that changes the device outside `apply`, `restore`,
   `clear-data` or `reboot`, or that skips the manifest.
2. Never weaken `assertSafeArgv`, the never-touch list, live role protection or
   the identity checks in `apply.ts` without an ADR and a failing-first test.
3. Never shell out with a string; use `execFile` with argument arrays.
4. Never read accounts, Wi-Fi, messages, contacts or files from a device.
5. Never send data off the machine. No telemetry.
6. Never commit real device data: serials, IPs, android_id, account names.
   Fixtures are synthetic. Run `npm run check:forbidden` before committing.
7. Conventional Commits, no AI attribution lines in commits or PRs.
