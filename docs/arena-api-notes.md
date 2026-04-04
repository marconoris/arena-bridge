# Are.na Bridge API and Implementation Notes

Technical notes for the current Are.na Bridge implementation.

Plugin version: `1.0.0`

## Current Plugin Status

| Command | Status |
| --- | --- |
| Get blocks from a channel | Works |
| Browse my channels | Works, with local cache after the first load |
| Refresh channel list | Works, clears cache before the next fetch |
| Pull block into note | Works |
| Push note to Are.na | Works |
| Get block by ID or URL | Works |
| Create channel in Are.na | Works |
| Upload folder as channel | Works |
| Open block in Are.na | Works |

## Are.na API Facts Confirmed During Development

### Base URL

```text
https://api.are.na/v3
```

### Authentication

```text
Authorization: Bearer {token}
```

### Paginated Response Shape

```json
{
  "data": [],
  "meta": {
    "current_page": 1,
    "total_pages": 5,
    "has_more_pages": true
  }
}
```

Pagination parameters: `page` and `per` with a maximum `per` of `100`.

## Confirmed Endpoints in Use

| Endpoint | Purpose |
| --- | --- |
| `GET /channels/{slug}` | Fetch channel metadata |
| `GET /channels/{slug}/contents` | Fetch channel contents |
| `POST /channels/{slug}/blocks` | Add a block to an existing channel |
| `PUT /blocks/{id}` | Update block |
| `GET /blocks/{id}` | Fetch block by ID |
| `GET /users/{slug}` | Fetch user metadata |
| `GET /users/{slug}/contents` | Fetch mixed user contents, including channels |

## Why "Browse My Channels" Works This Way

### What Does Not Work

`GET /v3/users/{slug}/channels` returns `404`.

`GET /v2/users/{slug}/channels` exists in the deprecated API, but this plugin intentionally stays on `v3`.

`GET /v3/search?q={username}` is not a reliable replacement because it searches matching content, not the user's channel list.

### Current Approach

`GET /users/{slug}` returns `counts.channels`, which tells us how many channels the user has.

The plugin then paginates `GET /users/{slug}/contents` and filters items where `type === "Channel"`.

This is slower than a direct channels endpoint would be, but it is the confirmed `v3` path that works.

### Important `v3` Detail

In the `v3` API, content items use `type`, not `class`.

Typical values include:

- `Channel`
- `Link`
- `Text`
- `Image`
- `Attachment`
- `Media`

### Why It Can Be Slow

`/users/{slug}/contents` returns mixed content: channels, links, text blocks, images, and more. The plugin may need to scan several pages before it finds every channel.

To reduce unnecessary requests, it stops early once it has found the number of channels reported in `counts.channels`.

## Rate Limiting

Known tiers observed during development:

| Tier | Requests per minute |
| --- | --- |
| Guest | 30 |
| Free | 120 |
| Premium | 300 |
| Supporter or Lifetime | 600 |

Relevant headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Tier`
- `X-RateLimit-Reset`
- `X-RateLimit-Window`

When Are.na returns `429 Too Many Requests`, the plugin waits for the reset window and retries.

## Caching Strategy

The plugin keeps:

- a persisted channel list cache
- a persisted API response cache with `ETag` revalidation

This exists for both performance and ToS reasons. Repeatedly paginating all user contents would be wasteful and too close to bulk extraction behavior. The current design tries to keep the interaction local, incremental, and cache-friendly.

## Creating Blocks

The plugin can create blocks using a payload shaped like:

```json
{
  "value": "text or URL",
  "title": "optional title",
  "channel_ids": [123, "my-channel-slug"]
}
```

Notes:

- `value` is the correct field for `v3`.
- A URL value lets Are.na infer the block type.
- `channel_ids` can contain numeric IDs or slugs.
- Up to 20 channels can be targeted in one request.
- `insert_at` is only valid when targeting a single channel.

## Channel Creation

New channels are created with:

```json
{
  "title": "Channel Name",
  "visibility": "public"
}
```

Important notes:

- The field is `visibility`, not `status`.
- Are.na may generate slugs with random suffixes.
- After channel creation, using the numeric channel ID is safer for immediate follow-up operations.

## Confirmed Channel Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v3/channels/{id}` | Fetch channel |
| `GET` | `/v3/channels/{id}/connections` | Fetch channel connections |
| `GET` | `/v3/channels/{id}/contents` | Fetch channel contents |
| `GET` | `/v3/channels/{id}/followers` | Fetch followers |
| `POST` | `/v3/channels` | Create channel |
| `PUT` | `/v3/channels/{id}` | Update channel |
| `DELETE` | `/v3/channels/{id}` | Delete channel |

## Possible Future Improvement

It may be worth testing whether search supports a reliable filter such as:

```text
GET /v3/search?q=&models[]=Channel&user={slug}
```

This was not confirmed during development and should not be relied on without verification.

## Typical `v3` Block Shape

```json
{
  "id": 12345,
  "type": "Text",
  "title": "...",
  "content": "...",
  "user": { "slug": "marco-noris" },
  "source": { "url": "...", "title": "..." },
  "image": { "src": "..." },
  "attachment": { "url": "..." },
  "description": { "plain": "...", "html": "..." },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

## Typical Channel Shape Inside `/contents`

```json
{
  "id": 67890,
  "type": "Channel",
  "title": "Channel Name",
  "slug": "channel-name",
  "visibility": "public",
  "counts": { "contents": 42 },
  "user": { "slug": "marco-noris" }
}
```
