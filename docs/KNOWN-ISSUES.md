# Known issues

- Usage history comes from `dumpsys usagestats`, whose format varies. When it
  cannot be read, no usage evidence is shown and no user-installed apps are offered.
- `dumpsys diskstats` sizes are computed periodically by Android, not live.
- Samsung (Knox) and some MIUI builds refuse certain changes from adb; they are
  reported as failed and not retried.
- System updates can re-enable or reinstall removed apps; `verify` reports it.
- Wireless debugging turns off after every restart, so measuring after a restart
  needs it switched on again.
- Catalog entries other than those marked `verified` have not been tested on a
  real device by the maintainer yet. `verifiedOn` says which kind of device; an
  entry only counts as verified (and can be recommended) on that kind.
- Removing an app that is not in the system image deletes its code (Android keeps
  its data); only a store reinstall brings it back. See ADR-004.
- Risky changes need the screen on and unlocked, because the health check presses
  Home and opens apps. `apply` wakes the screen and waits up to 90 seconds for an
  unlock; a phone that locks itself mid-run has those items skipped, and
  `apply --resume` does them later.
- RAM "after" is measured right after the health checks opened your main apps, so
  it reads high for a few minutes.
