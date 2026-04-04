# Release Checklist

Checklist for preparing `Are.na Bridge` for a public launch in the Obsidian community plugins directory.

## Blocking

- [ ] Replace direct `fetch` usage with Obsidian `requestUrl` for API calls and attachment downloads.
- [ ] Move modal/UI inline styles out of JavaScript into a dedicated `styles.css`.
- [ ] Hide the Personal Access Token in settings by using a password-style input instead of plain visible text.
- [ ] Verify mobile support end to end or, if mobile is not reliable enough yet, change `manifest.json` to `isDesktopOnly: true`.

## Review Readiness

- [ ] Remove review friction items from the codebase: load/unload `console.log` noise, avoid ad hoc settings headings where Obsidian expects native settings UI, and re-check the plugin against the official self-critique checklist.
- [ ] Add an explicit `Disclosures` section to the README covering network access to Are.na, required token/account, optional attachment downloads into the vault, and whether the plugin does or does not send telemetry.
- [ ] Prepare the release artifacts cleanly: final version bump, committed `manifest.json`, built `main.js`, GitHub release, and attached plugin assets required by Obsidian submission.

## Launch Strategy

- [ ] Run a short beta through BRAT before submission so external users can catch real vault/API edge cases.
- [ ] Decide whether `versions.json` is needed. Add it only if `minAppVersion` changes or if you want to preserve compatibility for older Obsidian versions.
