# Going public (v1.0.0 checklist)

1. Dogfood: full flow on a phone (done 2026-10-20: Galaxy S22, Android 16,
   including restart, `verify` and `restore`) and the tablet-TV entries
   (validated by the hand cleanup of the Thomson on 2026-10-19). Mark tested
   catalog entries `verified` with `verifiedOn`.
2. `npm run check` and `npm run check:forbidden -- --history` with the private list.
3. gitleaks on the full history.
4. `claude plugin validate . --strict` and `claude plugin validate .claude-plugin/plugin.json --strict`.
5. `npm version 1.0.0` (syncs plugin.json and marketplace.json), CHANGELOG entry.
6. Create the GitHub repo (public), push `main`, enable private vulnerability
   reporting, Pages (GitHub Actions source), and an `npm` environment.
7. First `npm publish --access public` by hand; then configure npm trusted
   publishing for `release.yml` and push the `v1.0.0` tag.
8. Check the site at https://willcoliveira.github.io/android-cleanup-agent/ and
   submit the sitemap to Google Search Console.
