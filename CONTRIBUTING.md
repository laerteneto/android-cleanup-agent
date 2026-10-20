# Contributing

## Adding a catalog entry

The catalog decides what can ever be offered, so entries need care.

1. Pick the file in `catalog/packages/` for the vendor (or add one with a `match:`
   block on `manufacturer`, `brand` or `packagesAny`).
2. Add the entry:

   ```yaml
   - id: com.vendor.app              # exact package name
     title: Vendor App               # what users recognise
     vendor: vendor
     category: oem-apps              # see CATEGORIES in src/core/schemas.ts
     risk: low                       # low | medium | high (high requires homeCheck: true)
     action: uninstall-user          # or disable
     features: []                    # not offered if the user uses one of these
     confidence: community           # verified only after testing on a real device
     notes: ['What the user loses, in one sentence.']
   ```

3. `npx android-cleanup-agent catalog validate` (or `npm run build && node dist/cli/index.js catalog validate`).
4. In the PR, say which device and Android version you tested on, what happened
   after removing it, and that `restore` brought it back. Only then use
   `confidence: verified` and add the device class to `verifiedOn`.

Never add anything that holds data the user cares about without a note, and
never add system services (if in doubt, it belongs in `never-touch.yaml`).

## Code changes

- `npm run check` must pass (build, lint, tests, plugin mirror, package contents).
- New device behaviour needs a test in `tests/e2e` against the simulated device
  (`tests/fake-adb.ts`), and a protection needs a test that fails when it is removed.
- Shell out with argument arrays only. Validate every device shell token.
- Fixtures are synthetic: no real serials, IPs, account names or package lists
  captured from someone's device. Use `192.0.2.0/24` for addresses.
- Conventional Commits.
