"use strict";

const { Modal } = require("obsidian");

const MODAL_FALLBACKS = {
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
  "modals.channelSelect.filterPlaceholder": "Filter channels…",
  "modals.channelSelect.updating": "Refreshing channels…",
  "modals.channelSelect.updated": "List updated.",
  "modals.channelSelect.refreshFailed": "Could not refresh: {{error}}",
  "modals.channelSelect.loadMoreRemote": "Load {{count}} more",
  "modals.channelSelect.loadMoreVisible": "Show {{count}} more",
  "modals.channelSelect.loadingMore": "Loading more channels…",
  "modals.channelSelect.loadMoreFailed": "Could not load more: {{error}}",
  "modals.channelSelect.loadedSummary": "Showing {{visible}}/{{filtered}} · {{loaded}}",
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
  "modals.createChannel.submit": "Create channel",
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

class InputModal extends Modal {
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
      cls: "arena-bridge-modal__input",
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
}

class ConfirmModal extends Modal {
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
      cls: "arena-bridge-modal__message",
    });

    const actionsEl = contentEl.createDiv({ cls: "arena-bridge-modal__actions" });
    const cancelButton = actionsEl.createEl("button", { text: this.cancelText });
    const confirmButton = actionsEl.createEl("button", {
      text: this.confirmText,
      cls: "mod-cta",
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
}

class ChannelSelectModal extends Modal {
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
      cls: "arena-bridge-modal__input",
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
      return this.channels.filter((channel) =>
        (channel.title || "").toLowerCase().includes(normalizedFilter) ||
        (channel.slug || "").toLowerCase().includes(normalizedFilter)
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
      const loadedLabel = Number.isFinite(this.totalChannels)
        ? this.t("modals.channelSelect.loadedCountWithTotal", { count: this.channels.length, total: this.totalChannels })
        : this.t("modals.channelSelect.loadedCount", { count: this.channels.length });
      setSummary(this.t("modals.channelSelect.loadedSummary", {
        visible: visible.length,
        filtered: filtered.length,
        loaded: loadedLabel,
      }));

      if (visible.length === 0) {
        const emptyText = this.hasMore
          ? this.t("modals.channelSelect.emptyWithMore", { message: this.emptyMessage })
          : this.emptyMessage;
        list.createEl("p", { text: emptyText });
      }

      for (const channel of visible) {
        const item = list.createDiv({ cls: "arena-bridge-channel-select__item" });
        item.createEl("strong", { text: channel.title || channel.slug || this.t("common.unnamedChannel") });
        const count = channel.counts?.contents ?? channel.length ?? 0;
        const visibility = channel.visibility || "";
        const meta = item.createEl("span", {
          cls: "arena-bridge-channel-select__meta",
          text: visibility
            ? ` · ${count} ${this.t("common.blocks")} · ${visibility}`
            : ` · ${count} ${this.t("common.blocks")}`,
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
          count: Math.min(this.pageSize, filtered.length - visibleCount),
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
}

class CreateChannelModal extends Modal {
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
      cls: "arena-bridge-modal__input",
    });
    if (this.defaultTitle) titleInput.value = this.defaultTitle;

    contentEl.createEl("label", { text: this.t("modals.createChannel.visibilityLabel") });
    const select = contentEl.createEl("select", { cls: "arena-bridge-modal__input" });
    [
      ["public", this.t("modals.createChannel.visibilityPublic")],
      ["closed", this.t("modals.createChannel.visibilityClosed")],
      ["private", this.t("modals.createChannel.visibilityPrivate")],
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
}

module.exports = {
  InputModal,
  ConfirmModal,
  ChannelSelectModal,
  CreateChannelModal,
};
