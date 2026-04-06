"use strict";
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/constants.js
var require_constants = __commonJS({
  "src/constants.js"(exports2, module2) {
    "use strict";
    var ARENA_API = "https://api.are.na/v3";
    var DEFAULT_FOLDER = "arena";
    var SYNC_SKIP_FLAG = "arena_skip_sync";
    var ARENA_PAGE_SIZE = 50;
    var CHANNEL_SELECT_BATCH_SIZE = 12;
    var ARENA_REQUEST_DELAY_MS = 500;
    var ARENA_MAX_PAGES_PER_RUN = 10;
    var ARENA_MAX_ASSET_DOWNLOADS_PER_RUN = 20;
    var ARENA_RESPONSE_CACHE_LIMIT = 25;
    var ALLOWED_ATTACHMENT_MIME_TYPES = [
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
      "video/ogg"
    ];
    var ALLOWED_ATTACHMENT_EXTENSIONS = [
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
      ".mov"
    ];
    var ARENA_FRONTMATTER_KEYS = [
      "blockid",
      "class",
      "title",
      "user",
      "channel",
      "source_title",
      "source_url",
      "created_at",
      "updated_at"
    ];
    var DEFAULT_SETTINGS = {
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
        exhausted: false
      },
      responseCache: {}
    };
    module2.exports = {
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
      DEFAULT_SETTINGS
    };
  }
});

// src/arena-client.js
var require_arena_client = __commonJS({
  "src/arena-client.js"(exports2, module2) {
    "use strict";
    var { requestUrl } = require("obsidian");
    var { ARENA_API, ARENA_PAGE_SIZE, ARENA_REQUEST_DELAY_MS } = require_constants();
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    function getHeaderValue(headers = {}, name) {
      const target = String(name || "").toLowerCase();
      for (const [key, value] of Object.entries(headers || {})) {
        if (String(key).toLowerCase() === target) return String(value);
      }
      return "";
    }
    function parseJsonSafely(text) {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
    var ArenaClient = class {
      constructor(token, options = {}) {
        this.token = token;
        this.base = ARENA_API;
        this.minRequestGapMs = options.minRequestGapMs ?? ARENA_REQUEST_DELAY_MS;
        this.lastRequestAt = 0;
      }
      headers() {
        return {
          Authorization: `Bearer ${this.token}`
        };
      }
      async paceRequest() {
        const waitMs = this.lastRequestAt + this.minRequestGapMs - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        this.lastRequestAt = Date.now();
      }
      getRetryDelayMs(headers, attempt) {
        const retryAfter = parseInt(getHeaderValue(headers, "Retry-After") || "", 10);
        if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1e3;
        const reset = parseInt(getHeaderValue(headers, "X-RateLimit-Reset") || "", 10);
        if (Number.isFinite(reset) && reset > 0) {
          return Math.max(reset * 1e3 - Date.now(), 1e3);
        }
        return Math.min(5e3 * (attempt + 1), 15e3);
      }
      async requestJson(url, options = {}, requestOptions = {}) {
        let lastStatus = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
          await this.paceRequest();
          const response = await requestUrl({
            url,
            method: options.method || "GET",
            headers: options.headers,
            body: options.body,
            contentType: options.contentType,
            throw: false
          });
          lastStatus = response.status;
          if (response.status === 429) {
            const waitMs = this.getRetryDelayMs(response.headers, attempt);
            console.warn(`arena-manager: rate limit, esperando ${waitMs}ms`);
            await sleep(waitMs);
            continue;
          }
          if (requestOptions.allowNotModified && response.status === 304) {
            return {
              status: 304,
              data: null,
              etag: getHeaderValue(response.headers, "ETag") || null
            };
          }
          if (response.status < 200 || response.status >= 300) {
            const payload = parseJsonSafely(response.text || "");
            const detail = payload?.details?.message || payload?.error || "";
            const error = new Error(
              detail ? `${detail} (${response.status})` : `Request failed, status ${response.status} \u2014 ${url.toString()}`
            );
            error.status = response.status;
            error.url = url.toString();
            error.payload = payload;
            throw error;
          }
          const text = response.text || "";
          return {
            status: response.status,
            data: text ? JSON.parse(text) : {},
            etag: getHeaderValue(response.headers, "ETag") || null
          };
        }
        throw new Error(`Request failed after retries, status ${lastStatus} \u2014 ${url.toString()}`);
      }
      async get(path, params = {}) {
        const result = await this.getRevalidated(path, params);
        return result.data;
      }
      async getRevalidated(path, params = {}, etag = null) {
        const url = new URL(`${this.base}${path}`);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        const headers = this.headers();
        if (etag) headers["If-None-Match"] = etag;
        return this.requestJson(url.toString(), { method: "GET", headers }, { allowNotModified: true });
      }
      async post(path, body = {}) {
        const result = await this.requestJson(`${this.base}${path}`, {
          method: "POST",
          headers: this.headers(),
          contentType: "application/json",
          body: JSON.stringify(body)
        });
        return result.data;
      }
      async put(path, body = {}) {
        const result = await this.requestJson(`${this.base}${path}`, {
          method: "PUT",
          headers: this.headers(),
          contentType: "application/json",
          body: JSON.stringify(body)
        });
        return result.data;
      }
      async getChannelContentsPage(slug, page = 1, per = ARENA_PAGE_SIZE) {
        return this.get(`/channels/${slug}/contents`, { page, per });
      }
      async getBlock(id) {
        return this.get(`/blocks/${id}`);
      }
      async getChannel(slug) {
        return this.get(`/channels/${slug}`);
      }
      async getUser(username) {
        return this.get(`/users/${username}`);
      }
      async pushBlock(channelId, content, title = "") {
        return this.post("/blocks", { value: content, title, channel_ids: [channelId] });
      }
      async updateBlock(blockId, content, title = "") {
        return this.put(`/blocks/${blockId}`, { content, title });
      }
      async createChannel(title, visibility = "public") {
        return this.post("/channels", { title, visibility });
      }
      async getUserContentsPage(username, page = 1, per = ARENA_PAGE_SIZE) {
        return this.get(`/users/${username}/contents`, { page, per });
      }
    };
    module2.exports = { ArenaClient };
  }
});

