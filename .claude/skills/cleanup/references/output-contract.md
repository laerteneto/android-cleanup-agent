# Output contract (contract_version: 1)

Every JSON document from the CLI carries `contract_version`. This plugin speaks
**1**. On any other value, stop and tell the user to update the plugin and CLI
together (`claude plugin update android-cleanup-agent` and `npm i -g android-cleanup-agent`).

- `doctor --json`: `adb`, `adbVersion`, `adbOk`, `devices[{serial,state,model,transport}]`,
  `wirelessDebugging[{type,host,port}]`.
- `audit --summary`: `run_id`, `device{manufacturer,model,release,sdk,deviceClass,classReason,transport,otherUsers}`,
  `snapshot{memory{totalKb,freeKb,usedKb},storage{totalKb,usedKb,freeKb},uptimeSec}`,
  `apps{installed,userInstalled,turnedOff}`, `usageHistory`, `topMemory[]`, `topCpu[]`,
  `wakers[{pkg,alarms,wakeups}]`, `thermal{status,maxC}`, `playing[]`, `mostUsed[]`,
  `settings{"ns.key":value}`, `warnings[]`.
- `plan --summary`: `items[{id,category,title,pkg,risk,action,recommended,requiresExplicit,homeCheck,evidence,restore,notes}]`,
  `excluded[{target,reason}]`, `unknownSystemCount`.
- `approvals show --json`: `approved[{id,title,category,risk,action,homeCheck,notes}]`.
- `apply --json`: dry run `{dryRun,items}`; with `--yes` the results.
- `results --json`: `before`/`after` snapshots, `applied`, `removed`, `disabled`,
  `settingsChanged`, `cacheFreedKb`, `skipped`, `failed`, `rolledBack`,
  `restoreScript`, `notRestorable[]`.
- `verify --json`: `rows[{itemId,target,expected,now,status: held|reverted|changed}]`.

Exit codes: 0 ok · 1 error · 2 usage · 3 no device / not authorized · 4 needs a
human · 5 device mismatch or dropped (resume) · 6 unsupported device.
Sizes are KiB from the device (`*Kb`) or bytes (`bytes`); shown in decimal units.
