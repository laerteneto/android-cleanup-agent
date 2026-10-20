# Connecting to the device

## 1. Turn on developer options (once)
- **Phone / tablet / tablet-based TV:** Settings → About phone (or About tablet) →
  tap **Build number** 7 times. On some brands it is under Software information.
- **Android TV:** Settings → Device Preferences → About → select **Build** 7 times.
- **Google TV:** Settings → System → About → select **Android TV OS build** 7 times.

## 2. Pick a connection
- **USB (phones, tablets):** Developer options → **USB debugging** on → plug in →
  accept the prompt on the screen (tick "Always allow").
- **Wi-Fi, Android 11+ (most devices):** Developer options → **Wireless debugging**
  on → open it → **Pair device with pairing code**. Ask the user for the IP address
  and the 6-digit code shown there, then:
  `android-cleanup-agent pair --host <ip> --code <code>` and
  `android-cleanup-agent connect --host <ip>`.
  The ports change every time; the CLI finds them, never ask for them unless
  discovery fails (`--port`).
- **Older Android TV:** Developer options → **Network debugging** (or USB debugging,
  which some TVs also expose on port 5555) → `connect --host <ip>` → accept the
  prompt on the TV.

## Troubleshooting
- `unauthorized`: the trust prompt is on the device screen; accept it.
- Refused / not found: debugging is off, or the screen went to sleep. Wake it,
  toggle Wireless debugging off and on, `connect` again.
- After a restart, Wireless debugging is off again (Android does this for security).
- Several devices connected: pass `--serial`.
