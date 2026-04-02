# Are.na Bridge

An Obsidian plugin that connects your vault with [Are.na](https://www.are.na). It lets you import channels and blocks, publish notes to Are.na, and keep a lightweight sync flow between both sides.

## Features

- Import blocks from an Are.na channel into your vault.
- Import a single block by ID or URL.
- Browse your Are.na channels from Obsidian with local cache and paginated loading.
- Pull an Obsidian note from its original Are.na block.
- Push a new or existing note to an Are.na channel.
- Create new Are.na channels without leaving Obsidian.
- Upload an Obsidian folder as a new Are.na channel.
- Optionally download images and attachments into the vault.

## Status

Current version: `2.0.0`

This version uses the Are.na `v3` API with a Personal Access Token.

This project independently continues the original idea behind [`javierarce/arena-manager`](https://github.com/javierarce/arena-manager), released under the MIT license. It is not intended to track that upstream as an active fork.

## Installation

Installation is currently manual:

1. Copy `manifest.json` and `main.js` into `.obsidian/plugins/arena-bridge/` inside your vault.
2. Restart Obsidian or reload community plugins.
3. Enable `Are.na Bridge` in `Settings -> Community plugins`.

## Configuration

Configure the plugin in Obsidian settings:

- `Personal Access Token`: get it from [are.na/settings/oauth](https://www.are.na/settings/oauth). For channel creation and note push, use a token with `write` scope.
- `Username (slug)`: your Are.na username, for example `marco-noris`.
- `Folder`: base vault folder where imported blocks will be stored. Default: `arena`.
- `Download attachments`: when enabled, images and files are downloaded into the vault.
- `Attachments folder`: local subfolder name for downloaded files. Default: `_assets`.

The settings panel also includes cache diagnostics and buttons to clear channel cache, block cache, or the full persisted cache state.

## Usage

### Browse My Channels

Opens a modal listing your Are.na channels. Loading is paginated and backed by a local cache revalidated with `ETag`, so repeated browsing does not re-fetch everything unnecessarily.

### Get Blocks From a Channel

Accepts either a channel slug or a full channel URL, for example:

```text
my-channel
https://www.are.na/marco-noris/my-channel
```

The plugin imports the first page and asks for confirmation before loading more pages.

### Get Block by ID or URL

Imports a single block from Are.na.

### Update Note From Are.na (Pull)

If the active note has `blockid` in frontmatter, the plugin refreshes its content from Are.na without overwriting unrelated custom frontmatter keys.

### Send Note to Are.na (Push)

If the note already has `blockid`, the existing Are.na block is updated. Otherwise, the plugin lets you choose a channel and creates a new block.

### Create Channel in Are.na

Creates a new channel from Obsidian with one of these visibility modes:

- `public`
- `closed`
- `private`

### Upload Folder as Are.na Channel

From the context menu of a vault folder, create a new Are.na channel and upload its `.md` notes as text blocks.

- Notes that already have `blockid` are updated instead of duplicated.
- New notes receive `blockid` and `channel` in frontmatter.

### Open Block in Are.na

Opens the Are.na block associated with the active note in your browser.

## How Notes Are Stored

Imported blocks are stored under:

```text
{configured-folder}/{channel-slug}/
```

Each imported note includes frontmatter similar to this:

```yaml
---
blockid: 12345
class: Text
title: "Block Title"
user: marco-noris
channel: my-channel
created_at: 2024-01-01
updated_at: 2024-03-01
---
```

Important details:

- `blockid` is the reference used for future pull and push operations.
- Existing notes are matched by `blockid`, not by filename.
- Non-Are.na frontmatter keys are preserved.
- If a note has `arena_skip_sync: true`, it is excluded from pull, push, and folder upload operations.

## Supported Block Types

| Type | Import behavior |
| --- | --- |
| Text | Markdown content |
| Link | Link with title and description |
| Image | Embedded image |
| Attachment | Link or downloaded local file |
| Media | Textual content when available |

## Limits and Behavior

- The plugin uses the Are.na `v3` API and only accesses content visible to your token.
- It paces requests and retries automatically when Are.na returns `429`.
- Channel browsing and some imports are intentionally paginated instead of bulk-loading everything.
- If attachment download is enabled, the plugin enforces a per-run cap to avoid systematic downloading.
- Are.na forbids scraping and bulk harvesting; this plugin is designed for interactive use inside Obsidian.

## Development

Obsidian loads `main.js`, but the source code lives in `src/`.

```bash
npm install
npm run build
```

For watch mode during development:

```bash
npm run dev
```

Edit `src/`. `main.js` is the generated bundle.

Additional API and implementation notes are documented in [`docs/arena-api-notes.md`](docs/arena-api-notes.md).

## License

MIT. See [LICENSE](./LICENSE).
