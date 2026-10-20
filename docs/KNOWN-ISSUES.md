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
  real device by the maintainer yet.
