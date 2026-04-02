"use strict";

const { Modal } = require("obsidian");

class InputModal extends Modal {
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
}

class ChannelSelectModal extends Modal {
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
    const searchInput = contentEl.createEl("input", { type: "text", placeholder: "Filtrar canales…" });
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
      return this.channels.filter((channel) =>
        (channel.title || "").toLowerCase().includes(normalizedFilter) ||
        (channel.slug || "").toLowerCase().includes(normalizedFilter)
      );
    };

    if (this.onRefresh) {
      const refreshButton = actionsEl.createEl("button", { text: this.refreshButtonText });
      refreshButton.onclick = async () => {
        refreshButton.disabled = true;
        setMessage("Actualizando canales…");
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
    loadMoreButton.setText(`Cargar ${this.pageSize} más`);

    const renderList = (filter = "") => {
      list.empty();
      const filtered = getFilteredChannels(filter);
      const visible = filtered.slice(0, visibleCount);
      const loadedLabel = Number.isFinite(this.totalChannels)
        ? `${this.channels.length}/${this.totalChannels} cargados`
        : `${this.channels.length} cargados`;
      setSummary(`Mostrando ${visible.length}/${filtered.length} · ${loadedLabel}`);

      if (visible.length === 0) {
        const emptyText = this.hasMore
          ? `${this.emptyMessage} Carga más canales para seguir buscando.`
          : this.emptyMessage;
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
        const meta = item.createEl("span", { text: ` · ${count} bloques · ${visibility}` });
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
        loadMoreButton.setText(`Mostrar ${Math.min(this.pageSize, filtered.length - visibleCount)} más`);
        return;
      }
      loadMoreButton.setText(`Cargar ${this.pageSize} más`);
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
      setMessage("Cargando más canales…");
      try {
        applyChannelState(await this.onLoadMore());
        visibleCount += this.pageSize;
        setMessage("");
        renderList(filter);
      } catch (error) {
        setMessage(`No se pudo cargar más: ${error.message}`);
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
      ["public", "Público — cualquiera puede ver y añadir"],
      ["closed", "Cerrado — cualquiera puede ver, solo tú añades"],
      ["private", "Privado — solo tú puedes ver y añadir"],
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
}

module.exports = {
  InputModal,
  ChannelSelectModal,
  CreateChannelModal,
};