// src/modals.js
var require_modals = __commonJS({
  "src/modals.js"(exports2, module2) {
    "use strict";
    var { Modal } = require("obsidian");
    var MODAL_FALLBACKS = {
      "common.accept": "OK",
      "common.cancel": "Cancel",
      "common.continue": "Continue",
      "common.blocks": "blocks",
      "common.unnamedChannel": "Untitled channel",
      "modals.confirm.title": "Confirm action",
      "modals.channelSelect.title": "Select an Are.na channel",
      "modals.channelSelect.emptyMessage": "No results.",
      "modals.channelSelect.manualButton": "Use manual slug",
      "modals.channelSelect.refreshButton": "Refresh",
      "modals.channelSelect.filterPlaceholder": "Filter channels\u2026",
      "modals.channelSelect.updating": "Refreshing channels\u2026",
      "modals.channelSelect.updated": "List updated.",
      "modals.channelSelect.refreshFailed": "Could not refresh: {{error}}",
      "modals.channelSelect.loadMoreRemote": "Load {{count}} more",
      "modals.channelSelect.loadMoreVisible": "Show {{count}} more",
      "modals.channelSelect.loadingMore": "Loading more channels\u2026",
      "modals.channelSelect.loadMoreFailed": "Could not load more: {{error}}",
      "modals.channelSelect.loadedSummary": "Showing {{visible}}/{{filtered}} \xB7 {{loaded}}",
      "modals.channelSelect.loadedCount": "{{count}} loaded",
      "modals.channelSelect.loadedCountWithTotal": "{{count}}/{{total}} loaded",
      "modals.channelSelect.emptyWithMore": "{{message}} Load more channels to keep searching.",
      "modals.createChannel.title": "Create Are.na channel",
      "modals.createChannel.nameLabel": "Channel name",
      "modals.createChannel.namePlaceholder": "My channel",
      "modals.createChannel.visibilityLabel": "Visibility",
      "modals.createChannel.visibilityPublic": "Public - anyone can view and add",
      "modals.createChannel.visibilityClosed": "Closed - anyone can view, only you can add",
      "modals.createChannel.visibilityPrivate": "Private - only you can view and add",
      "modals.createChannel.submit": "Create channel"
    };
    function interpolate(template, variables = {}) {
      return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const value = variables[key];
        return value == null ? "" : String(value);
      });
    }
    function fallbackT(key, variables = {}) {
      const template = MODAL_FALLBACKS[key] || key;
      return interpolate(template, variables);
    }
    var InputModal = class extends Modal {
      constructor(app, title, placeholder, onSubmit, options = {}) {
        super(app);
        this.title = title;
        this.placeholder = placeholder;
        this.onSubmit = onSubmit;
        this.submitText = options.submitText || fallbackT("common.accept");
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.addClass("arena-bridge-modal");
        contentEl.createEl("h2", { text: this.title });
        const input = contentEl.createEl("input", {
          type: "text",
          placeholder: this.placeholder,
          cls: "arena-bridge-modal__input"
        });
        input.focus();
        const actionsEl = contentEl.createDiv({ cls: "arena-bridge-modal__actions" });
        const button = actionsEl.createEl("button", { text: this.submitText, cls: "mod-cta" });
        button.onclick = () => {
          const value = input.value.trim();
          if (value) {
            this.close();
            this.onSubmit(value);
          }
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") button.click();
        });
      }
      onClose() {
        this.contentEl.empty();
      }
    };
    var ConfirmModal = class extends Modal {
      constructor(app, message, onDecision, options = {}) {
        super(app);
        this.message = message;
        this.onDecision = onDecision;
        this.t = typeof options.t === "function" ? options.t : fallbackT;
        this.title = options.title || this.t("modals.confirm.title");
        this.confirmText = options.confirmText || this.t("common.continue");
        this.cancelText = options.cancelText || this.t("common.cancel");
        this.resolved = false;
      }
      resolve(decision) {
        if (this.resolved) return;
        this.resolved = true;
        this.onDecision(Boolean(decision));
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.addClass("arena-bridge-modal");
        contentEl.createEl("h2", { text: this.title });
        contentEl.createEl("p", {
          text: this.message,
          cls: "arena-bridge-modal__message"
        });
        const actionsEl = contentEl.createDiv({ cls: "arena-bridge-modal__actions" });
        const cancelButton = actionsEl.createEl("button", { text: this.cancelText });
        const confirmButton = actionsEl.createEl("button", {
          text: this.confirmText,
          cls: "mod-cta"
        });
        cancelButton.onclick = () => this.close();
        confirmButton.onclick = () => {
          this.resolve(true);
          this.close();
        };
        this.scope.register([], "Enter", () => {
          confirmButton.click();
          return false;
        });
      }
      onClose() {
        this.resolve(false);
        this.contentEl.empty();
      }
    };
    var ChannelSelectModal = class extends Modal {
      constructor(app, channels, onSelect, options = {}) {
        super(app);
        this.channels = Array.isArray(channels) ? channels : [];
        this.onSelect = onSelect;
        this.t = typeof options.t === "function" ? options.t : fallbackT;
        this.title = options.title || this.t("modals.channelSelect.title");
        this.emptyMessage = options.emptyMessage || this.t("modals.channelSelect.emptyMessage");
        this.onManualInput = options.onManualInput || null;
        this.manualButtonText = options.manualButtonText || this.t("modals.channelSelect.manualButton");
        this.onRefresh = options.onRefresh || null;
        this.refreshButtonText = options.refreshButtonText || this.t("modals.channelSelect.refreshButton");
        this.onLoadMore = options.onLoadMore || null;
        this.hasMore = Boolean(options.hasMore);
        this.totalChannels = Number.isFinite(options.totalChannels) ? options.totalChannels : null;
        this.pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? options.pageSize : 12;
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.addClass("arena-bridge-modal");
        contentEl.createEl("h2", { text: this.title });
        const actionsEl = contentEl.createDiv({ cls: "arena-bridge-channel-select__actions" });
        const searchInput = contentEl.createEl("input", {
          type: "text",
          placeholder: this.t("modals.channelSelect.filterPlaceholder"),
          cls: "arena-bridge-modal__input"
        });
        let visibleCount = this.pageSize;
        let messageEl = null;
        let summaryEl = null;
        const setMessage = (message = "") => {
          if (!messageEl) {
            messageEl = contentEl.createDiv({ cls: "arena-bridge-channel-select__message" });
          }
          messageEl.setText(message);
        };
        const setSummary = (message = "") => {
          if (!summaryEl) {
            summaryEl = contentEl.createDiv({ cls: "arena-bridge-channel-select__summary" });
          }
          summaryEl.setText(message);
        };
        const applyChannelState = (result = {}) => {
          if (Array.isArray(result.channels)) this.channels = result.channels;
          if (typeof result.hasMore === "boolean") this.hasMore = result.hasMore;
          if (Number.isFinite(result.total)) this.totalChannels = result.total;
        };
        const getFilteredChannels = (filter = "") => {
          const normalizedFilter = filter.toLowerCase();
          return this.channels.filter(
            (channel) => (channel.title || "").toLowerCase().includes(normalizedFilter) || (channel.slug || "").toLowerCase().includes(normalizedFilter)
          );
        };
        if (this.onRefresh) {
          const refreshButton = actionsEl.createEl("button", { text: this.refreshButtonText });
          refreshButton.onclick = async () => {
            refreshButton.disabled = true;
            setMessage(this.t("modals.channelSelect.updating"));
            try {
              applyChannelState(await this.onRefresh());
              visibleCount = this.pageSize;
              setMessage(this.t("modals.channelSelect.updated"));
              renderList(searchInput.value);
            } catch (error) {
              setMessage(this.t("modals.channelSelect.refreshFailed", { error: error.message }));
            } finally {
              refreshButton.disabled = false;
            }
          };
        }
        if (this.onManualInput) {
          const manualButton = actionsEl.createEl("button", { text: this.manualButtonText });
          manualButton.onclick = () => {
            this.close();
            this.onManualInput();
          };
        }
        const list = contentEl.createDiv({ cls: "arena-bridge-channel-select__list" });
        const loadMoreWrap = contentEl.createDiv({ cls: "arena-bridge-modal__actions" });
        const loadMoreButton = loadMoreWrap.createEl("button");
        loadMoreButton.setText(this.t("modals.channelSelect.loadMoreRemote", { count: this.pageSize }));
        const renderList = (filter = "") => {
          list.empty();
          const filtered = getFilteredChannels(filter);
          const visible = filtered.slice(0, visibleCount);
          const loadedLabel = Number.isFinite(this.totalChannels) ? this.t("modals.channelSelect.loadedCountWithTotal", { count: this.channels.length, total: this.totalChannels }) : this.t("modals.channelSelect.loadedCount", { count: this.channels.length });
          setSummary(this.t("modals.channelSelect.loadedSummary", {
            visible: visible.length,
            filtered: filtered.length,
            loaded: loadedLabel
          }));
          if (visible.length === 0) {
            const emptyText = this.hasMore ? this.t("modals.channelSelect.emptyWithMore", { message: this.emptyMessage }) : this.emptyMessage;
            list.createEl("p", { text: emptyText });
          }
          for (const channel of visible) {
            const item = list.createDiv({ cls: "arena-bridge-channel-select__item" });
            item.createEl("strong", { text: channel.title || channel.slug || this.t("common.unnamedChannel") });
            const count = channel.counts?.contents ?? channel.length ?? 0;
            const visibility = channel.visibility || "";
            const meta = item.createEl("span", {
              cls: "arena-bridge-channel-select__meta",
              text: visibility ? ` \xB7 ${count} ${this.t("common.blocks")} \xB7 ${visibility}` : ` \xB7 ${count} ${this.t("common.blocks")}`
            });
            item.onclick = () => {
              this.close();
              this.onSelect(channel);
            };
          }
          const hasMoreVisible = filtered.length > visibleCount;
          const canLoadRemote = this.hasMore && Boolean(this.onLoadMore);
          loadMoreWrap.style.display = hasMoreVisible || canLoadRemote ? "flex" : "none";
          if (hasMoreVisible) {
            loadMoreButton.setText(this.t("modals.channelSelect.loadMoreVisible", {
              count: Math.min(this.pageSize, filtered.length - visibleCount)
            }));
            return;
          }
          loadMoreButton.setText(this.t("modals.channelSelect.loadMoreRemote", { count: this.pageSize }));
        };
        loadMoreButton.onclick = async () => {
          const filter = searchInput.value;
          const filtered = getFilteredChannels(filter);
          if (filtered.length > visibleCount) {
            visibleCount += this.pageSize;
            renderList(filter);
            return;
          }
          if (!this.onLoadMore || !this.hasMore) return;
          loadMoreButton.disabled = true;
          setMessage(this.t("modals.channelSelect.loadingMore"));
          try {
            applyChannelState(await this.onLoadMore());
            visibleCount += this.pageSize;
            setMessage("");
            renderList(filter);
          } catch (error) {
            setMessage(this.t("modals.channelSelect.loadMoreFailed", { error: error.message }));
          } finally {
            loadMoreButton.disabled = false;
          }
        };
        renderList();
        searchInput.addEventListener("input", () => {
          visibleCount = this.pageSize;
          renderList(searchInput.value);
        });
        searchInput.focus();
      }
      onClose() {
        this.contentEl.empty();
      }
    };
    var CreateChannelModal = class extends Modal {
      constructor(app, onSubmit, defaultTitle = "", options = {}) {
        super(app);
        this.onSubmit = onSubmit;
        this.defaultTitle = defaultTitle;
        this.t = typeof options.t === "function" ? options.t : fallbackT;
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.addClass("arena-bridge-modal");
        contentEl.createEl("h2", { text: this.t("modals.createChannel.title") });
        contentEl.createEl("label", { text: this.t("modals.createChannel.nameLabel") });
        const titleInput = contentEl.createEl("input", {
          type: "text",
          placeholder: this.t("modals.createChannel.namePlaceholder"),
          cls: "arena-bridge-modal__input"
        });
        if (this.defaultTitle) titleInput.value = this.defaultTitle;
        contentEl.createEl("label", { text: this.t("modals.createChannel.visibilityLabel") });
        const select = contentEl.createEl("select", { cls: "arena-bridge-modal__input" });
        [
          ["public", this.t("modals.createChannel.visibilityPublic")],
          ["closed", this.t("modals.createChannel.visibilityClosed")],
          ["private", this.t("modals.createChannel.visibilityPrivate")]
        ].forEach(([value, label]) => {
          const option = select.createEl("option", { text: label });
          option.value = value;
        });
        const actionsEl = contentEl.createDiv({ cls: "arena-bridge-modal__actions" });
        const button = actionsEl.createEl("button", { text: this.t("modals.createChannel.submit"), cls: "mod-cta" });
        button.onclick = () => {
          const title = titleInput.value.trim();
          if (!title) {
            titleInput.focus();
            return;
          }
          this.close();
          this.onSubmit(title, select.value);
        };
        titleInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") button.click();
        });
        titleInput.focus();
      }
      onClose() {
        this.contentEl.empty();
      }
    };
    module2.exports = {
      InputModal,
      ConfirmModal,
      ChannelSelectModal,
      CreateChannelModal
    };
  }
});

