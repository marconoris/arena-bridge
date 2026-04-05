# Are.na Bridge 1.0.1-beta.2

This beta release tightens the sync flow around folder and note context actions, with special attention to real vault data that used channel titles instead of stable Are.na identifiers.

## Highlights

- Desktop file explorer context menus now expose direct sync actions for folders and Markdown notes.
- Folder refresh from Are.na only appears when the folder is already linked locally to a channel.
- Channel resolution now supports channel identifiers more robustly, including special cases like `→ Inbox`.
- Existing notes under `Docs/Are.na` can be aligned with real channel slugs so later syncs no longer fail on title-based values.

## Notes

- This release should still be published on GitHub as a `Pre-release`.
- Mobile support remains beta and should be validated on a real device, especially around long-press file menus.
- Desktop remains the reference environment for the folder context workflow.

## Recommended test flows

- Long-press or right-click a synced folder and run the channel update action
- Long-press or right-click a Markdown note and run pull, push, and open-in-Are.na
- Sync `→ Inbox` and at least one folder that previously stored a title in `channel:`
