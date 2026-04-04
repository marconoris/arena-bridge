"use strict";

const ARENA_API = "https://api.are.na/v3";
const DEFAULT_FOLDER = "arena";
const SYNC_SKIP_FLAG = "arena_skip_sync";
const ARENA_PAGE_SIZE = 50;
const CHANNEL_SELECT_BATCH_SIZE = 12;
const ARENA_REQUEST_DELAY_MS = 500;
const ARENA_MAX_PAGES_PER_RUN = 10;
const ARENA_MAX_ASSET_DOWNLOADS_PER_RUN = 20;
const ARENA_RESPONSE_CACHE_LIMIT = 25;
const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/epub+zip",
  "text/plain",
  "text/markdown",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/ogg",
];
const ALLOWED_ATTACHMENT_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".epub",
  ".txt",
  ".md",
  ".mp3",
  ".m4a",
  ".wav",
  ".webm",
  ".ogg",
  ".mp4",
  ".mov",
];
const ARENA_FRONTMATTER_KEYS = [
  "blockid",
  "class",
  "title",
  "user",
  "channel",
  "source_title",
  "source_url",
  "created_at",
  "updated_at",
];

const DEFAULT_SETTINGS = {
  language: "auto",
  token: "",
  username: "",
  folder: DEFAULT_FOLDER,
  channelFolders: {},
  downloadAttachments: false,
  attachmentsFolderName: "_assets",
  publishCodeBlockFilter: "",
  publishStripCallouts: false,
  channelsCache: [],
  channelBrowser: {
    nextPage: 1,
    totalChannels: null,
    exhausted: false,
  },
  responseCache: {},
};

module.exports = {
  ARENA_API,
  DEFAULT_FOLDER,
  SYNC_SKIP_FLAG,
  ARENA_PAGE_SIZE,
  CHANNEL_SELECT_BATCH_SIZE,
  ARENA_REQUEST_DELAY_MS,
  ARENA_MAX_PAGES_PER_RUN,
  ARENA_MAX_ASSET_DOWNLOADS_PER_RUN,
  ARENA_RESPONSE_CACHE_LIMIT,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ARENA_FRONTMATTER_KEYS,
  DEFAULT_SETTINGS,
};
