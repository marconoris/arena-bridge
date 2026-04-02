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
      token: "",
      username: "",
      folder: DEFAULT_FOLDER,
      downloadAttachments: false,
      attachmentsFolderName: "_assets",
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
      ARENA_FRONTMATTER_KEYS,
      DEFAULT_SETTINGS
    };
  }
});

// src/arena-client.js
var require_arena_client = __commonJS({
  "src/arena-client.js"(exports2, module2) {
    "use strict";
    var { ARENA_API, ARENA_PAGE_SIZE, ARENA_REQUEST_DELAY_MS } = require_constants();
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
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
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`
        };
      }
      async paceRequest() {
        const waitMs = this.lastRequestAt + this.minRequestGapMs - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        this.lastRequestAt = Date.now();
      }
      getRetryDelayMs(res, attempt) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "", 10);
        if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1e3;
        const reset = parseInt(res.headers.get("X-RateLimit-Reset") || "", 10);
        if (Number.isFinite(reset) && reset > 0) {
          return Math.max(reset * 1e3 - Date.now(), 1e3);
        }
        return Math.min(5e3 * (attempt + 1), 15e3);
      }
      async requestJson(url, options = {}, requestOptions = {}) {
        let lastStatus = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
          await this.paceRequest();
          const res = await fetch(url, options);
          lastStatus = res.status;
          if (res.status === 429) {
            const waitMs = this.getRetryDelayMs(res, attempt);
            console.warn(`arena-manager: rate limit, esperando ${waitMs}ms`);
            await sleep(waitMs);
            continue;
          }
          if (requestOptions.allowNotModified && res.status === 304) {
            return {
              status: 304,
              data: null,
              etag: res.headers.get("ETag") || null
            };
          }
          if (!res.ok) {
            throw new Error(`Request failed, status ${res.status} \u2014 ${url.toString()}`);
          }
          const text = await res.text();
          return {
            status: res.status,
            data: text ? JSON.parse(text) : {},
            etag: res.headers.get("ETag") || null
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
        return this.requestJson(url.toString(), { headers }, { allowNotModified: true });
      }
      async post(path, body = {}) {
        const result = await this.requestJson(`${this.base}${path}`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body)
        });
        return result.data;
      }
      async put(path, body = {}) {
        const result = await this.requestJson(`${this.base}${path}`, {
          method: "PUT",
          headers: this.headers(),
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
    var InputModal = class extends Modal {
      constructor(app, title, placeholder, onSubmit) {
        super(app);
        this.title = title;
        this.placeholder = placeholder;
        this.onSubmit = onSubmit;
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: this.title });
        const input = contentEl.createEl("input", { type: "text", placeholder: this.placeholder });
        input.style.cssText = "width:100%;margin:12px 0;padding:8px;font-size:14px;";
        input.focus();
        const button = contentEl.createEl("button", { text: "Aceptar" });
        button.style.cssText = "float:right;margin-top:8px;";
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
    var ChannelSelectModal = class extends Modal {
      constructor(app, channels, onSelect, options = {}) {
        super(app);
        this.channels = Array.isArray(channels) ? channels : [];
        this.onSelect = onSelect;
        this.title = options.title || "Selecciona un canal de Are.na";
        this.emptyMessage = options.emptyMessage || "Sin resultados.";
        this.onManualInput = options.onManualInput || null;
        this.manualButtonText = options.manualButtonText || "Usar slug manual";
        this.onRefresh = options.onRefresh || null;
        this.refreshButtonText = options.refreshButtonText || "Refrescar";
        this.onLoadMore = options.onLoadMore || null;
        this.hasMore = Boolean(options.hasMore);
        this.totalChannels = Number.isFinite(options.totalChannels) ? options.totalChannels : null;
        this.pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? options.pageSize : 12;
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: this.title });
        const actionsEl = contentEl.createEl("div");
        actionsEl.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px;";
        const searchInput = contentEl.createEl("input", { type: "text", placeholder: "Filtrar canales\u2026" });
        searchInput.style.cssText = "width:100%;margin:0 0 12px;padding:8px;font-size:13px;";
        let visibleCount = this.pageSize;
        let messageEl = null;
        let summaryEl = null;
        const setMessage = (message = "") => {
          if (!messageEl) {
            messageEl = contentEl.createEl("div");
            messageEl.style.cssText = "font-size:12px;color:var(--text-muted);margin:-4px 0 8px;";
          }
          messageEl.setText(message);
        };
        const setSummary = (message = "") => {
          if (!summaryEl) {
            summaryEl = contentEl.createEl("div");
            summaryEl.style.cssText = "font-size:12px;color:var(--text-muted);margin:-4px 0 8px;";
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
            setMessage("Actualizando canales\u2026");
            try {
              applyChannelState(await this.onRefresh());
              visibleCount = this.pageSize;
              setMessage("Lista actualizada.");
              renderList(searchInput.value);
            } catch (error) {
              setMessage(`No se pudo refrescar: ${error.message}`);
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
        const list = contentEl.createEl("div");
        list.style.cssText = "max-height:360px;overflow-y:auto;";
        const loadMoreWrap = contentEl.createEl("div");
        loadMoreWrap.style.cssText = "display:flex;justify-content:flex-end;margin-top:12px;";
        const loadMoreButton = loadMoreWrap.createEl("button");
        loadMoreButton.setText(`Cargar ${this.pageSize} m\xE1s`);
        const renderList = (filter = "") => {
          list.empty();
          const filtered = getFilteredChannels(filter);
          const visible = filtered.slice(0, visibleCount);
          const loadedLabel = Number.isFinite(this.totalChannels) ? `${this.channels.length}/${this.totalChannels} cargados` : `${this.channels.length} cargados`;
          setSummary(`Mostrando ${visible.length}/${filtered.length} \xB7 ${loadedLabel}`);
          if (visible.length === 0) {
            const emptyText = this.hasMore ? `${this.emptyMessage} Carga m\xE1s canales para seguir buscando.` : this.emptyMessage;
            list.createEl("p", { text: emptyText });
          }
          for (const channel of visible) {
            const item = list.createEl("div");
            item.style.cssText = "padding:8px 12px;cursor:pointer;border-radius:4px;margin-bottom:2px;";
            item.onmouseenter = () => {
              item.style.background = "var(--background-modifier-hover)";
            };
            item.onmouseleave = () => {
              item.style.background = "";
            };
            item.createEl("strong", { text: channel.title || channel.slug || "Canal sin nombre" });
            const count = channel.counts?.contents ?? channel.length ?? 0;
            const visibility = channel.visibility || "";
            const meta = item.createEl("span", { text: ` \xB7 ${count} bloques \xB7 ${visibility}` });
            meta.style.cssText = "font-size:11px;color:var(--text-muted);";
            item.onclick = () => {
              this.close();
              this.onSelect(channel);
            };
          }
          const hasMoreVisible = filtered.length > visibleCount;
          const canLoadRemote = this.hasMore && Boolean(this.onLoadMore);
          loadMoreWrap.style.display = hasMoreVisible || canLoadRemote ? "flex" : "none";
          if (hasMoreVisible) {
            loadMoreButton.setText(`Mostrar ${Math.min(this.pageSize, filtered.length - visibleCount)} m\xE1s`);
            return;
          }
          loadMoreButton.setText(`Cargar ${this.pageSize} m\xE1s`);
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
          setMessage("Cargando m\xE1s canales\u2026");
          try {
            applyChannelState(await this.onLoadMore());
            visibleCount += this.pageSize;
            setMessage("");
            renderList(filter);
          } catch (error) {
            setMessage(`No se pudo cargar m\xE1s: ${error.message}`);
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
      constructor(app, onSubmit, defaultTitle = "") {
        super(app);
        this.onSubmit = onSubmit;
        this.defaultTitle = defaultTitle;
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Crear canal en Are.na" });
        contentEl.createEl("label", { text: "Nombre del canal" });
        const titleInput = contentEl.createEl("input", { type: "text", placeholder: "Mi canal" });
        titleInput.style.cssText = "width:100%;margin:6px 0 16px;padding:8px;font-size:14px;";
        if (this.defaultTitle) titleInput.value = this.defaultTitle;
        contentEl.createEl("label", { text: "Visibilidad" });
        const select = contentEl.createEl("select");
        select.style.cssText = "width:100%;margin:6px 0 16px;padding:8px;font-size:14px;";
        [
          ["public", "P\xFAblico \u2014 cualquiera puede ver y a\xF1adir"],
          ["closed", "Cerrado \u2014 cualquiera puede ver, solo t\xFA a\xF1ades"],
          ["private", "Privado \u2014 solo t\xFA puedes ver y a\xF1adir"]
        ].forEach(([value, label]) => {
          const option = select.createEl("option", { text: label });
          option.value = value;
        });
        const button = contentEl.createEl("button", { text: "Crear canal" });
        button.style.cssText = "float:right;margin-top:8px;";
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
      ChannelSelectModal,
      CreateChannelModal
    };
  }
});

// src/note-utils.js
var require_note_utils = __commonJS({
  "src/note-utils.js"(exports2, module2) {
    "use strict";
    var { SYNC_SKIP_FLAG } = require_constants();
    function sanitizeFilename(name) {
      return (name || "Sin titulo").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100);
    }
    function sanitizeFolderName(name) {
      return (name || "Sin titulo").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100);
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
          else parts.push(`[${block.title || "Adjunto"}](${attachmentUrl})`);
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
    module2.exports = {
      sanitizeFilename,
      sanitizeFolderName,
      isSyncSkipped,
      getArenaFrontmatter,
      frontmatterObjectToYaml,
      blockToContent,
      splitNoteContent,
      extractFrontmatterScalar,
      replaceBodyPreservingFrontmatter
    };
  }
});

// src/plugin.js
var require_plugin = __commonJS({
  "src/plugin.js"(exports2, module2) {
    "use strict";
    var { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath } = require("obsidian");
    var {
      DEFAULT_FOLDER,
      SYNC_SKIP_FLAG,
      ARENA_FRONTMATTER_KEYS,
      DEFAULT_SETTINGS,
      CHANNEL_SELECT_BATCH_SIZE,
      ARENA_MAX_PAGES_PER_RUN,
      ARENA_MAX_ASSET_DOWNLOADS_PER_RUN,
      ARENA_RESPONSE_CACHE_LIMIT
    } = require_constants();
    var { ArenaClient } = require_arena_client();
    var { InputModal, ChannelSelectModal, CreateChannelModal } = require_modals();
    var {
      sanitizeFilename,
      sanitizeFolderName,
      isSyncSkipped,
      getArenaFrontmatter,
      frontmatterObjectToYaml,
      blockToContent,
      splitNoteContent,
      extractFrontmatterScalar,
      replaceBodyPreservingFrontmatter
    } = require_note_utils();
    function createChannelBrowserState() {
      return {
        nextPage: 1,
        totalChannels: null,
        exhausted: false
      };
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
            throw new Error(`Are.na devolvi\xF3 304 sin cach\xE9 local para ${path}`);
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
            `/users/${this.settings.username}/contents`
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
            `/channels/${channelSlug}/contents`
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
        const notice = new Notice(channels.length > 0 ? "Cargando m\xE1s canales\u2026" : "Cargando tus canales\u2026", 0);
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
            notice.setMessage(`Cargando canales\u2026 p\xE1g. ${page} \xB7 ${totalLabel} encontrados`);
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
            new Notice(`Se carg\xF3 un tramo parcial de canales. Pulsa "Cargar ${batchSize} m\xE1s" para seguir.`);
          }
          await this.persistData();
          return this.buildSelectableChannelsResult(channels);
        } finally {
          if (this.cacheDirty) await this.persistData();
          notice.hide();
        }
      }
      async buildBlockFileIndex() {
        const index = /* @__PURE__ */ new Map();
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
          assetLimitNoticeShown: false
        };
      }
      async confirmNextPageLoad(label, page, processed, total = Infinity) {
        if (page >= ARENA_MAX_PAGES_PER_RUN) {
          new Notice(
            `Importaci\xF3n detenida tras ${ARENA_MAX_PAGES_PER_RUN} p\xE1ginas. Para cargas m\xE1s grandes, conviene pedir permiso a Are.na.`
          );
          return false;
        }
        const totalLabel = Number.isFinite(total) ? `${processed}/${total}` : `${processed}`;
        return window.confirm(
          `Are.na recomienda cargar p\xE1ginas bajo demanda. Ya se proces\xF3 la p\xE1gina ${page} de ${label} (${totalLabel}). \xBFCargar la siguiente p\xE1gina?`
        );
      }
      canDownloadMoreAssets(transferState) {
        if (!transferState) return true;
        if (transferState.downloadedAssets < ARENA_MAX_ASSET_DOWNLOADS_PER_RUN) return true;
        if (!transferState.assetLimitNoticeShown) {
          transferState.assetLimitNoticeShown = true;
          new Notice(
            `Se alcanz\xF3 el l\xEDmite de ${ARENA_MAX_ASSET_DOWNLOADS_PER_RUN} adjuntos locales en esta ejecuci\xF3n. El resto quedar\xE1 enlazado en remoto para evitar descargas masivas.`
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
          "video/mp4": ".mp4"
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
        const extension = this.getFileExtensionFromContentType(response.headers.get("content-type")) || this.getFileExtensionFromUrl(url);
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
          callback: () => this.cmdGetBlocksFromChannel()
        });
        this.addCommand({
          id: "browse-my-channels",
          name: "Explorar mis canales",
          callback: () => this.cmdBrowseMyChannels()
        });
        this.addCommand({
          id: "create-channel",
          name: "Crear canal en Are.na",
          callback: () => this.cmdCreateChannel()
        });
        this.addCommand({
          id: "refresh-channels-cache",
          name: "Actualizar lista de canales (refresco)",
          callback: () => this.cmdRefreshChannelsCache()
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
          }
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
          }
        });
        this.addCommand({
          id: "get-block-by-id",
          name: "Obtener bloque por ID o URL",
          callback: () => this.cmdGetBlockById()
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
          }
        });
      }
      registerFolderMenu() {
        this.registerEvent(
          this.app.workspace.on("file-menu", (menu, file) => {
            if (!(file instanceof TFolder)) return;
            menu.addItem((item) => {
              item.setTitle("Subir carpeta como canal a Are.na").setIcon("upload").onClick(() => this.cmdUploadFolderAsChannel(file));
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
          new Notice("\u26A0\uFE0F Configura tu nombre de usuario en los ajustes.");
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
            }
          }).open();
        } catch (error) {
          console.error("getUserChannels error:", error);
          new Notice(`\u274C Error al cargar canales: ${error.message}`);
        }
      }
      async cmdCreateChannel() {
        if (!this.checkSettings()) return;
        new CreateChannelModal(this.app, async (title, visibility) => {
          try {
            const channel = await this.arena.createChannel(title, visibility);
            this.trackChannelMutation(channel);
            await this.persistData();
            new Notice(`\u2705 Canal "${channel.title}" creado en Are.na`);
          } catch (error) {
            new Notice(`\u274C Error al crear canal: ${error.message}`);
          }
        }).open();
      }
      async cmdRefreshChannelsCache() {
        if (!this.checkSettings()) return;
        this.invalidateUserChannelCaches();
        await this.persistData();
        new Notice("Cach\xE9 de canales borrado. El pr\xF3ximo 'Explorar mis canales' lo descargar\xE1 de nuevo.");
      }
      async cmdUploadFolderAsChannel(folder) {
        if (!this.checkSettings()) return;
        const files = folder.children.filter((file) => file instanceof TFile && file.extension === "md");
        if (files.length === 0) {
          new Notice("\u26A0\uFE0F La carpeta no contiene notas .md.");
          return;
        }
        new CreateChannelModal(this.app, async (title, visibility) => {
          const notice = new Notice(`Creando canal "${title}"\u2026`, 0);
          try {
            const channel = await this.arena.createChannel(title, visibility);
            this.trackChannelMutation(channel);
            const channelRef = channel.id || channel.slug;
            let uploaded = 0;
            let skipped = 0;
            for (const file of files) {
              notice.setMessage(`Subiendo notas\u2026 ${uploaded}/${files.length}`);
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
            const summary = skipped > 0 ? `\u2705 ${uploaded} notas subidas al canal "${channel.title}" \xB7 ${skipped} omitidas por ${SYNC_SKIP_FLAG}` : `\u2705 ${uploaded} notas subidas al canal "${channel.title}"`;
            new Notice(summary);
            await this.persistData();
          } catch (error) {
            notice.hide();
            new Notice(`\u274C Error: ${error.message}`);
          }
        }, folder.name).open();
      }
      async cmdPullBlock() {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const { content, frontmatter } = await this.readNoteState(file);
        if (isSyncSkipped(frontmatter)) {
          new Notice(`\u26A0\uFE0F Esta nota est\xE1 marcada con ${SYNC_SKIP_FLAG}: true.`);
          return;
        }
        const blockId = frontmatter.blockid;
        if (!blockId) {
          new Notice("\u26A0\uFE0F Esta nota no tiene blockid en el frontmatter.");
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
          new Notice(`\u2705 Nota actualizada desde bloque ${blockId}`);
        } catch (error) {
          new Notice(`\u274C Error: ${error.message}`);
        }
      }
      async cmdPushNote() {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const { body, frontmatter } = await this.readNoteState(file);
        if (isSyncSkipped(frontmatter)) {
          new Notice(`\u26A0\uFE0F Esta nota est\xE1 marcada con ${SYNC_SKIP_FLAG}: true.`);
          return;
        }
        const blockId = frontmatter.blockid;
        const title = frontmatter.title || file.basename;
        if (blockId) {
          try {
            const block = await this.arena.updateBlock(blockId, body, title);
            this.trackBlockMutation(block, frontmatter.channel || "");
            await this.persistData();
            new Notice(`\u2705 Bloque ${blockId} actualizado en Are.na`);
          } catch (error) {
            new Notice(`\u274C Error al actualizar: ${error.message}`);
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
            }
          }).open();
        } catch (error) {
          console.error("push-note channels error:", error);
          new Notice(`\u26A0\uFE0F No se pudo cargar la lista de canales: ${error.message}`);
          openManualInput();
        }
      }
      async publishNoteToArena(file, frontmatter, body, title, channelRef, channelSlug) {
        try {
          const block = await this.arena.pushBlock(channelRef, body, title);
          this.trackBlockMutation(block, channelSlug);
          await this.mergeArenaFrontmatter(file, block, channelSlug, frontmatter);
          await this.persistData();
          new Notice(`\u2705 Publicado en /${channelSlug} como bloque ${block.id}`);
        } catch (error) {
          new Notice(`\u274C Error al publicar: ${error.message}`);
        }
      }
      async cmdGetBlockById() {
        if (!this.checkSettings()) return;
        new InputModal(this.app, "Obtener bloque por ID o URL", "ID num\xE9rico o URL de Are.na", async (input) => {
          const id = this.extractBlockId(input);
          if (!id) {
            new Notice("\u26A0\uFE0F No se pudo extraer el ID.");
            return;
          }
          try {
            const block = await this.arena.getBlock(id);
            await this.saveBlock(block, "", null, null, this.createTransferState());
            new Notice(`\u2705 Bloque ${id} importado`);
          } catch (error) {
            new Notice(`\u274C Error: ${error.message}`);
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
          new Notice("\u26A0\uFE0F Esta nota no tiene blockid.");
          return;
        }
        const url = channel ? `https://www.are.na/${this.settings.username}/${channel}/blocks/${blockId}` : `https://www.are.na/block/${blockId}`;
        window.open(url, "_blank");
      }
      async fetchAndSaveChannel(slug) {
        new Notice(`Descargando canal "${slug}"\u2026`);
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
          const summary = skipped > 0 ? `\u2705 "${channelTitle}": ${saved} bloques importados \xB7 ${skipped} omitidos por ${SYNC_SKIP_FLAG}` : `\u2705 "${channelTitle}": ${saved} bloques importados`;
          new Notice(summary);
        } catch (error) {
          new Notice(`\u274C Error: ${error.message}`);
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
          const body2 = await this.buildImportedBlockContent(block, targetFolder, existing.path, transferState);
          await this.app.vault.modify(existing, replaceBodyPreservingFrontmatter(raw, body2));
          await this.mergeArenaFrontmatter(existing, block, channelSlug, frontmatter);
          index.set(blockKey, existing);
          return true;
        }
        const frontmatterYaml = frontmatterObjectToYaml(getArenaFrontmatter(block, channelSlug));
        const filename = this.app.vault.getAbstractFileByPath(preferredPath) ? this.getUniqueNotePath(targetFolder, noteTitle) : preferredPath;
        const body = await this.buildImportedBlockContent(block, targetFolder, filename, transferState);
        const noteContent = `${frontmatterYaml}

${body}`;
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
          new Notice("\u26A0\uFE0F Configura tu Personal Access Token en los ajustes del plugin.");
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
        containerEl.createEl("h2", { text: "Are.na Bridge" });
        new Setting(containerEl).setName("Personal Access Token").setDesc("Obt\xE9n tu token en are.na/settings/oauth. Para Push y crear canales, usa scope write.").addText(
          (text) => text.setPlaceholder("Tu token de Are.na").setValue(this.plugin.settings.token).onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName("Usuario (slug)").setDesc("Tu slug de Are.na, ej. 'marco-noris'").addText(
          (text) => text.setPlaceholder("tu-usuario").setValue(this.plugin.settings.username).onChange(async (value) => {
            this.plugin.settings.username = value.trim();
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName("Carpeta").setDesc("Carpeta del vault donde se guardar\xE1n los bloques").addText(
          (text) => text.setPlaceholder(DEFAULT_FOLDER).setValue(this.plugin.settings.folder).onChange(async (value) => {
            this.plugin.settings.folder = value.trim() || DEFAULT_FOLDER;
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName("Descargar adjuntos").setDesc("Descarga autom\xE1ticamente archivos adjuntos").addToggle(
          (toggle) => toggle.setValue(this.plugin.settings.downloadAttachments).onChange(async (value) => {
            this.plugin.settings.downloadAttachments = value;
            await this.plugin.saveSettings();
          })
        );
        new Setting(containerEl).setName("Carpeta de adjuntos").setDesc("Nombre de la carpeta local donde se guardan im\xE1genes y adjuntos descargados").addText(
          (text) => text.setPlaceholder("_assets").setValue(this.plugin.settings.attachmentsFolderName || "_assets").onChange(async (value) => {
            this.plugin.settings.attachmentsFolderName = sanitizeFolderName(value.trim()) || "_assets";
            await this.plugin.saveSettings();
          })
        );
        containerEl.createEl("h3", { text: "Diagn\xF3stico de cach\xE9" });
        const diagnostics = this.plugin.getCacheDiagnostics();
        const summary = [
          `${diagnostics.total} respuestas API`,
          `${diagnostics.users} de usuario`,
          `${diagnostics.channels} de canales`,
          `${diagnostics.blocks} de bloques`,
          `${diagnostics.other} de otros endpoints`,
          `${diagnostics.localChannels} canales en lista local`
        ].join(" \xB7 ");
        new Setting(containerEl).setName("Estado de la cach\xE9").setDesc(summary).addButton(
          (button) => button.setButtonText("Vaciar canales").onClick(async () => {
            await this.plugin.clearChannelCaches();
            new Notice("Cach\xE9 de usuario/canales vaciada.");
            this.display();
          })
        ).addButton(
          (button) => button.setButtonText("Vaciar bloques").onClick(async () => {
            await this.plugin.clearBlockCaches();
            new Notice("Cach\xE9 de bloques vaciada.");
            this.display();
          })
        ).addButton(
          (button) => button.setWarning().setButtonText("Vaciar todo").onClick(async () => {
            await this.plugin.clearAllCaches();
            new Notice("Toda la cach\xE9 del plugin ha sido vaciada.");
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
