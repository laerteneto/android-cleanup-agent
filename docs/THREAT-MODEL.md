# Threat model

## Assets
- The device's ability to work: home screen, keyboard, calls, updates, remote control.
- The user's app data and logins.
- Privacy of what is installed and how the device is used.

## Threats and defences

| Threat | Defence |
|---|---|
| A wrong removal breaks the device | Catalog-only offers; never-touch list; live role holders re-checked before every change; health check + rollback for risky items; everything reversible by `restore`. |
| Claude (or a prompt injection) runs raw adb changes | Bash guard denies `pm` mutators, `settings put/delete`, `cmd` mutators, `svc`, `reboot`, `rm`, fastboot, interactive shells, inline interpreters, including inside `sh -c`, `$(...)`, quoted `adb shell "…"`. Fails closed on errors. |
| Malicious package or process names (device text) | Treated as untrusted: escaped in reports, quoted by skills, never used as instructions. Package names must match a strict pattern before reaching a command. |
| Command injection through adb (the device re-parses the command line) | `assertSafeArgv` allows only plain tokens; package names, setting keys and values have stricter patterns. |
| Acting on a different device than the one audited | Approvals bound to the plan hash and the device fingerprint; `apply`, `restore`, `clear-data` resolve the device by fingerprint. |
| State drift between audit and apply (updates, user changes) | Each item re-reads versionCode, install and enabled state or the setting value; any difference skips it. Audits expire after 24 h. |
| Irreversible data loss | Removal keeps data (`-k`); `clear-data` is single-package, explicit, human-gated, never planned. |
| Tampering with approvals or plans | Write guard denies edits in the state folder; approvals pinned to the plan sha256; only `approvals set/veto` change them. |
| Interrupting someone using the device | Playback guard for Home, app launches and restart; restart needs a typed `--yes` and a human in the plugin. |
| Leaking device data | No telemetry; state folder is owner-only; shareable report has no names; fixtures are synthetic; forbidden-strings and gitleaks checks in CI. |

## Out of scope
Rooted devices, custom ROMs, Fire OS, work profiles and secondary users (reported,
never changed), and protecting a device from someone who already has adb access.