// src/i18n.js
var require_i18n = __commonJS({
  "src/i18n.js"(exports2, module2) {
    "use strict";
    var SUPPORTED_LANGUAGES = ["en", "es"];
    var LANGUAGE_PREFERENCE_AUTO = "auto";
    var TRANSLATIONS = {
      en: {
        common: {
          accept: "OK",
          cancel: "Cancel",
          continue: "Continue",
          refresh: "Refresh",
          untitled: "Untitled",
          attachment: "Attachment",
          image: "image",
          block: "Block",
          loadingChannels: "Loading channels\u2026",
          loadingMoreChannels: "Loading more channels\u2026",
          noContentType: "no content-type",
          noExtension: "no extension",
          blocks: "blocks",
          unnamedChannel: "Untitled channel"
        },
        modals: {
          confirm: {
            title: "Confirm action"
          },
          channelSelect: {
            title: "Select an Are.na channel",
            emptyMessage: "No results.",
            manualButton: "Use manual slug",
            refreshButton: "Refresh",
            filterPlaceholder: "Filter channels\u2026",
            updating: "Refreshing channels\u2026",
            updated: "List updated.",
            refreshFailed: "Could not refresh: {{error}}",
            loadMoreRemote: "Load {{count}} more",
            loadMoreVisible: "Show {{count}} more",
            loadingMore: "Loading more channels\u2026",
            loadMoreFailed: "Could not load more: {{error}}",
            loadedSummary: "Showing {{visible}}/{{filtered}} \xB7 {{loaded}}",
            loadedCount: "{{count}} loaded",
            loadedCountWithTotal: "{{count}}/{{total}} loaded",
            emptyWithMore: "{{message}} Load more channels to keep searching."
          },
          createChannel: {
            title: "Create Are.na channel",
            nameLabel: "Channel name",
            namePlaceholder: "My channel",
            visibilityLabel: "Visibility",
            visibilityPublic: "Public - anyone can view and add",
            visibilityClosed: "Closed - anyone can view, only you can add",
            visibilityPrivate: "Private - only you can view and add",
            submit: "Create channel"
          }
        },
        commands: {
          getBlocksFromChannel: "Get blocks from a channel",
          browseMyChannels: "Browse my channels",
          createChannel: "Create Are.na channel",
          refreshChannelsCache: "Refresh channels list",
          syncFolderWithChannel: "Sync folder with Are.na channel",
          updateFolderFromChannel: "Update folder from linked Are.na channel",
          syncCurrentNoteFolderWithChannel: "Sync current note folder with Are.na channel",
          updateCurrentNoteFolderFromChannel: "Update current note folder from linked Are.na channel",
          pullBlock: "Update note from Are.na (Pull)",
          pushNote: "Send note to Are.na (Push)",
          getBlockById: "Get block by ID or URL",
          openBlockInArena: "Open block in Are.na",
          uploadFolderAsChannel: "Upload folder as Are.na channel"
        },
        prompts: {
          getBlocksFromChannelTitle: "Get blocks from a channel",
          getBlocksFromChannelPlaceholder: "channel slug or URL",
          pushToArenaTitle: "Send to Are.na",
          pushToArenaPlaceholder: "destination channel slug",
          getBlockByIdTitle: "Get block by ID or URL",
          getBlockByIdPlaceholder: "numeric ID or Are.na URL",
          selectDestinationChannel: "Select the destination channel",
          manualSlugInput: "Enter slug manually"
        },
        notices: {
          pluginLoaded: "Are.na Bridge v1.0.1-beta.3 loaded.",
          pluginUnloaded: "Are.na Bridge unloaded.",
          loadingYourChannels: "Loading your channels\u2026",
          loadingChannelsPage: "Loading channels\u2026 page {{page}} \xB7 {{total}} found",
          partialChannelsLoaded: 'A partial channel batch was loaded. Click "Load {{count}} more" to continue.',
          missingLocalCache: "Are.na returned 304 without local cache for {{path}}",
          blockedAssets: "{{count}} attachment{{suffix}} skipped because the type is not allowed. They were kept as remote links.{{sample}}",
          blockedAssetsSample: " Types: {{types}}.",
          importStopped: "Import stopped after {{count}} pages. For larger transfers, it is better to request permission from Are.na.",
          confirmNextPage: "Are.na recommends loading pages on demand. Page {{page}} of {{label}} has already been processed ({{total}}). Load the next page?",
          assetLimitReached: "The limit of {{count}} local attachments was reached in this run. The rest will stay linked remotely to avoid bulk downloads.",
          attachmentBlocked: "Attachment blocked by unsupported type ({{contentType}} \xB7 {{url}})",
          attachmentBlockedByPolicy: "Attachment blocked by type policy ({{contentType}} \xB7 {{url}})",
          attachmentDownloadFailed: "Could not download attachment ({{status}})",
          usernameMissing: "Configure your username in the settings.",
          noChannelsFound: "No channels found.",
          errorLoadingChannels: "Error loading channels: {{error}}",
          channelCreated: 'Channel "{{title}}" created on Are.na',
          errorCreatingChannel: "Error creating channel: {{error}}",
          channelsCacheCleared: 'Channels cache cleared. The next "Browse my channels" will fetch it again.',
          folderHasNoNotes: "This folder does not contain any `.md` notes.",
          folderMissingLinkedChannel: "This folder is not linked to a single Are.na channel yet.",
          folderAlreadyLinkedChannel: "This folder is already linked to /{{channel}}. Reusing that channel instead of creating a new one.",
          folderLinkedChannelDeleted: "The linked channel /{{channel}} no longer exists on Are.na. A new channel will be created.",
          creatingChannel: 'Creating channel "{{title}}"\u2026',
          uploadingNotesProgress: "Uploading notes\u2026 {{uploaded}}/{{total}}",
          folderUploadSummary: '{{uploaded}} notes uploaded to channel "{{title}}"',
          folderUploadSummarySkipped: '{{uploaded}} notes uploaded to channel "{{title}}" \xB7 {{skipped}} skipped because of {{flag}}',
          genericError: "Error: {{error}}",
          noteMarkedSkipped: "This note is marked with {{flag}}: true.",
          noteMissingBlockIdFrontmatter: "This note does not have `blockid` in frontmatter.",
          pullSkippedToProtectLocalOnlyMarkdown: "Pull skipped to protect local-only Markdown that is excluded from publishing.",
          noteUpdatedFromBlock: "Note updated from block {{id}}",
          blockUpdated: "Block {{id}} updated on Are.na",
          warningLoadingChannelList: "Could not load the channel list: {{error}}",
          notePublished: "Published to /{{channel}} as block {{id}}",
          couldNotExtractBlockId: "Could not extract the ID.",
          blockImported: "Block {{id}} imported",
          noteMissingBlockId: "This note does not have `blockid`.",
          downloadingChannel: 'Downloading channel "{{slug}}"\u2026',
          channelImportSummary: '"{{title}}": {{saved}} blocks imported',
          channelImportSummarySkipped: '"{{title}}": {{saved}} blocks imported \xB7 {{skipped}} skipped because of {{flag}}',
          channelImportProtectedLocalOnlyMarkdown: "{{count}} note(s) were not overwritten to protect local-only Markdown excluded from publishing.",
          blockImportSkippedToProtectLocalOnlyMarkdown: "The note was not overwritten to protect local-only Markdown excluded from publishing.",
          configureToken: "Configure your Personal Access Token in the plugin settings.",
          languageChanged: "Language updated. Reload the plugin or restart Obsidian to refresh command names.",
          channelCacheCleared: "User/channel cache cleared.",
          blockCacheCleared: "Blocks cache cleared.",
          allCacheCleared: "All plugin cache has been cleared."
        },
        settings: {
          title: "Are.na Bridge",
          tokenName: "Personal Access Token",
          tokenDesc: "Get your token from are.na/settings/oauth. For Push and channel creation, use the `write` scope. Once saved, the token is hidden.",
          tokenPlaceholder: "Your Are.na token",
          usernameName: "Username (slug)",
          usernameDesc: "Your Are.na slug, for example `marco-noris`.",
          usernamePlaceholder: "your-username",
          languageName: "Language",
          languageDesc: "Default UI language for the plugin. Command names update after reloading the plugin.",
          languageAuto: "Auto (system)",
          languageEnglish: "English",
          languageSpanish: "Spanish",
          folderName: "Folder",
          folderDesc: "Vault folder where imported blocks will be stored",
          downloadAttachmentsName: "Download attachments",
          downloadAttachmentsDesc: "Automatically download allowed attachments (images, PDF, EPUB, audio, video, and plain text)",
          attachmentsFolderName: "Attachments folder",
          attachmentsFolderDesc: "Local folder name used for downloaded images and attachments",
          publishCodeBlockFilterName: "Skip code block languages on publish",
          publishCodeBlockFilterDesc: "Comma-separated list of fenced code block languages to remove before sending Markdown to Are.na. Example: `dataview, mermaid`",
          publishStripCalloutsName: "Skip callouts on publish",
          publishStripCalloutsDesc: "Remove Obsidian callout blocks like `> [!note]` before sending Markdown to Are.na.",
          cacheDiagnosticsTitle: "Cache diagnostics",
          cacheStatusName: "Cache status",
          cacheStatusSummary: "{{total}} API responses \xB7 {{users}} user \xB7 {{channels}} channels \xB7 {{blocks}} blocks \xB7 {{other}} other endpoints \xB7 {{localChannels}} channels in local list",
          clearChannelsButton: "Clear channels",
          clearBlocksButton: "Clear blocks",
          clearAllButton: "Clear all"
        },
        manifest: {
          description: "Connect your Obsidian vault with Are.na. Import blocks and channels, publish notes, and sync content."
        }
      },
      es: {
        common: {
          accept: "Aceptar",
          cancel: "Cancelar",
          continue: "Continuar",
          refresh: "Refrescar",
          untitled: "Sin titulo",
          attachment: "Adjunto",
          image: "imagen",
          block: "Bloque",
          loadingChannels: "Cargando canales\u2026",
          loadingMoreChannels: "Cargando m\xE1s canales\u2026",
          noContentType: "sin content-type",
          noExtension: "sin extensi\xF3n",
          blocks: "bloques",
          unnamedChannel: "Canal sin nombre"
        },
        modals: {
          confirm: {
            title: "Confirmar acci\xF3n"
          },
          channelSelect: {
            title: "Selecciona un canal de Are.na",
            emptyMessage: "Sin resultados.",
            manualButton: "Usar slug manual",
            refreshButton: "Refrescar",
            filterPlaceholder: "Filtrar canales\u2026",
            updating: "Actualizando canales\u2026",
            updated: "Lista actualizada.",
            refreshFailed: "No se pudo refrescar: {{error}}",
            loadMoreRemote: "Cargar {{count}} m\xE1s",
            loadMoreVisible: "Mostrar {{count}} m\xE1s",
            loadingMore: "Cargando m\xE1s canales\u2026",
            loadMoreFailed: "No se pudo cargar m\xE1s: {{error}}",
            loadedSummary: "Mostrando {{visible}}/{{filtered}} \xB7 {{loaded}}",
            loadedCount: "{{count}} cargados",
            loadedCountWithTotal: "{{count}}/{{total}} cargados",
            emptyWithMore: "{{message}} Carga m\xE1s canales para seguir buscando."
          },
          createChannel: {
            title: "Crear canal en Are.na",
            nameLabel: "Nombre del canal",
            namePlaceholder: "Mi canal",
            visibilityLabel: "Visibilidad",
            visibilityPublic: "P\xFAblico - cualquiera puede ver y a\xF1adir",
            visibilityClosed: "Cerrado - cualquiera puede ver, solo t\xFA a\xF1ades",
            visibilityPrivate: "Privado - solo t\xFA puedes ver y a\xF1adir",
            submit: "Crear canal"
          }
        },
        commands: {
          getBlocksFromChannel: "Obtener bloques de un canal",
          browseMyChannels: "Explorar mis canales",
          createChannel: "Crear canal en Are.na",
          refreshChannelsCache: "Actualizar lista de canales (refresco)",
          syncFolderWithChannel: "Sincronizar carpeta con canal de Are.na",
          updateFolderFromChannel: "Actualizar carpeta desde el canal vinculado de Are.na",
          syncCurrentNoteFolderWithChannel: "Sincronizar la carpeta de la nota actual con Are.na",
          updateCurrentNoteFolderFromChannel: "Actualizar la carpeta de la nota actual desde Are.na",
          pullBlock: "Actualizar nota desde Are.na (Pull)",
          pushNote: "Enviar nota a Are.na (Push)",
          getBlockById: "Obtener bloque por ID o URL",
          openBlockInArena: "Abrir bloque en Are.na",
          uploadFolderAsChannel: "Subir carpeta como canal a Are.na"
        },
        prompts: {
          getBlocksFromChannelTitle: "Obtener bloques de canal",
          getBlocksFromChannelPlaceholder: "slug o URL del canal",
          pushToArenaTitle: "Enviar a Are.na",
          pushToArenaPlaceholder: "slug del canal destino",
          getBlockByIdTitle: "Obtener bloque por ID o URL",
          getBlockByIdPlaceholder: "ID num\xE9rico o URL de Are.na",
          selectDestinationChannel: "Selecciona el canal destino",
          manualSlugInput: "Introducir slug manual"
        },
        notices: {
          pluginLoaded: "Are.na Bridge v1.0.1-beta.3 cargado.",
          pluginUnloaded: "Are.na Bridge descargado.",
          loadingYourChannels: "Cargando tus canales\u2026",
          loadingChannelsPage: "Cargando canales\u2026 p\xE1g. {{page}} \xB7 {{total}} encontrados",
          partialChannelsLoaded: 'Se carg\xF3 un tramo parcial de canales. Pulsa "Cargar {{count}} m\xE1s" para seguir.',
          missingLocalCache: "Are.na devolvi\xF3 304 sin cach\xE9 local para {{path}}",
          blockedAssets: "Se omitieron {{count}} adjunto{{suffix}} por tipo no permitido. Se mantuvieron como enlaces remotos.{{sample}}",
          blockedAssetsSample: " Tipos: {{types}}.",
          importStopped: "Importaci\xF3n detenida tras {{count}} p\xE1ginas. Para cargas m\xE1s grandes, conviene pedir permiso a Are.na.",
          confirmNextPage: "Are.na recomienda cargar p\xE1ginas bajo demanda. Ya se proces\xF3 la p\xE1gina {{page}} de {{label}} ({{total}}). \xBFCargar la siguiente p\xE1gina?",
          assetLimitReached: "Se alcanz\xF3 el l\xEDmite de {{count}} adjuntos locales en esta ejecuci\xF3n. El resto quedar\xE1 enlazado en remoto para evitar descargas masivas.",
          attachmentBlocked: "Adjunto bloqueado por tipo no permitido ({{contentType}} \xB7 {{url}})",
          attachmentBlockedByPolicy: "Adjunto bloqueado por pol\xEDtica de tipos ({{contentType}} \xB7 {{url}})",
          attachmentDownloadFailed: "No se pudo descargar adjunto ({{status}})",
          usernameMissing: "Configura tu nombre de usuario en los ajustes.",
          noChannelsFound: "No se encontraron canales.",
          errorLoadingChannels: "Error al cargar canales: {{error}}",
          channelCreated: 'Canal "{{title}}" creado en Are.na',
          errorCreatingChannel: "Error al crear canal: {{error}}",
          channelsCacheCleared: 'Cach\xE9 de canales borrado. El pr\xF3ximo "Explorar mis canales" lo descargar\xE1 de nuevo.',
          folderHasNoNotes: "La carpeta no contiene notas `.md`.",
          folderMissingLinkedChannel: "Esta carpeta todav\xEDa no est\xE1 vinculada a un \xFAnico canal de Are.na.",
          folderAlreadyLinkedChannel: "Esta carpeta ya est\xE1 vinculada a /{{channel}}. Se reutilizar\xE1 ese canal en vez de crear otro.",
          folderLinkedChannelDeleted: "El canal vinculado /{{channel}} ya no existe en Are.na. Se crear\xE1 uno nuevo.",
          creatingChannel: 'Creando canal "{{title}}"\u2026',
          uploadingNotesProgress: "Subiendo notas\u2026 {{uploaded}}/{{total}}",
          folderUploadSummary: '{{uploaded}} notas subidas al canal "{{title}}"',
          folderUploadSummarySkipped: '{{uploaded}} notas subidas al canal "{{title}}" \xB7 {{skipped}} omitidas por {{flag}}',
          genericError: "Error: {{error}}",
          noteMarkedSkipped: "Esta nota est\xE1 marcada con {{flag}}: true.",
          noteMissingBlockIdFrontmatter: "Esta nota no tiene `blockid` en el frontmatter.",
          pullSkippedToProtectLocalOnlyMarkdown: "Pull omitido para proteger Markdown local que est\xE1 excluido de la publicaci\xF3n.",
          noteUpdatedFromBlock: "Nota actualizada desde bloque {{id}}",
          blockUpdated: "Bloque {{id}} actualizado en Are.na",
          warningLoadingChannelList: "No se pudo cargar la lista de canales: {{error}}",
          notePublished: "Publicado en /{{channel}} como bloque {{id}}",
          couldNotExtractBlockId: "No se pudo extraer el ID.",
          blockImported: "Bloque {{id}} importado",
          noteMissingBlockId: "Esta nota no tiene `blockid`.",
          downloadingChannel: 'Descargando canal "{{slug}}"\u2026',
          channelImportSummary: '"{{title}}": {{saved}} bloques importados',
          channelImportSummarySkipped: '"{{title}}": {{saved}} bloques importados \xB7 {{skipped}} omitidos por {{flag}}',
          channelImportProtectedLocalOnlyMarkdown: "No se sobrescribieron {{count}} nota(s) para proteger Markdown local excluido de la publicaci\xF3n.",
          blockImportSkippedToProtectLocalOnlyMarkdown: "La nota no se sobrescribi\xF3 para proteger Markdown local excluido de la publicaci\xF3n.",
          configureToken: "Configura tu Personal Access Token en los ajustes del plugin.",
          languageChanged: "Idioma actualizado. Recarga el plugin o reinicia Obsidian para refrescar los nombres de comandos.",
          channelCacheCleared: "Cach\xE9 de usuario/canales vaciada.",
          blockCacheCleared: "Cach\xE9 de bloques vaciada.",
          allCacheCleared: "Toda la cach\xE9 del plugin ha sido vaciada."
        },
        settings: {
          title: "Are.na Bridge",
          tokenName: "Personal Access Token",
          tokenDesc: "Obt\xE9n tu token en are.na/settings/oauth. Para Push y crear canales, usa scope `write`. Una vez guardado, el token queda oculto.",
          tokenPlaceholder: "Tu token de Are.na",
          usernameName: "Usuario (slug)",
          usernameDesc: "Tu slug de Are.na, ej. `marco-noris`.",
          usernamePlaceholder: "tu-usuario",
          languageName: "Idioma",
          languageDesc: "Idioma por defecto de la interfaz del plugin. Los nombres de comandos cambian al recargar el plugin.",
          languageAuto: "Autom\xE1tico (sistema)",
          languageEnglish: "Ingl\xE9s",
          languageSpanish: "Espa\xF1ol",
          folderName: "Carpeta",
          folderDesc: "Carpeta del vault donde se guardar\xE1n los bloques importados",
          downloadAttachmentsName: "Descargar adjuntos",
          downloadAttachmentsDesc: "Descarga autom\xE1ticamente adjuntos permitidos (im\xE1genes, PDF, EPUB, audio, v\xEDdeo y texto plano)",
          attachmentsFolderName: "Carpeta de adjuntos",
          attachmentsFolderDesc: "Nombre de la carpeta local donde se guardan im\xE1genes y adjuntos descargados",
          publishCodeBlockFilterName: "Omitir lenguajes de bloque de c\xF3digo al publicar",
          publishCodeBlockFilterDesc: "Lista separada por comas con los lenguajes de fenced code blocks que se eliminar\xE1n antes de enviar el Markdown a Are.na. Ejemplo: `dataview, mermaid`",
          publishStripCalloutsName: "Omitir callouts al publicar",
          publishStripCalloutsDesc: "Elimina bloques callout de Obsidian como `> [!note]` antes de enviar el Markdown a Are.na.",
          cacheDiagnosticsTitle: "Diagn\xF3stico de cach\xE9",
          cacheStatusName: "Estado de la cach\xE9",
          cacheStatusSummary: "{{total}} respuestas API \xB7 {{users}} de usuario \xB7 {{channels}} de canales \xB7 {{blocks}} de bloques \xB7 {{other}} de otros endpoints \xB7 {{localChannels}} canales en lista local",
          clearChannelsButton: "Vaciar canales",
          clearBlocksButton: "Vaciar bloques",
          clearAllButton: "Vaciar todo"
        },
        manifest: {
          description: "Conecta tu b\xF3veda de Obsidian con Are.na. Importa bloques y canales, publica notas y sincroniza contenido."
        }
      }
    };
    function interpolate(template, variables = {}) {
      return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const value = variables[key];
        return value == null ? "" : String(value);
      });
    }
    function getTranslation(language, key) {
      return key.split(".").reduce((current, part) => {
        if (!current || typeof current !== "object") return void 0;
        return current[part];
      }, TRANSLATIONS[language]);
    }
    function detectSystemLanguage() {
      const candidates = [];
      if (typeof navigator !== "undefined") {
        if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
        if (navigator.language) candidates.push(navigator.language);
      }
      for (const candidate of candidates) {
        const normalized = String(candidate || "").trim().toLowerCase();
        if (!normalized) continue;
        if (normalized.startsWith("es")) return "es";
        if (normalized.startsWith("en")) return "en";
      }
      return "en";
    }
    function resolveLanguage(preference = LANGUAGE_PREFERENCE_AUTO) {
      if (SUPPORTED_LANGUAGES.includes(preference)) return preference;
      return detectSystemLanguage();
    }
    function createTranslator(preference = LANGUAGE_PREFERENCE_AUTO) {
      let language = resolveLanguage(preference);
      return {
        get language() {
          return language;
        },
        setPreference(nextPreference) {
          language = resolveLanguage(nextPreference);
          return language;
        },
        t(key, variables = {}) {
          const template = getTranslation(language, key) ?? getTranslation("en", key);
          if (template == null) return key;
          if (typeof template !== "string") return template;
          return interpolate(template, variables);
        }
      };
    }
    module2.exports = {
      SUPPORTED_LANGUAGES,
      LANGUAGE_PREFERENCE_AUTO,
      createTranslator
    };
  }
});

