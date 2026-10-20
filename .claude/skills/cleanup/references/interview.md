# Interview

Ask with AskUserQuestion (max 4 questions per call). Never assume an answer: a
feature the user does not mention is not a feature they don't use. Ask.

1. **What feels wrong?** (multiSelect) menus/home screen slow → `slow-menus`;
   apps slow to open → `slow-apps`; running out of space → `storage`; battery
   drains → `battery`; gets hot → `heat`; video stutters → `video-stutter`.
2. **How is it powered?** mostly plugged in → `mains`; mostly battery → `battery`;
   both → `mixed`.
3. **Which features do they use?** (multiSelect, ask in two calls if needed)
   Bluetooth (speakers, headphones, remote, keyboard) → `bluetooth`; casting or
   screen mirroring → `cast`; location-based apps → `location`; voice search /
   "Hey Google" → `voice`; typing on screen → `typing`; camera → `camera`;
   calls → `calls`; SMS → `sms`; alarms → `alarms`; screensaver → `screensaver`;
   screen reader or other accessibility → `accessibility`; email → `email`;
   photos backup → `photos`. On Android TV / Google TV, Bluetooth is always kept
   (the remote uses it); you need not ask.
4. **Main apps** (the ones that must keep working): use the audit's `mostUsed`
   list to suggest, let the user confirm or add. Pass as `--keep pkg1,pkg2`. They
   are never offered and are launched as a health check after risky changes.
5. **Is someone using the device right now?** If yes, the plan can still be made,
   but schedule apply/restart for when it is free (the CLI also waits on playback).

Map to: `plan --run <id> --uses a,b --power mains --symptoms x,y --keep p1,p2`.
