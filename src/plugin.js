"use strict";

const { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath } = require("obsidian");
const {
  DEFAULT_FOLDER,
  SYNC_SKIP_FLAG,
  ARENA_FRONTMATTER_KEYS,
  DEFAULT_SETTINGS,
  CHANNEL_SELECT_BATCH_SIZE,
  ARENA_MAX_PAGES_PER_RUN,
  ARENA_MAX_ASSET_DOWNLOADS_PER_RUN,
  ARENA_RESPONSE_CACHE_LIMIT,
} = require("./constants");
const { ArenaClient } = require("./arena-client");
const { InputModal, ChannelSelectModal, CreateChannelModal } = require("./modals");
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
} = require("./note-utils");

function createChannelBrowserState() {
  return {
    nextPage: 1,
    totalChannels: null,
    exhausted: false,
  };
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
    console.log("Are.na Bridge v2 cargado.");
  }

  onunload() {
    console.log("Are.na Bridge descargado.");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.arena = new ArenaClient(this.settings.token);
    this.cacheDirty = false;
  }

  async persistData() {
    await this.saveData(this.settings);
    this.cacheDirty = false;
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
        throw new Error(`Are.na devolvió 304 sin caché local para ${path}`);
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
    const channelKey = String(channel.id || channel.slug || "");
    const current = Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache : [];
    const next = current.filter((item) => String(item.id || item.slug || "") !== channelKey);
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
    const channelSlug = channel?.slug;
    if (channelSlug) {
      this.setArenaJsonCache(`/channels/${channelSlug}`, {}, channel);
      this.invalidateArenaCache([`/channels/${channelSlug}/contents`]);
    }
    this.invalidateUserChannelCaches(false);
    this.updateChannelsCacheEntry(channel);
  }

  trackBlockMutation(block, channelSlug = "") {
    if (block?.id != null) {
      this.setArenaJsonCache(`/blocks/${block.id}`, {}, block);
    }
    if (channelSlug) {
      this.invalidateArenaCache([
        `/channels/${channelSlug}`,
        `/channels/${channelSlug}/contents`,
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

    const notice = new Notice(channels.length > 0 ? "Cargando más canales…" : "Cargando tus canales…", 0);
    try {
      const user = await this.getArenaJson(`/users/${this.settings.username}`);
      state.totalChannels = Number.isFinite(user.counts?.channels) ? user.counts.channels : null;
      if (Number.isFinite(state.totalChannels) && channels.length >= state.totalChannels) {
        state.exhausted = true;
        return this.buildSelectableChannelsResult(channels);
      }

      const seen = new Set(channels.map((channel) => String(channel.id || channel.slug || "")));
      let added = 0;
      let scannedPages = 0;

      while (added < batchSize && scannedPages < ARENA_MAX_PAGES_PER_RUN) {
        const page = state.nextPage;
        const totalLabel = Number.isFinite(state.totalChannels) ? `${channels.length}/${state.totalChannels}` : `${channels.length}`;
        notice.setMessage(`Cargando canales… pág. ${page} · ${totalLabel} encontrados`);
        const data = await this.getArenaJson(`/users/${this.settings.username}/contents`, { page });
        state.nextPage = page + 1;
        scannedPages++;
        const items = (data.data || []).filter((item) => item.type === "Channel");
        for (const channel of items) {
          const key = String(channel.id || channel.slug || "");
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
        new Notice(`Se cargó un tramo parcial de canales. Pulsa "Cargar ${batchSize} más" para seguir.`);
      }
      await this.persistData();
      return this.buildSelectableChannelsResult(channels);
    } finally {
      if (this.cacheDirty) await this.persistData();
      notice.hide();
    }
  }

  async buildBlockFileIndex() {
    const index = new Map();
    const uncachedFiles = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter?.blockid != null) {
        index.set(String(frontmatter.blockid), file);
      } else {
        uncachedFiles.push(file);
      }
    }

    for (const file of uncachedFiles) {
      const raw = await this.app.vault.cachedRead(file);
      const blockId = extractFrontmatterScalar(raw, "blockid");
      if (blockId != null) {
        index.set(String(blockId), file);
      }
    }

    return index;
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

  createTransferState() {
    return {
      downloadedAssets: 0,
      assetLimitNoticeShown: false,
    };
  }

  async confirmNextPageLoad(label, page, processed, total = Infinity) {
    if (page >= ARENA_MAX_PAGES_PER_RUN) {
      new Notice(
        `Importación detenida tras ${ARENA_MAX_PAGES_PER_RUN} páginas. Para cargas más grandes, conviene pedir permiso a Are.na.`
      );
      return false;
    }

    const totalLabel = Number.isFinite(total) ? `${processed}/${total}` : `${processed}`;
    return window.confirm(
      `Are.na recomienda cargar páginas bajo demanda. Ya se procesó la página ${page} de ${label} (${totalLabel}). ¿Cargar la siguiente página?`
    );
  }

  canDownloadMoreAssets(transferState) {
    if (!transferState) return true;
    if (transferState.downloadedAssets < ARENA_MAX_ASSET_DOWNLOADS_PER_RUN) return true;

    if (!transferState.assetLimitNoticeShown) {
      transferState.assetLimitNoticeShown = true;
      new Notice(
        `Se alcanzó el límite de ${ARENA_MAX_ASSET_DOWNLOADS_PER_RUN} adjuntos locales en esta ejecución. El resto quedará enlazado en remoto para evitar descargas masivas.`
      );
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
      "image/svg+xml": ".svg",
      "application/pdf": ".pdf",
      "text/plain": ".txt",
      "application/zip": ".zip",
      "audio/mpeg": ".mp3",
      "video/mp4": ".mp4",
    };
    return known[normalized] || "";
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo descargar adjunto (${response.status})`);
    }

    const extension =
      this.getFileExtensionFromContentType(response.headers.get("content-type")) ||
      this.getFileExtensionFromUrl(url);
    const filename = sanitizeFilename(baseName) + extension;
    const assetPath = normalizePath(`${targetFolder}/${filename}`);
    const buffer = await response.arrayBuffer();
    await this.saveBinaryAsset(assetPath, buffer);
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
          `${block.title || "imagen"}-${block.id}`,
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
          `${block.title || "adjunto"}-${block.id}`,
          transferState
        );
        const attachmentUrl = this.getRelativeAssetPath(notePath, assetPath);
        return blockToContent(block, { attachmentUrl, useObsidianLinks: true });
      }
    } catch (error) {
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

  registerCommands() {
    this.addCommand({
      id: "get-blocks-from-channel",
      name: "Obtener bloques de un canal",
      callback: () => this.cmdGetBlocksFromChannel(),
    });
    this.addCommand({
      id: "browse-my-channels",
      name: "Explorar mis canales",
      callback: () => this.cmdBrowseMyChannels(),
    });
    this.addCommand({
      id: "create-channel",
      name: "Crear canal en Are.na",
      callback: () => this.cmdCreateChannel(),
    });
    this.addCommand({
      id: "refresh-channels-cache",
      name: "Actualizar lista de canales (refresco)",
      callback: () => this.cmdRefreshChannelsCache(),
    });
    this.addCommand({
      id: "pull-block",
      name: "Actualizar nota desde Are.na (Pull)",
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
      name: "Enviar nota a Are.na (Push)",
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
      name: "Obtener bloque por ID o URL",
      callback: () => this.cmdGetBlockById(),
    });
    this.addCommand({
      id: "open-block-in-arena",
      name: "Abrir bloque en Are.na",
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
        if (!(file instanceof TFolder)) return;
        menu.addItem((item) => {
          item
            .setTitle("Subir carpeta como canal a Are.na")
            .setIcon("upload")
            .onClick(() => this.cmdUploadFolderAsChannel(file));
        });
      })
    );
  }

  async cmdGetBlocksFromChannel() {
    if (!this.checkSettings()) return;
    new InputModal(this.app, "Obtener bloques de canal", "slug o URL del canal", async (input) => {
      const slug = this.extractSlug(input);
      await this.fetchAndSaveChannel(slug);
    }).open();
  }

  async cmdBrowseMyChannels() {
    if (!this.checkSettings()) return;
    if (!this.settings.username) {
      new Notice("⚠️ Configura tu nombre de usuario en los ajustes.");
      return;
    }
    try {
      const channelState = await this.getSelectableChannels();
      if (channelState.channels.length === 0) {
        new Notice("No se encontraron canales.");
        return;
      }
      new ChannelSelectModal(this.app, channelState.channels, async (channel) => {
        await this.fetchAndSaveChannel(channel.slug);
      }, {
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
      new Notice(`❌ Error al cargar canales: ${error.message}`);
    }
  }

  async cmdCreateChannel() {
    if (!this.checkSettings()) return;
    new CreateChannelModal(this.app, async (title, visibility) => {
      try {
        const channel = await this.arena.createChannel(title, visibility);
        this.trackChannelMutation(channel);
        await this.persistData();
        new Notice(`✅ Canal "${channel.title}" creado en Are.na`);
      } catch (error) {
        new Notice(`❌ Error al crear canal: ${error.message}`);
      }
    }).open();
  }

  async cmdRefreshChannelsCache() {
    if (!this.checkSettings()) return;
    this.invalidateUserChannelCaches();
    await this.persistData();
    new Notice("Caché de canales borrado. El próximo 'Explorar mis canales' lo descargará de nuevo.");
  }

  async cmdUploadFolderAsChannel(folder) {
    if (!this.checkSettings()) return;
    const files = folder.children.filter((file) => file instanceof TFile && file.extension === "md");
    if (files.length === 0) {
      new Notice("⚠️ La carpeta no contiene notas .md.");
      return;
    }
    new CreateChannelModal(this.app, async (title, visibility) => {
      const notice = new Notice(`Creando canal "${title}"…`, 0);
      try {
        const channel = await this.arena.createChannel(title, visibility);
        this.trackChannelMutation(channel);
        const channelRef = channel.id || channel.slug;
        let uploaded = 0;
        let skipped = 0;
        for (const file of files) {
          notice.setMessage(`Subiendo notas… ${uploaded}/${files.length}`);
          const { frontmatter, body } = await this.readNoteState(file);
          if (isSyncSkipped(frontmatter)) {
            skipped++;
            continue;
          }
          if (frontmatter.blockid) {
            const block = await this.arena.updateBlock(frontmatter.blockid, body, frontmatter.title || file.basename);
            this.trackBlockMutation(block, channel.slug);
          } else {
            const block = await this.arena.pushBlock(channelRef, body, file.basename);
            this.trackBlockMutation(block, channel.slug);
            await this.mergeArenaFrontmatter(file, block, channel.slug, frontmatter);
          }
          uploaded++;
        }
        notice.hide();
        const summary = skipped > 0
          ? `✅ ${uploaded} notas subidas al canal "${channel.title}" · ${skipped} omitidas por ${SYNC_SKIP_FLAG}`
          : `✅ ${uploaded} notas subidas al canal "${channel.title}"`;
        new Notice(summary);
        await this.persistData();
      } catch (error) {
        notice.hide();
        new Notice(`❌ Error: ${error.message}`);
      }
    }, folder.name).open();
  }

  async cmdPullBlock() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const { content, frontmatter } = await this.readNoteState(file);
    if (isSyncSkipped(frontmatter)) {
      new Notice(`⚠️ Esta nota está marcada con ${SYNC_SKIP_FLAG}: true.`);
      return;
    }
    const blockId = frontmatter.blockid;
    if (!blockId) {
      new Notice("⚠️ Esta nota no tiene blockid en el frontmatter.");
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
      new Notice(`✅ Nota actualizada desde bloque ${blockId}`);
    } catch (error) {
      new Notice(`❌ Error: ${error.message}`);
    }
  }

  async cmdPushNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const { body, frontmatter } = await this.readNoteState(file);
    if (isSyncSkipped(frontmatter)) {
      new Notice(`⚠️ Esta nota está marcada con ${SYNC_SKIP_FLAG}: true.`);
      return;
    }
    const blockId = frontmatter.blockid;
    const title = frontmatter.title || file.basename;
    if (blockId) {
      try {
        const block = await this.arena.updateBlock(blockId, body, title);
        this.trackBlockMutation(block, frontmatter.channel || "");
        await this.persistData();
        new Notice(`✅ Bloque ${blockId} actualizado en Are.na`);
      } catch (error) {
        new Notice(`❌ Error al actualizar: ${error.message}`);
      }
    } else {
      await this.promptPushNoteChannel(file, frontmatter, body, title);
    }
  }

  async promptPushNoteChannel(file, frontmatter, body, title) {
    const openManualInput = () => {
      new InputModal(this.app, "Enviar a Are.na", "slug del canal destino", async (slug) => {
        await this.publishNoteToArena(file, frontmatter, body, title, slug, slug);
      }).open();
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
        title: "Selecciona el canal destino",
        hasMore: channelState.hasMore,
        totalChannels: channelState.total,
        onLoadMore: async () => this.loadMoreSelectableChannels(),
        onManualInput: openManualInput,
        manualButtonText: "Introducir slug manual",
        onRefresh: async () => {
          this.invalidateUserChannelCaches();
          await this.persistData();
          return this.refreshSelectableChannels();
        },
      }).open();
    } catch (error) {
      console.error("push-note channels error:", error);
      new Notice(`⚠️ No se pudo cargar la lista de canales: ${error.message}`);
      openManualInput();
    }
  }

  async publishNoteToArena(file, frontmatter, body, title, channelRef, channelSlug) {
    try {
      const block = await this.arena.pushBlock(channelRef, body, title);
      this.trackBlockMutation(block, channelSlug);
      await this.mergeArenaFrontmatter(file, block, channelSlug, frontmatter);
      await this.persistData();
      new Notice(`✅ Publicado en /${channelSlug} como bloque ${block.id}`);
    } catch (error) {
      new Notice(`❌ Error al publicar: ${error.message}`);
    }
  }

  async cmdGetBlockById() {
    if (!this.checkSettings()) return;
    new InputModal(this.app, "Obtener bloque por ID o URL", "ID numérico o URL de Are.na", async (input) => {
      const id = this.extractBlockId(input);
      if (!id) {
        new Notice("⚠️ No se pudo extraer el ID.");
        return;
      }
      try {
        const block = await this.arena.getBlock(id);
        await this.saveBlock(block, "", null, null, this.createTransferState());
        new Notice(`✅ Bloque ${id} importado`);
      } catch (error) {
        new Notice(`❌ Error: ${error.message}`);
      }
    }).open();
  }

  async cmdOpenInArena() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const { frontmatter } = await this.readNoteState(file);
    const blockId = frontmatter.blockid;
    const channel = frontmatter.channel;
    if (!blockId) {
      new Notice("⚠️ Esta nota no tiene blockid.");
      return;
    }
    const url = channel
      ? `https://www.are.na/${this.settings.username}/${channel}/blocks/${blockId}`
      : `https://www.are.na/block/${blockId}`;
    window.open(url, "_blank");
  }

  async fetchAndSaveChannel(slug) {
    new Notice(`Descargando canal "${slug}"…`);
    try {
      const transferState = this.createTransferState();
      const channel = await this.getArenaJson(`/channels/${slug}`);
      const channelTitle = channel.title || slug;
      const folderName = sanitizeFolderName(channelTitle) || slug;
      const folder = normalizePath(`${this.settings.folder}/${folderName}`);
      await this.ensureFolder(folder);
      const blockIndex = await this.buildBlockFileIndex();
      let saved = 0;
      let skipped = 0;
      let page = 1;

      while (true) {
        const data = await this.getArenaJson(`/channels/${slug}/contents`, { page });
        const blocks = data.data || [];

        for (const block of blocks) {
          if (block.type === "Channel") continue;
          const written = await this.saveBlock(block, slug, folder, blockIndex, transferState);
          if (written) saved++;
          else skipped++;
        }

        if (!data.meta?.has_more_pages) break;
        if (!await this.confirmNextPageLoad(`"${channelTitle}"`, page, saved + skipped, data.meta?.total_count)) break;
        page++;
      }

      const summary = skipped > 0
        ? `✅ "${channelTitle}": ${saved} bloques importados · ${skipped} omitidos por ${SYNC_SKIP_FLAG}`
        : `✅ "${channelTitle}": ${saved} bloques importados`;
      new Notice(summary);
    } catch (error) {
      new Notice(`❌ Error: ${error.message}`);
    } finally {
      if (this.cacheDirty) await this.persistData();
    }
  }

  async saveBlock(block, channelSlug, folder = null, blockIndex = null, transferState = null) {
    const targetFolder = folder || normalizePath(this.settings.folder);
    await this.ensureFolder(targetFolder);
    const noteTitle = sanitizeFilename(block.title || `Bloque ${block.id}`);
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
      const { content: raw, frontmatter } = await this.readNoteState(existing);
      if (isSyncSkipped(frontmatter)) return false;
      const body = await this.buildImportedBlockContent(block, targetFolder, existing.path, transferState);
      await this.app.vault.modify(existing, replaceBodyPreservingFrontmatter(raw, body));
      await this.mergeArenaFrontmatter(existing, block, channelSlug, frontmatter);
      index.set(blockKey, existing);
      return true;
    }

    const frontmatterYaml = frontmatterObjectToYaml(getArenaFrontmatter(block, channelSlug));
    const filename = this.app.vault.getAbstractFileByPath(preferredPath)
      ? this.getUniqueNotePath(targetFolder, noteTitle)
      : preferredPath;
    const body = await this.buildImportedBlockContent(block, targetFolder, filename, transferState);
    const noteContent = `${frontmatterYaml}\n\n${body}`;
    const createdFile = await this.app.vault.create(filename, noteContent);
    index.set(blockKey, createdFile);
    return true;
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
      new Notice("⚠️ Configura tu Personal Access Token en los ajustes del plugin.");
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
    containerEl.createEl("h2", { text: "Are.na Bridge" });

    new Setting(containerEl)
      .setName("Personal Access Token")
      .setDesc("Obtén tu token en are.na/settings/oauth. Para Push y crear canales, usa scope write.")
      .addText((text) =>
        text
          .setPlaceholder("Tu token de Are.na")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Usuario (slug)")
      .setDesc("Tu slug de Are.na, ej. 'marco-noris'")
      .addText((text) =>
        text
          .setPlaceholder("tu-usuario")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Carpeta")
      .setDesc("Carpeta del vault donde se guardarán los bloques")
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
      .setName("Descargar adjuntos")
      .setDesc("Descarga automáticamente archivos adjuntos")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.downloadAttachments)
          .onChange(async (value) => {
            this.plugin.settings.downloadAttachments = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Carpeta de adjuntos")
      .setDesc("Nombre de la carpeta local donde se guardan imágenes y adjuntos descargados")
      .addText((text) =>
        text
          .setPlaceholder("_assets")
          .setValue(this.plugin.settings.attachmentsFolderName || "_assets")
          .onChange(async (value) => {
            this.plugin.settings.attachmentsFolderName = sanitizeFolderName(value.trim()) || "_assets";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Diagnóstico de caché" });
    const diagnostics = this.plugin.getCacheDiagnostics();
    const summary = [
      `${diagnostics.total} respuestas API`,
      `${diagnostics.users} de usuario`,
      `${diagnostics.channels} de canales`,
      `${diagnostics.blocks} de bloques`,
      `${diagnostics.other} de otros endpoints`,
      `${diagnostics.localChannels} canales en lista local`,
    ].join(" · ");

    new Setting(containerEl)
      .setName("Estado de la caché")
      .setDesc(summary)
      .addButton((button) =>
        button
          .setButtonText("Vaciar canales")
          .onClick(async () => {
            await this.plugin.clearChannelCaches();
            new Notice("Caché de usuario/canales vaciada.");
            this.display();
          })
      )
      .addButton((button) =>
        button
          .setButtonText("Vaciar bloques")
          .onClick(async () => {
            await this.plugin.clearBlockCaches();
            new Notice("Caché de bloques vaciada.");
            this.display();
          })
      )
      .addButton((button) =>
        button
          .setWarning()
          .setButtonText("Vaciar todo")
          .onClick(async () => {
            await this.plugin.clearAllCaches();
            new Notice("Toda la caché del plugin ha sido vaciada.");
            this.display();
          })
      );
  }
}

module.exports = ArenaManagerPlugin;