// src/note-utils.js
var require_note_utils = __commonJS({
  "src/note-utils.js"(exports2, module2) {
    "use strict";
    var { SYNC_SKIP_FLAG } = require_constants();
    function sanitizeFilename(name) {
      return (name || "Untitled").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100);
    }
    function sanitizeFolderName(name) {
      return (name || "Untitled").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100);
    }
    function formatDate(dateStr) {
      if (!dateStr) return "";
      return dateStr.split("T")[0];
    }
    function isTruthyFrontmatterValue(value) {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      if (typeof value !== "string") return false;
      return ["true", "1", "yes", "si", "on"].includes(value.trim().toLowerCase());
    }
    function isSyncSkipped(frontmatter = {}) {
      return isTruthyFrontmatterValue(frontmatter[SYNC_SKIP_FLAG]);
    }
    function getArenaFrontmatter(block, channelSlug = "", existingFrontmatter = {}) {
      const frontmatter = {
        blockid: block.id,
        class: block.class || block.type || "",
        title: block.title || "",
        user: block.user?.slug || "",
        channel: channelSlug,
        created_at: formatDate(block.created_at),
        updated_at: formatDate(block.updated_at)
      };
      if (block.source?.title) frontmatter.source_title = block.source.title;
      if (block.source?.url) frontmatter.source_url = block.source.url;
      if (isSyncSkipped(existingFrontmatter)) frontmatter[SYNC_SKIP_FLAG] = true;
      return frontmatter;
    }
    function stringifyFrontmatterValue(value) {
      if (typeof value === "boolean") return value ? "true" : "false";
      if (typeof value === "number") return String(value);
      if (value == null) return '""';
      return JSON.stringify(String(value));
    }
    function frontmatterObjectToYaml(frontmatter = {}) {
      const lines = ["---"];
      for (const [key, value] of Object.entries(frontmatter)) {
        lines.push(`${key}: ${stringifyFrontmatterValue(value)}`);
      }
      lines.push("---");
      return lines.join("\n");
    }
    function extractText(value, { preferMarkdown = false } = {}) {
      if (!value) return "";
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      if (Array.isArray(value)) {
        return value.map((item) => extractText(item, { preferMarkdown })).filter(Boolean).join("\n\n");
      }
      if (typeof value === "object") {
        if (preferMarkdown && typeof value.markdown === "string" && value.markdown.trim()) return value.markdown;
        if (typeof value.plain === "string" && value.plain.trim()) return value.plain;
        if (typeof value.markdown === "string" && value.markdown.trim()) return value.markdown;
        if (typeof value.html === "string" && value.html.trim()) return value.html;
        if (typeof value.content === "string" && value.content.trim()) return value.content;
        if (typeof value.value === "string" && value.value.trim()) return value.value;
      }
      return "";
    }
    function blockToContent(block, options = {}) {
      const parts = [];
      const type = block.class || block.type || "";
      if (type === "Text" || type === "Media") {
        const text = extractText(block.content, { preferMarkdown: true });
        if (text) parts.push(text);
      } else if (type === "Link") {
        const sourceUrl = options.sourceUrl || block.source?.url;
        if (sourceUrl) parts.push(`[${block.source.title || block.title || sourceUrl}](${sourceUrl})`);
        const description = extractText(block.description);
        if (description) parts.push("\n" + description);
      } else if (type === "Image") {
        const imageSrc = options.imageSrc || block.image?.src;
        if (imageSrc) {
          if (options.useObsidianLinks) parts.push(`![[${imageSrc}]]`);
          else parts.push(`![${block.title || ""}](${imageSrc})`);
        }
        const description = extractText(block.description);
        if (description) parts.push("\n" + description);
      } else if (type === "Attachment") {
        const attachmentUrl = options.attachmentUrl || block.attachment?.url;
        if (attachmentUrl) {
          if (options.useObsidianLinks) parts.push(`[[${attachmentUrl}]]`);
          else parts.push(`[${block.title || "Attachment"}](${attachmentUrl})`);
        }
        const description = extractText(block.description);
        if (description) parts.push("\n" + description);
      } else {
        const content = extractText(block.content);
        const description = extractText(block.description);
        if (content) parts.push(content);
        if (description) parts.push(description);
      }
      return parts.filter(Boolean).join("\n\n");
    }
    function splitNoteContent(noteContent) {
      const match = noteContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) return { frontmatterRaw: "", body: noteContent, hasFrontmatter: false };
      return {
        frontmatterRaw: match[1],
        body: match[2].trim(),
        hasFrontmatter: true
      };
    }
    function escapeRegex(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function extractFrontmatterScalar(noteContent, key) {
      const { frontmatterRaw, hasFrontmatter } = splitNoteContent(noteContent);
      if (!hasFrontmatter) return null;
      const pattern = new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "m");
      const match = frontmatterRaw.match(pattern);
      if (!match) return null;
      const value = match[1].trim();
      if (!value) return "";
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1);
      }
      return value;
    }
    function replaceBodyPreservingFrontmatter(noteContent, body) {
      const { frontmatterRaw, hasFrontmatter } = splitNoteContent(noteContent);
      const trimmedBody = (body || "").trim();
      if (!hasFrontmatter) return trimmedBody;
      return trimmedBody ? `---
${frontmatterRaw}
---

${trimmedBody}` : `---
${frontmatterRaw}
---
`;
    }
    function normalizeCodeFenceLanguage(infoString = "") {
      const normalized = String(infoString || "").trim().toLowerCase();
      if (!normalized) return "";
      const token = normalized.split(/\s+/)[0] || "";
      return token.replace(/^\{+/, "").replace(/\}+$/, "");
    }
    function isCodeFenceClose(line, marker, size) {
      const trimmed = String(line || "").trim();
      if (!trimmed) return false;
      return new RegExp(`^\\${marker}{${size},}\\s*$`).test(trimmed);
    }
    function filterMarkdownCodeBlocks(noteContent, excludedLanguages = []) {
      const source = String(noteContent || "");
      if (!source.trim()) return { content: source, removedBlocks: 0 };
      const excluded = new Set(
        (Array.isArray(excludedLanguages) ? excludedLanguages : []).map((language) => normalizeCodeFenceLanguage(language)).filter(Boolean)
      );
      if (excluded.size === 0) return { content: source, removedBlocks: 0 };
      const lines = source.split(/\r?\n/);
      const result = [];
      let removedBlocks = 0;
      let activeFence = null;
      for (const line of lines) {
        if (!activeFence) {
          const match = String(line).match(/^\s*(`{3,}|~{3,})(.*)$/);
          if (!match) {
            result.push(line);
            continue;
          }
          const fence = match[1];
          const language = normalizeCodeFenceLanguage(match[2]);
          const excludedFence = language && excluded.has(language);
          activeFence = {
            marker: fence[0],
            size: fence.length,
            excluded: excludedFence
          };
          if (excludedFence) {
            removedBlocks++;
            continue;
          }
          result.push(line);
          continue;
        }
        if (isCodeFenceClose(line, activeFence.marker, activeFence.size)) {
          const shouldKeepCloseFence = !activeFence.excluded;
          activeFence = null;
          if (shouldKeepCloseFence) result.push(line);
          continue;
        }
        if (!activeFence.excluded) result.push(line);
      }
      return { content: result.join("\n"), removedBlocks };
    }
    function isMarkdownCalloutStart(line) {
      return /^\s*>\s*\[![^\]]+\][+-]?\s*/i.test(String(line || ""));
    }
    function isMarkdownBlockquoteLine(line) {
      return /^\s*>/.test(String(line || ""));
    }
    function filterMarkdownCallouts(noteContent, { stripCallouts = false } = {}) {
      const source = String(noteContent || "");
      if (!source.trim() || !stripCallouts) return { content: source, removedCallouts: 0 };
      const lines = source.split(/\r?\n/);
      const result = [];
      let removedCallouts = 0;
      let insideCallout = false;
      for (const line of lines) {
        if (!insideCallout) {
          if (isMarkdownCalloutStart(line)) {
            insideCallout = true;
            removedCallouts++;
            continue;
          }
          result.push(line);
          continue;
        }
        if (isMarkdownBlockquoteLine(line)) continue;
        insideCallout = false;
        result.push(line);
      }
      return { content: result.join("\n"), removedCallouts };
    }
    module2.exports = {
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
      filterMarkdownCallouts
    };
  }
});

// src/plugin.js
var require_plugin = __commonJS({
  "src/plugin.js"(exports2, module2) {
    "use strict";
    var { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath, requestUrl } = require("obsidian");
    var {
      DEFAULT_FOLDER,
      SYNC_SKIP_FLAG,
      ARENA_FRONTMATTER_KEYS,
      DEFAULT_SETTINGS,
      CHANNEL_SELECT_BATCH_SIZE,
      ARENA_MAX_PAGES_PER_RUN,
      ARENA_MAX_ASSET_DOWNLOADS_PER_RUN,
      ARENA_RESPONSE_CACHE_LIMIT,
      ALLOWED_ATTACHMENT_MIME_TYPES,
      ALLOWED_ATTACHMENT_EXTENSIONS
    } = require_constants();
    var { ArenaClient } = require_arena_client();
    var { InputModal, ConfirmModal, ChannelSelectModal, CreateChannelModal } = require_modals();
    var { SUPPORTED_LANGUAGES, LANGUAGE_PREFERENCE_AUTO, createTranslator } = require_i18n();
    var {
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
      filterMarkdownCallouts
    } = require_note_utils();
    function createChannelBrowserState() {
      return {
        nextPage: 1,
        totalChannels: null,
        exhausted: false
      };
    }
    function getHeaderValue(headers = {}, name) {
      const target = String(name || "").toLowerCase();
      for (const [key, value] of Object.entries(headers || {})) {
        if (String(key).toLowerCase() === target) return String(value);
      }
      return "";
    }
    var ArenaManagerPlugin = class extends Plugin {
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
          counts = /* @__PURE__ */ new Map();
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
        const storedCount = stored && preferred?.counts ? preferred.counts.get(stored) || 0 : 0;
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
        const list = Array.isArray(channels) ? channels : Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache : [];
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
        const list = Array.isArray(channels) ? channels : Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache : [];
        const state = this.getChannelBrowserState();
        const total = Number.isFinite(state.totalChannels) ? state.totalChannels : list.length;
        const hasMore = !state.exhausted && (!Number.isFinite(state.totalChannels) || list.length < state.totalChannels);
        return {
          channels: list,
          total,
          hasMore
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
        const query = entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&");
        return `${path}?${query}`;
      }
      pruneResponseCache() {
        const cache = this.getResponseCache();
        const touches = this.getCacheTouches();
        const entries = Object.entries(cache);
        if (entries.length <= ARENA_RESPONSE_CACHE_LIMIT) return;
        entries.sort((left, right) => this.getCacheRecency(right[0], right[1]) - this.getCacheRecency(left[0], left[1])).slice(ARENA_RESPONSE_CACHE_LIMIT).forEach(([key]) => {
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
          updatedAt: Date.now()
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
          updatedAt: timestamp
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
            `/users/${this.settings.username}/contents`
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
          `/channels/${identifier}/contents`
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
            `/channels/${channelIdentifier}/contents`
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
          localChannels: Array.isArray(this.settings.channelsCache) ? this.settings.channelsCache.length : 0
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
        const index = /* @__PURE__ */ new Map();
        const channelFolders = /* @__PURE__ */ new Map();
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
        return String(this.settings.publishCodeBlockFilter || "").split(",").map((value) => normalizeCodeFenceLanguage(value)).filter(Boolean);
      }
      prepareBodyForArena(body) {
        const codeBlockResult = filterMarkdownCodeBlocks(body, this.getPublishCodeBlockFilterLanguages());
        return filterMarkdownCallouts(codeBlockResult.content, {
          stripCallouts: this.settings.publishStripCallouts
        });
      }
      noteHasPublishOnlyContent(body) {
        return this.prepareBodyForArena(body).content !== String(body || "");
      }
      async getFolderLinkedChannelSlug(folder, files = null) {
        const folderPath = normalizePath(folder?.path || "");
        if (!folderPath) return "";
        const mappedSlugs = Object.entries(this.getChannelFolderMappings()).filter(([, path]) => normalizePath(path || "") === folderPath).map(([slug]) => String(slug || "").trim()).filter(Boolean);
        if (mappedSlugs.length === 1) return mappedSlugs[0];
        const noteFiles = Array.isArray(files) ? files : folder.children.filter((file) => file instanceof TFile && file.extension === "md");
        const noteSlugs = /* @__PURE__ */ new Set();
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
        const mappedSlugs = Object.entries(this.getChannelFolderMappings()).filter(([, path]) => normalizePath(path || "") === folderPath).map(([slug]) => String(slug || "").trim()).filter(Boolean);
        if (mappedSlugs.length === 1) return mappedSlugs[0];
        const noteFiles = Array.isArray(files) ? files : folder.children.filter((file) => file instanceof TFile && file.extension === "md");
        const noteSlugs = /* @__PURE__ */ new Set();
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
          blockedAssetTypes: []
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
        const sample = transferState.blockedAssetTypes.length > 0 ? this.t("notices.blockedAssetsSample", { types: transferState.blockedAssetTypes.join(", ") }) : "";
        new Notice(
          this.t("notices.blockedAssets", { count, suffix, sample }),
          8e3
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
              t: this.t
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
          "video/ogg": ".ogg"
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
          const error2 = new Error(this.t("notices.attachmentBlocked", {
            contentType: normalizedContentType || this.t("common.noContentType"),
            url
          }));
          error2.assetBlockedByPolicy = true;
          error2.assetBlockedContentType = normalizedContentType || "";
          error2.assetBlockedExtension = normalizedExtension;
          throw error2;
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
          throw: false
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(this.t("notices.attachmentDownloadFailed", { status: response.status }));
        }
        const contentType = getHeaderValue(response.headers, "content-type");
        const extension = this.getFileExtensionFromContentType(contentType) || this.getFileExtensionFromUrl(url);
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
          const summary = skipped > 0 ? this.t("notices.folderUploadSummarySkipped", {
            uploaded,
            title: channel.title,
            skipped,
            flag: SYNC_SKIP_FLAG
          }) : this.t("notices.folderUploadSummary", { uploaded, title: channel.title });
          new Notice(summary);
        } finally {
          if (shouldHideNotice) progressNotice.hide();
        }
      }
      registerCommands() {
        this.addCommand({
          id: "get-blocks-from-channel",
          name: this.t("commands.getBlocksFromChannel"),
          callback: () => this.cmdGetBlocksFromChannel()
        });
        this.addCommand({
          id: "browse-my-channels",
          name: this.t("commands.browseMyChannels"),
          callback: () => this.cmdBrowseMyChannels()
        });
        this.addCommand({
          id: "create-channel",
          name: this.t("commands.createChannel"),
          callback: () => this.cmdCreateChannel()
        });
        this.addCommand({
          id: "refresh-channels-cache",
          name: this.t("commands.refreshChannelsCache"),
          callback: () => this.cmdRefreshChannelsCache()
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
          }
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
          }
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
          }
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
          }
        });
        this.addCommand({
          id: "get-block-by-id",
          name: this.t("commands.getBlockById"),
          callback: () => this.cmdGetBlockById()
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
          }
        });
      }
      registerFolderMenu() {
        this.registerEvent(
          this.app.workspace.on("file-menu", (menu, file) => {
            if (file instanceof TFolder) {
              const markdownFiles = file.children.filter((child) => child instanceof TFile && child.extension === "md");
              const linkedChannelSlug = this.getFolderLinkedChannelSlugFromCache(file, markdownFiles);
              menu.addItem((item) => {
                item.setTitle(this.t("commands.syncFolderWithChannel")).setIcon("upload").onClick(() => this.cmdUploadFolderAsChannel(file));
              });
              if (linkedChannelSlug) {
                menu.addItem((item) => {
                  item.setTitle(this.t("commands.updateFolderFromChannel")).setIcon("download").onClick(() => this.cmdPullFolderFromChannel(file));
                });
              }
              return;
            }
            if (!(file instanceof TFile) || file.extension !== "md") return;
            menu.addItem((item) => {
              item.setTitle(this.t("commands.pullBlock")).setIcon("download").onClick(() => this.cmdPullBlock(file));
            });
            menu.addItem((item) => {
              item.setTitle(this.t("commands.pushNote")).setIcon("upload").onClick(() => this.cmdPushNote(file));
            });
            menu.addItem((item) => {
              item.setTitle(this.t("commands.openBlockInArena")).setIcon("external-link").onClick(() => this.cmdOpenInArena(file));
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
            }
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
              notice
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
          new Notice(this.t("notices.pullSkippedToProtectLocalOnlyMarkdown"), 8e3);
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
            }
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
                new Notice(this.t("notices.blockImportSkippedToProtectLocalOnlyMarkdown"), 8e3);
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
        const url = channel && this.settings.username && !this.isNumericChannelIdentifier(channel) ? `https://www.are.na/${this.settings.username}/${channel}/blocks/${blockId}` : `https://www.are.na/block/${blockId}`;
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
          const summary = skippedByFlag > 0 ? this.t("notices.channelImportSummarySkipped", {
            title: channelTitle,
            saved,
            skipped: skippedByFlag,
            flag: SYNC_SKIP_FLAG
          }) : this.t("notices.channelImportSummary", { title: channelTitle, saved });
          new Notice(summary);
          if (skippedToProtectLocalOnly > 0) {
            new Notice(this.t("notices.channelImportProtectedLocalOnlyMarkdown", { count: skippedToProtectLocalOnly }), 8e3);
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
          const body2 = await this.buildImportedBlockContent(block, targetFolder, existing.path, transferState);
          await this.app.vault.modify(existing, replaceBodyPreservingFrontmatter(raw, body2));
          await this.mergeArenaFrontmatter(existing, block, channelSlug, frontmatter);
          if (channelSlug && existing.parent?.path) {
            this.recordChannelFolder(channelSlug, existing.parent.path);
          }
          index.set(blockKey, existing);
          return { written: true, reason: "" };
        }
        const frontmatterYaml = frontmatterObjectToYaml(getArenaFrontmatter(block, channelSlug));
        const filename = this.app.vault.getAbstractFileByPath(preferredPath) ? this.getUniqueNotePath(targetFolder, noteTitle) : preferredPath;
        const body = await this.buildImportedBlockContent(block, targetFolder, filename, transferState);
        const noteContent = `${frontmatterYaml}

${body}`;
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
    };
    var ArenaSettingsTab = class extends PluginSettingTab {
      constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
      }
      display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: this.plugin.t("settings.title") });
        new Setting(containerEl).setName(this.plugin.t("settings.tokenName")).setDesc(this.plugin.t("settings.tokenDesc")).addText(
          (text) => text.then(() => {
            text.inputEl.type = "password";
            text.inputEl.autocomplete = "off";
            text.inputEl.spellcheck = false;
          }).setPlaceholder(this.plugin.t("settings.tokenPlaceholder")).setValue(this.plugin.settings.token).onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName(this.plugin.t("settings.usernameName")).setDesc(this.plugin.t("settings.usernameDesc")).addText(
          (text) => text.setPlaceholder(this.plugin.t("settings.usernamePlaceholder")).setValue(this.plugin.settings.username).onChange(async (value) => {
            this.plugin.settings.username = value.trim();
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName(this.plugin.t("settings.languageName")).setDesc(this.plugin.t("settings.languageDesc")).addDropdown(
          (dropdown) => dropdown.addOption(LANGUAGE_PREFERENCE_AUTO, this.plugin.t("settings.languageAuto")).addOption("en", this.plugin.t("settings.languageEnglish")).addOption("es", this.plugin.t("settings.languageSpanish")).setValue(this.plugin.settings.language || LANGUAGE_PREFERENCE_AUTO).onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            this.display();
            new Notice(this.plugin.t("notices.languageChanged"));
          })
        );
        new Setting(containerEl).setName(this.plugin.t("settings.folderName")).setDesc(this.plugin.t("settings.folderDesc")).addText(
          (text) => text.setPlaceholder(DEFAULT_FOLDER).setValue(this.plugin.settings.folder).onChange(async (value) => {
            this.plugin.settings.folder = value.trim() || DEFAULT_FOLDER;
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName(this.plugin.t("settings.downloadAttachmentsName")).setDesc(this.plugin.t("settings.downloadAttachmentsDesc")).addToggle(
          (toggle) => toggle.setValue(this.plugin.settings.downloadAttachments).onChange(async (value) => {
            this.plugin.settings.downloadAttachments = value;
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName(this.plugin.t("settings.attachmentsFolderName")).setDesc(this.plugin.t("settings.attachmentsFolderDesc")).addText(
          (text) => text.setPlaceholder("_assets").setValue(this.plugin.settings.attachmentsFolderName || "_assets").onChange(async (value) => {
            this.plugin.settings.attachmentsFolderName = sanitizeFolderName(value.trim()) || "_assets";
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName(this.plugin.t("settings.publishCodeBlockFilterName")).setDesc(this.plugin.t("settings.publishCodeBlockFilterDesc")).addText(
          (text) => text.setPlaceholder("dataview, mermaid").setValue(this.plugin.settings.publishCodeBlockFilter || "").onChange(async (value) => {
            this.plugin.settings.publishCodeBlockFilter = value.split(",").map((part) => normalizeCodeFenceLanguage(part)).filter(Boolean).join(", ");
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName(this.plugin.t("settings.publishStripCalloutsName")).setDesc(this.plugin.t("settings.publishStripCalloutsDesc")).addToggle(
          (toggle) => toggle.setValue(this.plugin.settings.publishStripCallouts).onChange(async (value) => {
            this.plugin.settings.publishStripCallouts = value;
            await this.plugin.saveSettings();
          })
        );
        containerEl.createEl("h3", { text: this.plugin.t("settings.cacheDiagnosticsTitle") });
        const diagnostics = this.plugin.getCacheDiagnostics();
        const summary = this.plugin.t("settings.cacheStatusSummary", diagnostics);
        new Setting(containerEl).setName(this.plugin.t("settings.cacheStatusName")).setDesc(summary).addButton(
          (button) => button.setButtonText(this.plugin.t("settings.clearChannelsButton")).onClick(async () => {
            await this.plugin.clearChannelCaches();
            new Notice(this.plugin.t("notices.channelCacheCleared"));
            this.display();
          })
        ).addButton(
          (button) => button.setButtonText(this.plugin.t("settings.clearBlocksButton")).onClick(async () => {
            await this.plugin.clearBlockCaches();
            new Notice(this.plugin.t("notices.blockCacheCleared"));
            this.display();
          })
        ).addButton(
          (button) => button.setWarning().setButtonText(this.plugin.t("settings.clearAllButton")).onClick(async () => {
            await this.plugin.clearAllCaches();
            new Notice(this.plugin.t("notices.allCacheCleared"));
            this.display();
          })
        );
      }
    };
    module2.exports = ArenaManagerPlugin;
  }
});

// src/main.js
module.exports = require_plugin();
