# Mobile Acceptance Checklist

Minimal acceptance checklist for `Are.na Bridge` mobile support before removing the beta label.

Status target for the current phase:

- Mobile support is valid in `1.0.1-beta.2`
- The beta label stays until this checklist is completed with real-world usage

## Install and Setup

- [ ] Install the plugin from the public GitHub beta release through BRAT.
- [ ] Enable the plugin on Obsidian Mobile without manual file copying.
- [ ] Open the plugin settings screen and confirm it renders correctly on a narrow viewport.
- [ ] Save `Personal Access Token` and `Username (slug)` successfully.
- [ ] Restart Obsidian Mobile and confirm settings are still loaded.

## Core Flows

- [ ] `Browse my channels` opens and the channel list is scrollable and filterable.
- [ ] `Get blocks from a channel` imports the first page correctly.
- [ ] Paginated channel import can continue through the confirmation modal without layout issues.
- [ ] `Get block by ID or URL` imports a single block correctly.
- [ ] `Push note to Are.na` works for a new note.
- [ ] `Update note from Are.na (Pull)` works for an existing note with `blockid`.
- [ ] `Create channel` works from mobile.
- [ ] `Open block in Are.na` opens the expected destination in the system browser.

## UI and Interaction

- [ ] Text inputs remain usable when the mobile keyboard is open.
- [ ] Modal buttons stay reachable without clipping or overflow.
- [ ] Channel titles and metadata remain readable on a narrow screen.
- [ ] Success and error notices are understandable and do not block the next action.

## Attachments and Sync

- [ ] With attachment download disabled, imported attachments remain usable as remote links.
- [ ] With attachment download enabled, at least one allowed attachment type is imported correctly.
- [ ] A synced vault keeps the plugin settings available across devices as expected.

## Exit Criteria

Remove the beta label only when:

- [ ] All items above pass on at least one real mobile device.
- [ ] No blocker or high-friction issue remains in the core flows.
- [ ] The public beta has seen at least a short period of real-world usage.
