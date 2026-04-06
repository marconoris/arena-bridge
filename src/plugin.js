"use strict";

const { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath, requestUrl } = require("obsidian");
const {
  DEFAULT_FOLDER,
  SYNC_SKIP_FLAG,
  ARENA_FRONTMATTER_KEYS,
  DEFAULT_SETTINGS,
  CHANNEL_SELECT_BATCH_SIZE,
  ARENA_MAX_PAGES_PER_RUN,
  ARENA_MAX_ASSET_DOWNLOADS_PER_RUN,
  ARENA_RESPONSE_CACHE_LIMIT,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ALLOWED_ATTACHMENT_EXTENSIONS,
} = require("./constants");
const { ArenaClient } = require("./arena-client");
const { InputModal, ConfirmModal, ChannelSelectModal, CreateChannelModal } = require("./modals");
const { SUPPORTED_LANGUAGES, LANGUAGE_PREFERENCE_AUTO, createTranslator } = require("./i18n");
const {
  sanitizeFilename,
  sanitizeFolderName,
  isSyncSkipped,
  getArenaFrontmatter,
  frontmatterObjectToYaml,
  blockToContent,
  splitNoteContent,
  extractFrontmatterScalar,
  replaceBodyPreservingFrontmatter,
  normalizeCodeFenceLanguage,
  filterMarkdownCodeBlocks,
  filterMarkdownCallouts,
} = require("./note-utils");

function createChannelBrowserState() {
  return {
    nextPage: 1,
    totalChannels: null,
    exhausted: false,
  };
}

function getHeaderValue(headers = {}, name) {
  const target = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === target) return String(value);
  }
  return "";
}

class ArenaManagerPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.cacheDirty = false;
    this.cacheTouches = {};
    this.arena = new ArenaClient(this.settings.token);
    this.addSettingTab(new ArenaSettingsTab(this.app, this));
    this.registerCommands();
    this.registerFolderMenu();
    console.log(this.t("notices.pluginLoaded"));
  }

  onunload() {
    console.log(this.t("notices.pluginUnloaded"));
  }

  applyI18n() {
    this.i18n = createTranslator(this.settings.language || LANGUAGE_PREFERENCE_AUTO);
    this.t = (key, variables = {}) => this.i18n.t(key, variables);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!SUPPORTED_LANGUAGES.includes(this.settings.language) && this.settings.language !== LANGUAGE_PREFERENCE_AUTO) {
      this.settings.language = LANGUAGE_PREFERENCE_AUTO;
    }
    if (!this.settings.channelFolders || typeof this.settings.channelFolders !== "object" || Array.isArray(this.settings.channelFolders)) {
      this.settings.channelFolders = {};
    }
    if (!Array.isArray(this.settings.channelsCache)) {
      this.settings.channelsCache = [];
    }
    this.settings.channelBrowser = Object.assign(
      createChannelBrowserState(),
      this.settings.channelBrowser || {}
    );
    if (!Number.isInteger(this.settings.channelBrowser.nextPage) || this.settings.channelBrowser.nextPage < 1) {
      this.settings.channelBrowser.nextPage = 1;
    }
    if (!Number.isFinite(this.settings.channelBrowser.totalChannels)) {
      this.settings.channelBrowser.totalChannels = null;
    }
    this.settings.channelBrowser.exhausted = Boolean(this.settings.channelBrowser.exhausted);
    if (!this.settings.responseCache || typeof this.settings.responseCache !== "object") {
      this.settings.responseCache = {};
    }
    if (typeof this.settings.publishCodeBlockFilter !== "string") {
      this.settings.publishCodeBlockFilter = "";
    }
    this.settings.publishStripCallouts = Boolean(this.settings.publishStripCallouts);
    this.applyI18n();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.arena = new ArenaClient(this.settings.token);
    this.cacheDirty = false;
    this.applyI18n();
  }

  async persistData() {
    await this.saveData(this.settings);
    this.cacheDirty = false;
  }

  getChannelFolderMappings() {
    if (!this.settings.channelFolders || typeof this.settings.channelFolders !== "object" || Array.isArray(this.settings.channelFolders)) {
      this.settings.channelFolders = {};
    }
    return this.settings.channelFolders;
  }

  recordChannelFolder(channelSlug, folderPath) {
    const slug = String(channelSlug || "").trim();
    const folder = folderPath ? normalizePath(folderPath) : "";
    if (!slug || !folder) return;

    const channelFolders = this.getChannelFolderMappings();
    if (channelFolders[slug] === folder) return;
    channelFolders[slug] = folder;
    this.cacheDirty = true;
  }

  forgetChannelFolder(channelSlug, folderPath = "") {
    const slug = String(channelSlug || "").trim();
    if (!slug) return;

    const channelFolders = this.getChannelFolderMappings();
    const current = channelFolders[slug];
    if (!current) return;

    const folder = folderPath ? normalizePath(folderPath) : "";
    if (folder && normalizePath(current) !== folder) return;

    delete channelFolders[slug];
    this.cacheDirty = true;
  }

  getDefaultChannelFolder(channelSlug, channelTitle = "") {
    const folderName = sanitizeFolderName(channelTitle) || channelSlug;
    return normalizePath(`${this.settings.folder}/${folderName}`);
  }

  trackChannelFolderCandidate(channelFolders, channelSlug, folderPath) {
    const slug = String(channelSlug || "").trim();
    const folder = folderPath ? normalizePath(folderPath) : "";
    if (!slug || !folder) return;

    let counts = channelFolders.get(slug);
    if (!counts) {
      counts = new Map();
      channelFolders.set(slug, counts);
    }
    counts.set(folder, (counts.get(folder) || 0) + 1);
  }

  getPreferredChannelFolder(channelSlug, channelFolders) {
    const slug = String(channelSlug || "").trim();
    if (!slug || !(channelFolders instanceof Map)) return null;

    const counts = channelFolders.get(slug);
    if (!(counts instanceof Map) || counts.size === 0) return null;

    let folder = "";
    let count = 0;
    for (const [candidate, hits] of counts.entries()) {
      if (hits <= count) continue;
      folder = candidate;
      count = hits;
    }

    return folder ? { folder, count, counts } : null;
  }

  resolveChannelFolder(channelSlug, channelTitle = "", channelFolders = null) {
    const slug = String(channelSlug || "").trim();
    if (!slug) return normalizePath(this.settings.folder);

    const stored = this.getChannelFolderMappings()[slug] || "";
    const preferred = this.getPreferredChannelFolder(slug, channelFolders);
    const storedCount = stored && preferred?.counts ? (preferred.counts.get(stored) || 0) : 0;

    let resolved = stored || this.getDefaultChannelFolder(slug, channelTitle);
    if (preferred?.folder && (!stored || preferred.count > storedCount)) {
      resolved = preferred.folder;
    }

    this.recordChannelFolder(slug, resolved);
    return resolved;
  }

  getChannelIdentifier(channel, fallback = "") {
    const identifier = channel?.slug || channel?.id || fallback;
    return String(identifier || "").trim();
  }

  isNumericChannelIdentifier(identifier) {
    return /^\d+$/.test(String(identifier || "").trim());
  }

  findSelectableChannelByIdentifier(identifier, channels = null) {
    const target = String(identifier || "").trim();
    if (!target) return null;

    const list = Array.isArray(channels) ? channels : (Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache : []);
    return list.find((channel) => this.getChannelIdentifier(channel) === target) || null;
  }

  async resolveChannelReference(identifier) {
    const target = String(identifier || "").trim();
    if (!target) return null;

    const cached = this.findSelectableChannelByIdentifier(target);
    if (cached) return cached;

    if (this.settings.username) {
      let state = await this.getSelectableChannels();
      let found = this.findSelectableChannelByIdentifier(target, state.channels);
      while (!found && state.hasMore) {
        state = await this.loadMoreSelectableChannels();
        found = this.findSelectableChannelByIdentifier(target, state.channels);
      }
      if (found) return found;
    }

    if (!this.isNumericChannelIdentifier(target)) {
      return this.getArenaJson(`/channels/${target}`);
    }

    return null;
  }

  async getSelectableChannels() {
    if (!this.settings.username) return { channels: [], total: 0, hasMore: false };
    const current = Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache : [];
    const state = this.getChannelBrowserState();
    if (current.length > 0 || state.exhausted) {
      return this.buildSelectableChannelsResult(current);
    }
    return this.loadMoreSelectableChannels();
  }

  getChannelBrowserState() {
    if (!this.settings.channelBrowser || typeof this.settings.channelBrowser !== "object") {
      this.settings.channelBrowser = createChannelBrowserState();
    }

    if (!Number.isInteger(this.settings.channelBrowser.nextPage) || this.settings.channelBrowser.nextPage < 1) {
      this.settings.channelBrowser.nextPage = 1;
    }
    if (!Number.isFinite(this.settings.channelBrowser.totalChannels)) {
      this.settings.channelBrowser.totalChannels = null;
    }
    this.settings.channelBrowser.exhausted = Boolean(this.settings.channelBrowser.exhausted);
    return this.settings.channelBrowser;
  }

  buildSelectableChannelsResult(channels = null) {
    const list = Array.isArray(channels) ? channels : (Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache : []);
    const state = this.getChannelBrowserState();
    const total = Number.isFinite(state.totalChannels) ? state.totalChannels : list.length;
    const hasMore = !state.exhausted && (!Number.isFinite(state.totalChannels) || list.length < state.totalChannels);
    return {
      channels: list,
      total,
      hasMore,
    };
  }

  resetChannelBrowserState(clearLocalList = true) {
    this.settings.channelBrowser = createChannelBrowserState();
    if (clearLocalList) this.settings.channelsCache = [];
    this.cacheDirty = true;
  }

  getResponseCache() {
    if (!this.settings.responseCache || typeof this.settings.responseCache !== "object") {
      this.settings.responseCache = {};
    }
    return this.settings.responseCache;
  }

  getCacheTouches() {
    if (!this.cacheTouches || typeof this.cacheTouches !== "object") {
      this.cacheTouches = {};
    }
    return this.cacheTouches;
  }

  touchCacheKey(cacheKey, timestamp = Date.now()) {
    this.getCacheTouches()[cacheKey] = timestamp;
  }

  getCacheRecency(cacheKey, entry) {
    const runtimeTouch = this.getCacheTouches()[cacheKey] || 0;
    return Math.max(entry?.updatedAt || 0, runtimeTouch);
  }

  buildCacheKey(path, params = {}) {
    const entries = Object.entries(params).filter(([, value]) => value != null);
    if (entries.length === 0) return path;
    const query = entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    return `${path}?${query}`;
  }

  pruneResponseCache() {
    const cache = this.getResponseCache();
    const touches = this.getCacheTouches();
    const entries = Object.entries(cache);
    if (entries.length <= ARENA_RESPONSE_CACHE_LIMIT) return;

    entries
      .sort((left, right) => this.getCacheRecency(right[0], right[1]) - this.getCacheRecency(left[0], left[1]))
      .slice(ARENA_RESPONSE_CACHE_LIMIT)
      .forEach(([key]) => {
        delete cache[key];
        delete touches[key];
      });
  }

  async getArenaJson(path, params = {}) {
    const cache = this.getResponseCache();
    const cacheKey = this.buildCacheKey(path, params);
    const entry = cache[cacheKey];
    const response = await this.arena.getRevalidated(path, params, entry?.etag || null);

    if (response.status === 304) {
      if (!entry) {
        throw new Error(this.t("notices.missingLocalCache", { path }));
      }
      this.touchCacheKey(cacheKey);
      return entry.data;
    }

    this.touchCacheKey(cacheKey);
    cache[cacheKey] = {
      etag: response.etag,
      data: response.data,
      updatedAt: Date.now(),
    };
    this.pruneResponseCache();
    this.cacheDirty = true;
    return response.data;
  }

  setArenaJsonCache(path, params = {}, data, etag = null) {
    if (data == null) return;
    const cache = this.getResponseCache();
    const cacheKey = this.buildCacheKey(path, params);
    const timestamp = Date.now();
    this.touchCacheKey(cacheKey, timestamp);
    cache[cacheKey] = {
      etag,
      data,
      updatedAt: timestamp,
    };
    this.pruneResponseCache();
    this.cacheDirty = true;
  }

  invalidateArenaCache(prefixes = []) {
    if (!Array.isArray(prefixes) || prefixes.length === 0) return;
    const cache = this.getResponseCache();
    const touches = this.getCacheTouches();
    let changed = false;

    Object.keys(cache).forEach((key) => {
      if (!prefixes.some((prefix) => key.startsWith(prefix))) return;
      delete cache[key];
      delete touches[key];
      changed = true;
    });

    if (changed) this.cacheDirty = true;
  }

  updateChannelsCacheEntry(channel) {
    if (!channel) return;
    const channelKey = this.getChannelIdentifier(channel);
    const current = Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache : [];
    const next = current.filter((item) => this.getChannelIdentifier(item) !== channelKey);
    next.unshift(channel);
    this.settings.channelsCache = next;
    const state = this.getChannelBrowserState();
    if (Number.isFinite(state.totalChannels)) {
      state.totalChannels = Math.max(state.totalChannels, next.length);
    }
    state.exhausted = false;
    this.cacheDirty = true;
  }

  invalidateUserChannelCaches(clearLocalList = true) {
    if (this.settings.username) {
      this.invalidateArenaCache([
        `/users/${this.settings.username}`,
        `/users/${this.settings.username}/contents`,
      ]);
    }
    this.resetChannelBrowserState(clearLocalList);
    this.cacheDirty = true;
  }

  trackChannelMutation(channel) {
    const channelIdentifier = this.getChannelIdentifier(channel);
    if (channel?.slug) {
      this.setArenaJsonCache(`/channels/${channel.slug}`, {}, channel);
    }
    if (channelIdentifier) {
      this.invalidateArenaCache([`/channels/${channelIdentifier}/contents`]);
    }
    this.invalidateUserChannelCaches(false);
    this.updateChannelsCacheEntry(channel);
  }

  forgetDeletedChannel(channelIdentifier, folderPath = "") {
    const identifier = String(channelIdentifier || "").trim();
    if (!identifier) return;

    this.forgetChannelFolder(identifier, folderPath);
    this.invalidateArenaCache([
      `/channels/${identifier}`,
      `/channels/${identifier}/contents`,
    ]);
    if (Array.isArray(this.settings.channelsCache)) {
      this.settings.channelsCache = this.settings.channelsCache.filter((channel) => this.getChannelIdentifier(channel) !== identifier);
    }
    this.resetChannelBrowserState(true);
    this.cacheDirty = true;
  }

  isArenaNotFoundError(error) {
    return Number(error?.status || error?.payload?.code || 0) === 404;
  }

  trackBlockMutation(block, channelIdentifier = "") {
    if (block?.id != null) {
      this.setArenaJsonCache(`/blocks/${block.id}`, {}, block);
    }
    if (channelIdentifier) {
      this.invalidateArenaCache([
        `/channels/${channelIdentifier}`,
        `/channels/${channelIdentifier}/contents`,
      ]);
    }
  }

  getCacheDiagnostics() {
    const cacheKeys = Object.keys(this.getResponseCache());
    const stats = {
      total: cacheKeys.length,
      users: 0,
      channels: 0,
      blocks: 0,
      other: 0,
      localChannels: Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache.length : 0,
    };

    for (const key of cacheKeys) {
      if (key.startsWith("/blocks/")) stats.blocks++;
      else if (key.startsWith("/channels/")) stats.channels++;
      else if (key.startsWith("/users/")) stats.users++;
      else stats.other++;
    }

    return stats;
  }

  async clearChannelCaches() {
    this.invalidateUserChannelCaches();
    this.invalidateArenaCache(["/channels/"]);
    await this.persistData();
  }

  async clearBlockCaches() {
    this.invalidateArenaCache(["/blocks/"]);
    await this.persistData();
  }

  async clearAllCaches() {
    this.resetChannelBrowserState(true);
    this.settings.responseCache = {};
    this.cacheTouches = {};
    this.cacheDirty = true;
    await this.persistData();
  }

  async refreshSelectableChannels() {
    return this.loadMoreSelectableChannels({ reset: true });
  }

  async loadMoreSelectableChannels(options = {}) {
    if (!this.settings.username) return { channels: [], total: 0, hasMore: false };
    const { reset = false, batchSize = CHANNEL_SELECT_BATCH_SIZE } = options;
    if (reset) this.resetChannelBrowserState(true);

    const state = this.getChannelBrowserState();
    const channels = Array.isArray(this.settings.channelsCache) ? [...this.settings.channelsCache] : [];
    if (state.exhausted) return this.buildSelectableChannelsResult(channels);

    const notice = new Notice(
      channels.length > 0 ? this.t("common.loadingMoreChannels") : this.t("notices.loadingYourChannels"),
      0
    );
    try {
      const user = await this.getArenaJson(`/users/${this.settings.username}`);
      state.totalChannels = Number.isFinite(user.counts?.channels) ? user.counts.channels : null;
      if (Number.isFinite(state.totalChannels) && channels.length >= state.totalChannels) {
        state.exhausted = true;
        return this.buildSelectableChannelsResult(channels);
      }

      const seen = new Set(channels.map((channel) => this.getChannelIdentifier(channel)));
      let added = 0;
      let scannedPages = 0;

      while (added < batchSize && scannedPages < ARENA_MAX_PAGES_PER_RUN) {
        const page = state.nextPage;
        const totalLabel = Number.isFinite(state.totalChannels) ? `${channels.length}/${state.totalChannels}` : `${channels.length}`;
        notice.setMessage(this.t("notices.loadingChannelsPage", { page, total: totalLabel }));
        const data = await this.getArenaJson(`/users/${this.settings.username}/contents`, { page });
        state.nextPage = page + 1;
        scannedPages++;
        const items = (data.data || []).filter((item) => item.type === "Channel");
        for (const channel of items) {
          const key = this.getChannelIdentifier(channel);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          channels.push(channel);
          added++;
        }

        if (Number.isFinite(state.totalChannels) && channels.length >= state.totalChannels) {
          state.exhausted = true;
          break;
        }
        if (!data.meta?.has_more_pages) {
          state.exhausted = true;
          break;
        }
      }

      this.settings.channelsCache = channels;
      if (!state.exhausted && added < batchSize) {
        new Notice(this.t("notices.partialChannelsLoaded", { count: batchSize }));
      }
      await this.persistData();
      return this.buildSelectableChannelsResult(channels);
    } finally {
      if (this.cacheDirty) await this.persistData();
      notice.hide();
    }
  }

  async buildVaultIndexes() {
    const index = new Map();
    const channelFolders = new Map();
    const uncachedFiles = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter?.blockid != null) {
        index.set(String(frontmatter.blockid), file);
      }
      if (frontmatter?.channel && file.parent?.path) {
        this.trackChannelFolderCandidate(channelFolders, frontmatter.channel, file.parent.path);
      }
      if (frontmatter?.blockid == null || !frontmatter?.channel) {
        uncachedFiles.push(file);
      }
    }

    for (const file of uncachedFiles) {
      const raw = await this.app.vault.cachedRead(file);
      const frontmatter = this.getFileFrontmatter(file, raw);
      const blockId = frontmatter.blockid;
      if (blockId != null) {
        index.set(String(blockId), file);
      }
      if (frontmatter.channel && file.parent?.path) {
        this.trackChannelFolderCandidate(channelFolders, frontmatter.channel, file.parent.path);
      }
    }

    return { blockIndex: index, channelFolders };
  }

  async buildBlockFileIndex() {
    const { blockIndex } = await this.buildVaultIndexes();
    return blockIndex;
  }

  getFileFrontmatter(file, rawContent = null) {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached) return cached;
    if (rawContent == null) return {};

    const fallback = {};
    for (const key of ["blockid", "title", "channel", SYNC_SKIP_FLAG]) {
      const value = extractFrontmatterScalar(rawContent, key);
      if (value != null) fallback[key] = value;
    }
    return fallback;
  }

  async readNoteState(file) {
    const content = await this.app.vault.read(file);
    const { body } = splitNoteContent(content);
    const frontmatter = this.getFileFrontmatter(file, content);
    return { content, body, frontmatter };
  }

  getPublishCodeBlockFilterLanguages() {
    return String(this.settings.publishCodeBlockFilter || "")
      .split(",")
      .map((value) => normalizeCodeFenceLanguage(value))
      .filter(Boolean);
  }

  prepareBodyForArena(body) {
    const codeBlockResult = filterMarkdownCodeBlocks(body, this.getPublishCodeBlockFilterLanguages());
    return filterMarkdownCallouts(codeBlockResult.content, {
      stripCallouts: this.settings.publishStripCallouts,
    });
  }

  noteHasPublishOnlyContent(body) {
    return this.prepareBodyForArena(body).content !== String(body || "");
  }

  async getFolderLinkedChannelSlug(folder, files = null) {
    const folderPath = normalizePath(folder?.path || "");
    if (!folderPath) return "";

    const mappedSlugs = Object.entries(this.getChannelFolderMappings())
      .filter(([, path]) => normalizePath(path || "") === folderPath)
      .map(([slug]) => String(slug || "").trim())
      .filter(Boolean);
    if (mappedSlugs.length === 1) return mappedSlugs[0];

    const noteFiles = Array.isArray(files)
      ? files
      : folder.children.filter((file) => file instanceof TFile && file.extension === "md");
    const noteSlugs = new Set();

    for (const file of noteFiles) {
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (cached?.channel) {
        noteSlugs.add(String(cached.channel).trim());
        continue;
      }
      const raw = await this.app.vault.cachedRead(file);
      const frontmatter = this.getFileFrontmatter(file, raw);
      if (frontmatter.channel) noteSlugs.add(String(frontmatter.channel).trim());
    }

    return noteSlugs.size === 1 ? [...noteSlugs][0] : "";
  }

  getFolderLinkedChannelSlugFromCache(folder, files = null) {
    const folderPath = normalizePath(folder?.path || "");
    if (!folderPath) return "";

    const mappedSlugs = Object.entries(this.getChannelFolderMappings())
      .filter(([, path]) => normalizePath(path || "") === folderPath)
      .map(([slug]) => String(slug || "").trim())
      .filter(Boolean);
    if (mappedSlugs.length === 1) return mappedSlugs[0];

    const noteFiles = Array.isArray(files)
      ? files
      : folder.children.filter((file) => file instanceof TFile && file.extension === "md");
    const noteSlugs = new Set();

    for (const file of noteFiles) {
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!cached?.channel) continue;
      noteSlugs.add(String(cached.channel).trim());
    }

    return noteSlugs.size === 1 ? [...noteSlugs][0] : "";
  }

  createTransferState() {
    return {
      downloadedAssets: 0,
      assetLimitNoticeShown: false,
      blockedAssets: 0,
      blockedAssetTypes: [],
    };
  }

  trackBlockedAsset(transferState, contentType = "", extension = "") {
    if (!transferState) return;
    transferState.blockedAssets++;

    const typeLabel = contentType || this.t("common.noContentType");
    const extensionLabel = extension || this.t("common.noExtension");
    const label = `${typeLabel} / ${extensionLabel}`;
    if (!transferState.blockedAssetTypes.includes(label) && transferState.blockedAssetTypes.length < 5) {
      transferState.blockedAssetTypes.push(label);
    }
  }

  showBlockedAssetsNotice(transferState) {
    if (!transferState?.blockedAssets) return;

    const count = transferState.blockedAssets;
    const suffix = count === 1 ? "" : "s";
    const sample = transferState.blockedAssetTypes.length > 0
      ? this.t("notices.blockedAssetsSample", { types: transferState.blockedAssetTypes.join(", ") })
      : "";
    new Notice(
      this.t("notices.blockedAssets", { count, suffix, sample }),
      8000
    );
  }

  async confirmNextPageLoad(label, page, processed, total = Infinity) {
    if (page >= ARENA_MAX_PAGES_PER_RUN) {
      new Notice(this.t("notices.importStopped", { count: ARENA_MAX_PAGES_PER_RUN }));
      return false;
    }

    const totalLabel = Number.isFinite(total) ? `${processed}/${total}` : `${processed}`;
    return new Promise((resolve) => {
      new ConfirmModal(
        this.app,
        this.t("notices.confirmNextPage", { page, label, total: totalLabel }),
        resolve,
        {
          t: this.t,
        }
      ).open();
    });
  }

  canDownloadMoreAssets(transferState) {
    if (!transferState) return true;
    if (transferState.downloadedAssets < ARENA_MAX_ASSET_DOWNLOADS_PER_RUN) return true;

    if (!transferState.assetLimitNoticeShown) {
      transferState.assetLimitNoticeShown = true;
      new Notice(this.t("notices.assetLimitReached", { count: ARENA_MAX_ASSET_DOWNLOADS_PER_RUN }));
    }

    return false;
  }

  getAssetsFolder(targetFolder) {
    const folderName = sanitizeFolderName(this.settings.attachmentsFolderName || "_assets") || "_assets";
    return normalizePath(`${targetFolder}/${folderName}`);
  }

  getFileExtensionFromUrl(url) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname || "";
      const match = pathname.match(/\.([a-zA-Z0-9]{1,10})$/);
      return match ? `.${match[1].toLowerCase()}` : "";
    } catch {
      return "";
    }
  }

  getFileExtensionFromContentType(contentType) {
    if (!contentType) return "";
    const normalized = contentType.split(";")[0].trim().toLowerCase();
    const known = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "application/pdf": ".pdf",
      "application/epub+zip": ".epub",
      "text/plain": ".txt",
      "text/markdown": ".md",
      "audio/mpeg": ".mp3",
      "audio/mp4": ".m4a",
      "audio/x-m4a": ".m4a",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
      "audio/webm": ".webm",
      "audio/ogg": ".ogg",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
      "video/webm": ".webm",
      "video/ogg": ".ogg",
    };
    return known[normalized] || "";
  }

  normalizeContentType(contentType) {
    return (contentType || "").split(";")[0].trim().toLowerCase();
  }

  isGenericBinaryContentType(contentType) {
    return contentType === "application/octet-stream" || contentType === "binary/octet-stream";
  }

  validateAssetDownload(contentType, url, extension) {
    const normalizedContentType = this.normalizeContentType(contentType);
    const normalizedExtension = (extension || "").trim().toLowerCase();
    const hasAllowedMime = normalizedContentType && ALLOWED_ATTACHMENT_MIME_TYPES.includes(normalizedContentType);
    const hasAllowedExtension = normalizedExtension && ALLOWED_ATTACHMENT_EXTENSIONS.includes(normalizedExtension);

    if (hasAllowedMime && hasAllowedExtension) {
      return;
    }

    if (!normalizedContentType || this.isGenericBinaryContentType(normalizedContentType)) {
      if (hasAllowedExtension) return;
      const error = new Error(this.t("notices.attachmentBlocked", {
        contentType: normalizedContentType || this.t("common.noContentType"),
        url,
      }));
      error.assetBlockedByPolicy = true;
      error.assetBlockedContentType = normalizedContentType || "";
      error.assetBlockedExtension = normalizedExtension;
      throw error;
    }

    const error = new Error(this.t("notices.attachmentBlockedByPolicy", { contentType: normalizedContentType, url }));
    error.assetBlockedByPolicy = true;
    error.assetBlockedContentType = normalizedContentType;
    error.assetBlockedExtension = normalizedExtension;
    throw error;
  }

  async saveBinaryAsset(path, arrayBuffer) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, arrayBuffer);
      return existing;
    }
    return this.app.vault.createBinary(path, arrayBuffer);
  }

  async downloadAsset(url, targetFolder, baseName, transferState = null) {
    if (!url) return null;

    await this.arena.paceRequest();
    const response = await requestUrl({
      url,
      method: "GET",
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(this.t("notices.attachmentDownloadFailed", { status: response.status }));
    }

    const contentType = getHeaderValue(response.headers, "content-type");
    const extension =
      this.getFileExtensionFromContentType(contentType) ||
      this.getFileExtensionFromUrl(url);
    this.validateAssetDownload(contentType, url, extension);
    const filename = sanitizeFilename(baseName) + extension;
    const assetPath = normalizePath(`${targetFolder}/${filename}`);
    await this.saveBinaryAsset(assetPath, response.arrayBuffer);
    if (transferState) transferState.downloadedAssets++;
    return assetPath;
  }

  getRelativeAssetPath(notePath, assetPath) {
    const noteParts = notePath.split("/");
    const assetParts = assetPath.split("/");

    noteParts.pop();

    while (noteParts.length > 0 && assetParts.length > 0 && noteParts[0] === assetParts[0]) {
      noteParts.shift();
      assetParts.shift();
    }

    const up = noteParts.map(() => "..");
    const relativeParts = up.concat(assetParts);
    return relativeParts.length > 0 ? relativeParts.join("/") : ".";
  }

  async buildImportedBlockContent(block, targetFolder, notePath, transferState = null) {
    if (!this.settings.downloadAttachments) {
      return blockToContent(block);
    }

    const type = block.class || block.type || "";
    const assetsFolder = this.getAssetsFolder(targetFolder);

    try {
      if (type === "Image" && block.image?.src) {
        if (!this.canDownloadMoreAssets(transferState)) return blockToContent(block);
        await this.ensureFolder(assetsFolder);
        const assetPath = await this.downloadAsset(
          block.image.src,
          assetsFolder,
          `${block.title || this.t("common.image")}-${block.id}`,
          transferState
        );
        const imageSrc = this.getRelativeAssetPath(notePath, assetPath);
        return blockToContent(block, { imageSrc, useObsidianLinks: true });
      }

      if (type === "Attachment" && block.attachment?.url) {
        if (!this.canDownloadMoreAssets(transferState)) return blockToContent(block);
        await this.ensureFolder(assetsFolder);
        const assetPath = await this.downloadAsset(
          block.attachment.url,
          assetsFolder,
          `${block.title || this.t("common.attachment")}-${block.id}`,
          transferState
        );
        const attachmentUrl = this.getRelativeAssetPath(notePath, assetPath);
        return blockToContent(block, { attachmentUrl, useObsidianLinks: true });
      }
    } catch (error) {
      if (error?.assetBlockedByPolicy) {
        this.trackBlockedAsset(transferState, error.assetBlockedContentType, error.assetBlockedExtension);
      }
      console.error("asset download error:", error);
    }

    return blockToContent(block);
  }

  getUniqueNotePath(folder, noteTitle) {
    let attempt = 1;
    let candidate = normalizePath(`${folder}/${noteTitle}.md`);
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      attempt++;
      candidate = normalizePath(`${folder}/${noteTitle} ${attempt}.md`);
    }
    return candidate;
  }

  async mergeArenaFrontmatter(file, block, channelSlug = "", existingFrontmatter = {}) {
    const arenaFrontmatter = getArenaFrontmatter(block, channelSlug, existingFrontmatter);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const key of ARENA_FRONTMATTER_KEYS) {
        if (Object.prototype.hasOwnProperty.call(arenaFrontmatter, key)) {
          frontmatter[key] = arenaFrontmatter[key];
        } else {
          delete frontmatter[key];
        }
      }
      if (arenaFrontmatter[SYNC_SKIP_FLAG]) frontmatter[SYNC_SKIP_FLAG] = true;
    });
  }

  async syncFolderToChannel(folder, files, channel, options = {}) {
    const { forceRepublishAll = false, notice = null } = options;
    const progressNotice = notice || new Notice(this.t("notices.uploadingNotesProgress", { uploaded: 0, total: files.length }), 0);
    const shouldHideNotice = !notice;

    try {
      const channelIdentifier = this.getChannelIdentifier(channel);
      if (folder.path && channelIdentifier) this.recordChannelFolder(channelIdentifier, folder.path);
      const channelRef = channel.id || channel.slug;
      let uploaded = 0;
      let skipped = 0;

      for (const file of files) {
        progressNotice.setMessage(this.t("notices.uploadingNotesProgress", { uploaded, total: files.length }));
        const { frontmatter, body } = await this.readNoteState(file);
        if (isSyncSkipped(frontmatter)) {
          skipped++;
          continue;
        }
        const { content: publishBody } = this.prepareBodyForArena(body);

        let block = null;
        const currentChannelIdentifier = String(channelIdentifier || channelRef || "").trim();
        const noteChannelSlug = String(frontmatter.channel || "").trim();
        const canReuseRemoteBlock = !forceRepublishAll && frontmatter.blockid && (!noteChannelSlug || noteChannelSlug === currentChannelIdentifier);

        if (canReuseRemoteBlock) {
          try {
            block = await this.arena.updateBlock(frontmatter.blockid, publishBody, frontmatter.title || file.basename);
          } catch (error) {
            if (!this.isArenaNotFoundError(error)) throw error;
          }
        }

        if (!block) {
          block = await this.arena.pushBlock(channelRef, publishBody, file.basename);
        }

        this.trackBlockMutation(block, channelIdentifier);
        await this.mergeArenaFrontmatter(file, block, channelIdentifier, frontmatter);
        uploaded++;
      }

      const summary = skipped > 0
        ? this.t("notices.folderUploadSummarySkipped", {
          uploaded,
          title: channel.title,
          skipped,
          flag: SYNC_SKIP_FLAG,
        })
        : this.t("notices.folderUploadSummary", { uploaded, title: channel.title });
      new Notice(summary);
    } finally {
      if (shouldHideNotice) progressNotice.hide();
    }
  }

  registerCommands() {
    this.addCommand({
      id: "get-blocks-from-channel",
      name: this.t("commands.getBlocksFromChannel"),
      callback: () => this.cmdGetBlocksFromChannel(),
    });
    this.addCommand({
      id: "browse-my-channels",
      name: this.t("commands.browseMyChannels"),
      callback: () => this.cmdBrowseMyChannels(),
    });
    this.addCommand({
      id: "create-channel",
      name: this.t("commands.createChannel"),
      callback: () => this.cmdCreateChannel(),
    });
    this.addCommand({
      id: "refresh-channels-cache",
      name: this.t("commands.refreshChannelsCache"),
      callback: () => this.cmdRefreshChannelsCache(),
    });
    this.addCommand({
      id: "sync-current-note-folder-with-channel",
      name: this.t("commands.syncCurrentNoteFolderWithChannel"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.parent instanceof TFolder) {
          if (!checking) this.cmdUploadFolderAsChannel(file.parent);
          return true;
        }
      },
    });
    this.addCommand({
      id: "update-current-note-folder-from-channel",
      name: this.t("commands.updateCurrentNoteFolderFromChannel"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.parent instanceof TFolder) {
          if (!checking) this.cmdPullFolderFromChannel(file.parent);
          return true;
        }
      },
    });
    this.addCommand({
      id: "pull-block",
      name: this.t("commands.pullBlock"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          if (!checking) this.cmdPullBlock();
          return true;
        }
      },
    });
    this.addCommand({
      id: "push-note",
      name: this.t("commands.pushNote"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          if (!checking) this.cmdPushNote();
          return true;
        }
      },
    });
    this.addCommand({
      id: "get-block-by-id",
      name: this.t("commands.getBlockById"),
      callback: () => this.cmdGetBlockById(),
    });
    this.addCommand({
      id: "open-block-in-arena",
      name: this.t("commands.openBlockInArena"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          if (!checking) this.cmdOpenInArena();
          return true;
        }
      },
    });
  }

  registerFolderMenu() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          const markdownFiles = file.children.filter((child) => child instanceof TFile && child.extension === "md");
          const linkedChannelSlug = this.getFolderLinkedChannelSlugFromCache(file, markdownFiles);

          menu.addItem((item) => {
            item
              .setTitle(this.t("commands.syncFolderWithChannel"))
              .setIcon("upload")
              .onClick(() => this.cmdUploadFolderAsChannel(file));
          });

          if (linkedChannelSlug) {
            menu.addItem((item) => {
              item
                .setTitle(this.t("commands.updateFolderFromChannel"))
                .setIcon("download")
                .onClick(() => this.cmdPullFolderFromChannel(file));
            });
          }
          return;
        }

        if (!(file instanceof TFile) || file.extension !== "md") return;

        menu.addItem((item) => {
          item
            .setTitle(this.t("commands.pullBlock"))
            .setIcon("download")
            .onClick(() => this.cmdPullBlock(file));
        });
        menu.addItem((item) => {
          item
            .setTitle(this.t("commands.pushNote"))
            .setIcon("upload")
            .onClick(() => this.cmdPushNote(file));
        });
        menu.addItem((item) => {
          item
            .setTitle(this.t("commands.openBlockInArena"))
            .setIcon("external-link")
            .onClick(() => this.cmdOpenInArena(file));
        });
      })
    );
  }

  async cmdGetBlocksFromChannel() {
    if (!this.checkSettings()) return;
    new InputModal(
      this.app,
      this.t("prompts.getBlocksFromChannelTitle"),
      this.t("prompts.getBlocksFromChannelPlaceholder"),
      async (input) => {
        const slug = this.extractSlug(input);
        await this.fetchAndSaveChannel(slug);
      },
      { submitText: this.t("common.accept") }
    ).open();
  }

  async cmdBrowseMyChannels() {
    if (!this.checkSettings()) return;
    if (!this.settings.username) {
      new Notice(this.t("notices.usernameMissing"));
      return;
    }
    try {
      const channelState = await this.getSelectableChannels();
      if (channelState.channels.length === 0) {
        new Notice(this.t("notices.noChannelsFound"));
        return;
      }
      new ChannelSelectModal(this.app, channelState.channels, async (channel) => {
        await this.fetchAndSaveChannel(this.getChannelIdentifier(channel), { channel });
      }, {
        t: this.t,
        hasMore: channelState.hasMore,
        totalChannels: channelState.total,
        onLoadMore: async () => this.loadMoreSelectableChannels(),
        onRefresh: async () => {
          this.invalidateUserChannelCaches();
          await this.persistData();
          return this.refreshSelectableChannels();
        },
      }).open();
    } catch (error) {
      console.error("getUserChannels error:", error);
      new Notice(this.t("notices.errorLoadingChannels", { error: error.message }));
    }
  }

  async cmdCreateChannel() {
    if (!this.checkSettings()) return;
    new CreateChannelModal(this.app, async (title, visibility) => {
      try {
        const channel = await this.arena.createChannel(title, visibility);
        this.trackChannelMutation(channel);
        await this.persistData();
        new Notice(this.t("notices.channelCreated", { title: channel.title }));
      } catch (error) {
        new Notice(this.t("notices.errorCreatingChannel", { error: error.message }));
      }
    }, "", { t: this.t }).open();
  }

  async cmdRefreshChannelsCache() {
    if (!this.checkSettings()) return;
    this.invalidateUserChannelCaches();
    await this.persistData();
    new Notice(this.t("notices.channelsCacheCleared"));
  }

  async cmdUploadFolderAsChannel(folder) {
    if (!this.checkSettings()) return;
    const files = folder.children.filter((file) => file instanceof TFile && file.extension === "md");
    if (files.length === 0) {
      new Notice(this.t("notices.folderHasNoNotes"));
      return;
    }
    const linkedChannelIdentifier = await this.getFolderLinkedChannelSlug(folder, files);
    if (linkedChannelIdentifier) {
      try {
        let existingChannel = await this.resolveChannelReference(linkedChannelIdentifier);
        if (!existingChannel && this.isNumericChannelIdentifier(linkedChannelIdentifier)) {
          existingChannel = { id: Number(linkedChannelIdentifier), title: linkedChannelIdentifier };
        }
        if (!existingChannel) {
          throw Object.assign(new Error(`Channel ${linkedChannelIdentifier} not found`), { status: 404 });
        }
        new Notice(this.t("notices.folderAlreadyLinkedChannel", { channel: linkedChannelIdentifier }));
        await this.syncFolderToChannel(folder, files, existingChannel);
        await this.persistData();
        return;
      } catch (error) {
        if (!this.isArenaNotFoundError(error)) {
          new Notice(this.t("notices.genericError", { error: error.message }));
          return;
        }
        this.forgetDeletedChannel(linkedChannelIdentifier, folder.path);
        await this.persistData();
        new Notice(this.t("notices.folderLinkedChannelDeleted", { channel: linkedChannelIdentifier }));
      }
    }

    new CreateChannelModal(this.app, async (title, visibility) => {
      const notice = new Notice(this.t("notices.creatingChannel", { title }), 0);
      try {
        const channel = await this.arena.createChannel(title, visibility);
        this.trackChannelMutation(channel);
        await this.syncFolderToChannel(folder, files, channel, {
          forceRepublishAll: Boolean(linkedChannelIdentifier),
          notice,
        });
        notice.hide();
        await this.persistData();
      } catch (error) {
        notice.hide();
        new Notice(this.t("notices.genericError", { error: error.message }));
      }
    }, folder.name, { t: this.t }).open();
  }

  async cmdPullFolderFromChannel(folder) {
    if (!this.checkSettings()) return;
    const files = folder.children.filter((file) => file instanceof TFile && file.extension === "md");
    const linkedChannelIdentifier = await this.getFolderLinkedChannelSlug(folder, files);
    if (!linkedChannelIdentifier) {
      new Notice(this.t("notices.folderMissingLinkedChannel"));
      return;
    }

    this.recordChannelFolder(linkedChannelIdentifier, folder.path);
    const channel = await this.resolveChannelReference(linkedChannelIdentifier);
    await this.fetchAndSaveChannel(linkedChannelIdentifier, channel ? { channel } : {});
  }

  async cmdPullBlock(file = null) {
    if (!this.checkSettings()) return;
    file = file || this.app.workspace.getActiveFile();
    if (!file) return;
    const { content, body, frontmatter } = await this.readNoteState(file);
    if (isSyncSkipped(frontmatter)) {
      new Notice(this.t("notices.noteMarkedSkipped", { flag: SYNC_SKIP_FLAG }));
      return;
    }
    const blockId = frontmatter.blockid;
    if (!blockId) {
      new Notice(this.t("notices.noteMissingBlockIdFrontmatter"));
      return;
    }
    if (this.noteHasPublishOnlyContent(body)) {
      new Notice(this.t("notices.pullSkippedToProtectLocalOnlyMarkdown"), 8000);
      return;
    }
    try {
      const transferState = this.createTransferState();
      const block = await this.arena.getBlock(blockId);
      const newBody = await this.buildImportedBlockContent(
        block,
        file.parent?.path || this.settings.folder,
        file.path,
        transferState
      );
      await this.app.vault.modify(file, replaceBodyPreservingFrontmatter(content, newBody));
      await this.mergeArenaFrontmatter(file, block, frontmatter.channel || "", frontmatter);
      if (frontmatter.channel && file.parent?.path) {
        this.recordChannelFolder(frontmatter.channel, file.parent.path);
      }
      new Notice(this.t("notices.noteUpdatedFromBlock", { id: blockId }));
      this.showBlockedAssetsNotice(transferState);
    } catch (error) {
      new Notice(this.t("notices.genericError", { error: error.message }));
    }
  }

  async cmdPushNote(file = null) {
    if (!this.checkSettings()) return;
    file = file || this.app.workspace.getActiveFile();
    if (!file) return;
    const { body, frontmatter } = await this.readNoteState(file);
    if (isSyncSkipped(frontmatter)) {
      new Notice(this.t("notices.noteMarkedSkipped", { flag: SYNC_SKIP_FLAG }));
      return;
    }
    const blockId = frontmatter.blockid;
    const title = frontmatter.title || file.basename;
    const { content: publishBody } = this.prepareBodyForArena(body);
    if (blockId) {
      try {
        const block = await this.arena.updateBlock(blockId, publishBody, title);
        this.trackBlockMutation(block, frontmatter.channel || "");
        await this.mergeArenaFrontmatter(file, block, frontmatter.channel || "", frontmatter);
        if (frontmatter.channel && file.parent?.path) {
          this.recordChannelFolder(frontmatter.channel, file.parent.path);
        }
        await this.persistData();
        new Notice(this.t("notices.blockUpdated", { id: blockId }));
      } catch (error) {
        if (this.isArenaNotFoundError(error)) {
          if (frontmatter.channel) {
            await this.publishNoteToArena(file, frontmatter, publishBody, title, frontmatter.channel, frontmatter.channel);
            return;
          }
          await this.promptPushNoteChannel(file, { ...frontmatter, blockid: null }, publishBody, title);
          return;
        }
        new Notice(this.t("notices.genericError", { error: error.message }));
      }
    } else {
      await this.promptPushNoteChannel(file, frontmatter, publishBody, title);
    }
  }

  async promptPushNoteChannel(file, frontmatter, body, title) {
    const openManualInput = () => {
      new InputModal(
        this.app,
        this.t("prompts.pushToArenaTitle"),
        this.t("prompts.pushToArenaPlaceholder"),
        async (slug) => {
          await this.publishNoteToArena(file, frontmatter, body, title, slug, slug);
        },
        { submitText: this.t("common.accept") }
      ).open();
    };

    if (!this.settings.username) {
      openManualInput();
      return;
    }

    try {
      const channelState = await this.getSelectableChannels();
      if (channelState.channels.length === 0) {
        openManualInput();
        return;
      }
      new ChannelSelectModal(this.app, channelState.channels, async (channel) => {
        const channelRef = channel.id || channel.slug;
        const channelSlug = channel.slug || String(channelRef);
        await this.publishNoteToArena(file, frontmatter, body, title, channelRef, channelSlug);
      }, {
        t: this.t,
        title: this.t("prompts.selectDestinationChannel"),
        hasMore: channelState.hasMore,
        totalChannels: channelState.total,
        onLoadMore: async () => this.loadMoreSelectableChannels(),
        onManualInput: openManualInput,
        manualButtonText: this.t("prompts.manualSlugInput"),
        onRefresh: async () => {
          this.invalidateUserChannelCaches();
          await this.persistData();
          return this.refreshSelectableChannels();
        },
      }).open();
    } catch (error) {
      console.error("push-note channels error:", error);
      new Notice(this.t("notices.warningLoadingChannelList", { error: error.message }));
      openManualInput();
    }
  }

  async publishNoteToArena(file, frontmatter, body, title, channelRef, channelSlug) {
    try {
      const block = await this.arena.pushBlock(channelRef, body, title);
      this.trackBlockMutation(block, channelSlug);
      await this.mergeArenaFrontmatter(file, block, channelSlug, frontmatter);
      if (file.parent?.path) this.recordChannelFolder(channelSlug, file.parent.path);
      await this.persistData();
      new Notice(this.t("notices.notePublished", { channel: channelSlug, id: block.id }));
    } catch (error) {
      new Notice(this.t("notices.genericError", { error: error.message }));
    }
  }

  async cmdGetBlockById() {
    if (!this.checkSettings()) return;
    new InputModal(
      this.app,
      this.t("prompts.getBlockByIdTitle"),
      this.t("prompts.getBlockByIdPlaceholder"),
      async (input) => {
        const id = this.extractBlockId(input);
        if (!id) {
          new Notice(this.t("notices.couldNotExtractBlockId"));
          return;
        }
        try {
          const block = await this.arena.getBlock(id);
          const transferState = this.createTransferState();
          const result = await this.saveBlock(block, "", null, null, transferState);
          if (!result.written && result.reason === "local_publish_only") {
            new Notice(this.t("notices.blockImportSkippedToProtectLocalOnlyMarkdown"), 8000);
            return;
          }
          new Notice(this.t("notices.blockImported", { id }));
          this.showBlockedAssetsNotice(transferState);
        } catch (error) {
          new Notice(this.t("notices.genericError", { error: error.message }));
        }
      },
      { submitText: this.t("common.accept") }
    ).open();
  }

  async cmdOpenInArena(file = null) {
    file = file || this.app.workspace.getActiveFile();
    if (!file) return;
    const { frontmatter } = await this.readNoteState(file);
    const blockId = frontmatter.blockid;
    const channel = String(frontmatter.channel || "").trim();
    if (!blockId) {
      new Notice(this.t("notices.noteMissingBlockId"));
      return;
    }
    const url = channel && this.settings.username && !this.isNumericChannelIdentifier(channel)
      ? `https://www.are.na/${this.settings.username}/${channel}/blocks/${blockId}`
      : `https://www.are.na/block/${blockId}`;
    window.open(url, "_blank");
  }

  async fetchAndSaveChannel(identifier, options = {}) {
    let channel = options.channel || null;
    let channelIdentifier = this.getChannelIdentifier(channel, identifier);
    new Notice(this.t("notices.downloadingChannel", { slug: channel?.title || channelIdentifier }));
    try {
      const transferState = this.createTransferState();
      if (!channel && !this.isNumericChannelIdentifier(channelIdentifier)) {
        channel = await this.resolveChannelReference(channelIdentifier);
      }
      channelIdentifier = this.getChannelIdentifier(channel, channelIdentifier);
      const channelTitle = channel?.title || channelIdentifier;
      const { blockIndex, channelFolders } = await this.buildVaultIndexes();
      const folder = this.resolveChannelFolder(channelIdentifier, channelTitle, channelFolders);
      await this.ensureFolder(folder);
      let saved = 0;
      let skippedByFlag = 0;
      let skippedToProtectLocalOnly = 0;
      let page = 1;

      while (true) {
        const data = await this.getArenaJson(`/channels/${channelIdentifier}/contents`, { page });
        const blocks = data.data || [];

        for (const block of blocks) {
          if (block.type === "Channel") continue;
          const result = await this.saveBlock(block, channelIdentifier, folder, blockIndex, transferState);
          if (result.written) saved++;
          else if (result.reason === "sync_skip") skippedByFlag++;
          else if (result.reason === "local_publish_only") skippedToProtectLocalOnly++;
        }

        if (!data.meta?.has_more_pages) break;
        if (!await this.confirmNextPageLoad(`"${channelTitle}"`, page, saved + skippedByFlag + skippedToProtectLocalOnly, data.meta?.total_count)) break;
        page++;
      }

      const summary = skippedByFlag > 0
        ? this.t("notices.channelImportSummarySkipped", {
          title: channelTitle,
          saved,
          skipped: skippedByFlag,
          flag: SYNC_SKIP_FLAG,
        })
        : this.t("notices.channelImportSummary", { title: channelTitle, saved });
      new Notice(summary);
      if (skippedToProtectLocalOnly > 0) {
        new Notice(this.t("notices.channelImportProtectedLocalOnlyMarkdown", { count: skippedToProtectLocalOnly }), 8000);
      }
      this.showBlockedAssetsNotice(transferState);
    } catch (error) {
      new Notice(this.t("notices.genericError", { error: error.message }));
    } finally {
      if (this.cacheDirty) await this.persistData();
    }
  }

  async saveBlock(block, channelSlug, folder = null, blockIndex = null, transferState = null) {
    const targetFolder = folder || normalizePath(this.settings.folder);
    await this.ensureFolder(targetFolder);
    const noteTitle = sanitizeFilename(block.title || `${this.t("common.block")} ${block.id}`);
    const index = blockIndex || await this.buildBlockFileIndex();
    const blockKey = String(block.id);
    const preferredPath = normalizePath(`${targetFolder}/${noteTitle}.md`);
    let existing = index.get(blockKey) || null;

    if (!existing) {
      const preferredFile = this.app.vault.getAbstractFileByPath(preferredPath);
      if (preferredFile instanceof TFile) {
        const { frontmatter } = await this.readNoteState(preferredFile);
        if (frontmatter.blockid != null && String(frontmatter.blockid) === blockKey) {
          existing = preferredFile;
          index.set(blockKey, preferredFile);
        }
      }
    }

    if (existing instanceof TFile) {
      const { content: raw, body: localBody, frontmatter } = await this.readNoteState(existing);
      if (isSyncSkipped(frontmatter)) return { written: false, reason: "sync_skip" };
      if (this.noteHasPublishOnlyContent(localBody)) {
        return { written: false, reason: "local_publish_only" };
      }
      const body = await this.buildImportedBlockContent(block, targetFolder, existing.path, transferState);
      await this.app.vault.modify(existing, replaceBodyPreservingFrontmatter(raw, body));
      await this.mergeArenaFrontmatter(existing, block, channelSlug, frontmatter);
      if (channelSlug && existing.parent?.path) {
        this.recordChannelFolder(channelSlug, existing.parent.path);
      }
      index.set(blockKey, existing);
      return { written: true, reason: "" };
    }

    const frontmatterYaml = frontmatterObjectToYaml(getArenaFrontmatter(block, channelSlug));
    const filename = this.app.vault.getAbstractFileByPath(preferredPath)
      ? this.getUniqueNotePath(targetFolder, noteTitle)
      : preferredPath;
    const body = await this.buildImportedBlockContent(block, targetFolder, filename, transferState);
    const noteContent = `${frontmatterYaml}\n\n${body}`;
    const createdFile = await this.app.vault.create(filename, noteContent);
    if (channelSlug) this.recordChannelFolder(channelSlug, targetFolder);
    index.set(blockKey, createdFile);
    return { written: true, reason: "" };
  }

  async ensureFolder(path) {
    const normalized = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
  }

  extractSlug(input) {
    try {
      const url = new URL(input);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1];
    } catch {
      return input.trim();
    }
  }

  extractBlockId(input) {
    const numMatch = input.match(/\d+/);
    return numMatch ? numMatch[0] : null;
  }

  checkSettings() {
    if (!this.settings.token) {
      new Notice(this.t("notices.configureToken"));
      return false;
    }
    return true;
  }
}

class ArenaSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: this.plugin.t("settings.title") });

    new Setting(containerEl)
      .setName(this.plugin.t("settings.tokenName"))
      .setDesc(this.plugin.t("settings.tokenDesc"))
      .addText((text) =>
        text
          .then(() => {
            text.inputEl.type = "password";
            text.inputEl.autocomplete = "off";
            text.inputEl.spellcheck = false;
          })
          .setPlaceholder(this.plugin.t("settings.tokenPlaceholder"))
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.usernameName"))
      .setDesc(this.plugin.t("settings.usernameDesc"))
      .addText((text) =>
        text
          .setPlaceholder(this.plugin.t("settings.usernamePlaceholder"))
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.languageName"))
      .setDesc(this.plugin.t("settings.languageDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption(LANGUAGE_PREFERENCE_AUTO, this.plugin.t("settings.languageAuto"))
          .addOption("en", this.plugin.t("settings.languageEnglish"))
          .addOption("es", this.plugin.t("settings.languageSpanish"))
          .setValue(this.plugin.settings.language || LANGUAGE_PREFERENCE_AUTO)
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            this.display();
            new Notice(this.plugin.t("notices.languageChanged"));
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.folderName"))
      .setDesc(this.plugin.t("settings.folderDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_FOLDER)
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = value.trim() || DEFAULT_FOLDER;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.downloadAttachmentsName"))
      .setDesc(this.plugin.t("settings.downloadAttachmentsDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.downloadAttachments)
          .onChange(async (value) => {
            this.plugin.settings.downloadAttachments = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.attachmentsFolderName"))
      .setDesc(this.plugin.t("settings.attachmentsFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder("_assets")
          .setValue(this.plugin.settings.attachmentsFolderName || "_assets")
          .onChange(async (value) => {
            this.plugin.settings.attachmentsFolderName = sanitizeFolderName(value.trim()) || "_assets";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.publishCodeBlockFilterName"))
      .setDesc(this.plugin.t("settings.publishCodeBlockFilterDesc"))
      .addText((text) =>
        text
          .setPlaceholder("dataview, mermaid")
          .setValue(this.plugin.settings.publishCodeBlockFilter || "")
          .onChange(async (value) => {
            this.plugin.settings.publishCodeBlockFilter = value
              .split(",")
              .map((part) => normalizeCodeFenceLanguage(part))
              .filter(Boolean)
              .join(", ");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.publishStripCalloutsName"))
      .setDesc(this.plugin.t("settings.publishStripCalloutsDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.publishStripCallouts)
          .onChange(async (value) => {
            this.plugin.settings.publishStripCallouts = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: this.plugin.t("settings.cacheDiagnosticsTitle") });
    const diagnostics = this.plugin.getCacheDiagnostics();
    const summary = this.plugin.t("settings.cacheStatusSummary", diagnostics);

    new Setting(containerEl)
      .setName(this.plugin.t("settings.cacheStatusName"))
      .setDesc(summary)
      .addButton((button) =>
        button
          .setButtonText(this.plugin.t("settings.clearChannelsButton"))
          .onClick(async () => {
            await this.plugin.clearChannelCaches();
            new Notice(this.plugin.t("notices.channelCacheCleared"));
            this.display();
          })
      )
      .addButton((button) =>
        button
          .setButtonText(this.plugin.t("settings.clearBlocksButton"))
          .onClick(async () => {
            await this.plugin.clearBlockCaches();
            new Notice(this.plugin.t("notices.blockCacheCleared"));
            this.display();
          })
      )
      .addButton((button) =>
        button
          .setWarning()
          .setButtonText(this.plugin.t("settings.clearAllButton"))
          .onClick(async () => {
            await this.plugin.clearAllCaches();
            new Notice(this.plugin.t("notices.allCacheCleared"));
            this.display();
          })
      );
  }
}

module.exports = ArenaManagerPlugin;
