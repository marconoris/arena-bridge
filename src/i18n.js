"use strict";

const SUPPORTED_LANGUAGES = ["en", "es"];
const LANGUAGE_PREFERENCE_AUTO = "auto";

const TRANSLATIONS = {
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
      loadingChannels: "Loading channels…",
      loadingMoreChannels: "Loading more channels…",
      noContentType: "no content-type",
      noExtension: "no extension",
      blocks: "blocks",
      unnamedChannel: "Untitled channel",
    },
    modals: {
      confirm: {
        title: "Confirm action",
      },
      channelSelect: {
        title: "Select an Are.na channel",
        emptyMessage: "No results.",
        manualButton: "Use manual slug",
        refreshButton: "Refresh",
        filterPlaceholder: "Filter channels…",
        updating: "Refreshing channels…",
        updated: "List updated.",
        refreshFailed: "Could not refresh: {{error}}",
        loadMoreRemote: "Load {{count}} more",
        loadMoreVisible: "Show {{count}} more",
        loadingMore: "Loading more channels…",
        loadMoreFailed: "Could not load more: {{error}}",
        loadedSummary: "Showing {{visible}}/{{filtered}} · {{loaded}}",
        loadedCount: "{{count}} loaded",
        loadedCountWithTotal: "{{count}}/{{total}} loaded",
        emptyWithMore: "{{message}} Load more channels to keep searching.",
      },
      createChannel: {
        title: "Create Are.na channel",
        nameLabel: "Channel name",
        namePlaceholder: "My channel",
        visibilityLabel: "Visibility",
        visibilityPublic: "Public - anyone can view and add",
        visibilityClosed: "Closed - anyone can view, only you can add",
        visibilityPrivate: "Private - only you can view and add",
        submit: "Create channel",
      },
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
      uploadFolderAsChannel: "Upload folder as Are.na channel",
    },
    prompts: {
      getBlocksFromChannelTitle: "Get blocks from a channel",
      getBlocksFromChannelPlaceholder: "channel slug or URL",
      pushToArenaTitle: "Send to Are.na",
      pushToArenaPlaceholder: "destination channel slug",
      getBlockByIdTitle: "Get block by ID or URL",
      getBlockByIdPlaceholder: "numeric ID or Are.na URL",
      selectDestinationChannel: "Select the destination channel",
      manualSlugInput: "Enter slug manually",
    },
    notices: {
      pluginLoaded: "Are.na Bridge v1.0.1-beta.3 loaded.",
      pluginUnloaded: "Are.na Bridge unloaded.",
      loadingYourChannels: "Loading your channels…",
      loadingChannelsPage: "Loading channels… page {{page}} · {{total}} found",
      partialChannelsLoaded: "A partial channel batch was loaded. Click \"Load {{count}} more\" to continue.",
      missingLocalCache: "Are.na returned 304 without local cache for {{path}}",
      blockedAssets: "{{count}} attachment{{suffix}} skipped because the type is not allowed. They were kept as remote links.{{sample}}",
      blockedAssetsSample: " Types: {{types}}.",
      importStopped: "Import stopped after {{count}} pages. For larger transfers, it is better to request permission from Are.na.",
      confirmNextPage: "Are.na recommends loading pages on demand. Page {{page}} of {{label}} has already been processed ({{total}}). Load the next page?",
      assetLimitReached: "The limit of {{count}} local attachments was reached in this run. The rest will stay linked remotely to avoid bulk downloads.",
      attachmentBlocked: "Attachment blocked by unsupported type ({{contentType}} · {{url}})",
      attachmentBlockedByPolicy: "Attachment blocked by type policy ({{contentType}} · {{url}})",
      attachmentDownloadFailed: "Could not download attachment ({{status}})",
      usernameMissing: "Configure your username in the settings.",
      noChannelsFound: "No channels found.",
      errorLoadingChannels: "Error loading channels: {{error}}",
      channelCreated: "Channel \"{{title}}\" created on Are.na",
      errorCreatingChannel: "Error creating channel: {{error}}",
      channelsCacheCleared: "Channels cache cleared. The next \"Browse my channels\" will fetch it again.",
      folderHasNoNotes: "This folder does not contain any `.md` notes.",
      folderMissingLinkedChannel: "This folder is not linked to a single Are.na channel yet.",
      folderAlreadyLinkedChannel: "This folder is already linked to /{{channel}}. Reusing that channel instead of creating a new one.",
      folderLinkedChannelDeleted: "The linked channel /{{channel}} no longer exists on Are.na. A new channel will be created.",
      creatingChannel: "Creating channel \"{{title}}\"…",
      uploadingNotesProgress: "Uploading notes… {{uploaded}}/{{total}}",
      folderUploadSummary: "{{uploaded}} notes uploaded to channel \"{{title}}\"",
      folderUploadSummarySkipped: "{{uploaded}} notes uploaded to channel \"{{title}}\" · {{skipped}} skipped because of {{flag}}",
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
      downloadingChannel: "Downloading channel \"{{slug}}\"…",
      channelImportSummary: "\"{{title}}\": {{saved}} blocks imported",
      channelImportSummarySkipped: "\"{{title}}\": {{saved}} blocks imported · {{skipped}} skipped because of {{flag}}",
      channelImportProtectedLocalOnlyMarkdown: "{{count}} note(s) were not overwritten to protect local-only Markdown excluded from publishing.",
      blockImportSkippedToProtectLocalOnlyMarkdown: "The note was not overwritten to protect local-only Markdown excluded from publishing.",
      configureToken: "Configure your Personal Access Token in the plugin settings.",
      languageChanged: "Language updated. Reload the plugin or restart Obsidian to refresh command names.",
      channelCacheCleared: "User/channel cache cleared.",
      blockCacheCleared: "Blocks cache cleared.",
      allCacheCleared: "All plugin cache has been cleared.",
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
      cacheStatusSummary: "{{total}} API responses · {{users}} user · {{channels}} channels · {{blocks}} blocks · {{other}} other endpoints · {{localChannels}} channels in local list",
      clearChannelsButton: "Clear channels",
      clearBlocksButton: "Clear blocks",
      clearAllButton: "Clear all",
    },
    manifest: {
      description: "Connect your Obsidian vault with Are.na. Import blocks and channels, publish notes, and sync content.",
    },
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
      loadingChannels: "Cargando canales…",
      loadingMoreChannels: "Cargando más canales…",
      noContentType: "sin content-type",
      noExtension: "sin extensión",
      blocks: "bloques",
      unnamedChannel: "Canal sin nombre",
    },
    modals: {
      confirm: {
        title: "Confirmar acción",
      },
      channelSelect: {
        title: "Selecciona un canal de Are.na",
        emptyMessage: "Sin resultados.",
        manualButton: "Usar slug manual",
        refreshButton: "Refrescar",
        filterPlaceholder: "Filtrar canales…",
        updating: "Actualizando canales…",
        updated: "Lista actualizada.",
        refreshFailed: "No se pudo refrescar: {{error}}",
        loadMoreRemote: "Cargar {{count}} más",
        loadMoreVisible: "Mostrar {{count}} más",
        loadingMore: "Cargando más canales…",
        loadMoreFailed: "No se pudo cargar más: {{error}}",
        loadedSummary: "Mostrando {{visible}}/{{filtered}} · {{loaded}}",
        loadedCount: "{{count}} cargados",
        loadedCountWithTotal: "{{count}}/{{total}} cargados",
        emptyWithMore: "{{message}} Carga más canales para seguir buscando.",
      },
      createChannel: {
        title: "Crear canal en Are.na",
        nameLabel: "Nombre del canal",
        namePlaceholder: "Mi canal",
        visibilityLabel: "Visibilidad",
        visibilityPublic: "Público - cualquiera puede ver y añadir",
        visibilityClosed: "Cerrado - cualquiera puede ver, solo tú añades",
        visibilityPrivate: "Privado - solo tú puedes ver y añadir",
        submit: "Crear canal",
      },
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
      uploadFolderAsChannel: "Subir carpeta como canal a Are.na",
    },
    prompts: {
      getBlocksFromChannelTitle: "Obtener bloques de canal",
      getBlocksFromChannelPlaceholder: "slug o URL del canal",
      pushToArenaTitle: "Enviar a Are.na",
      pushToArenaPlaceholder: "slug del canal destino",
      getBlockByIdTitle: "Obtener bloque por ID o URL",
      getBlockByIdPlaceholder: "ID numérico o URL de Are.na",
      selectDestinationChannel: "Selecciona el canal destino",
      manualSlugInput: "Introducir slug manual",
    },
    notices: {
      pluginLoaded: "Are.na Bridge v1.0.1-beta.3 cargado.",
      pluginUnloaded: "Are.na Bridge descargado.",
      loadingYourChannels: "Cargando tus canales…",
      loadingChannelsPage: "Cargando canales… pág. {{page}} · {{total}} encontrados",
      partialChannelsLoaded: "Se cargó un tramo parcial de canales. Pulsa \"Cargar {{count}} más\" para seguir.",
      missingLocalCache: "Are.na devolvió 304 sin caché local para {{path}}",
      blockedAssets: "Se omitieron {{count}} adjunto{{suffix}} por tipo no permitido. Se mantuvieron como enlaces remotos.{{sample}}",
      blockedAssetsSample: " Tipos: {{types}}.",
      importStopped: "Importación detenida tras {{count}} páginas. Para cargas más grandes, conviene pedir permiso a Are.na.",
      confirmNextPage: "Are.na recomienda cargar páginas bajo demanda. Ya se procesó la página {{page}} de {{label}} ({{total}}). ¿Cargar la siguiente página?",
      assetLimitReached: "Se alcanzó el límite de {{count}} adjuntos locales en esta ejecución. El resto quedará enlazado en remoto para evitar descargas masivas.",
      attachmentBlocked: "Adjunto bloqueado por tipo no permitido ({{contentType}} · {{url}})",
      attachmentBlockedByPolicy: "Adjunto bloqueado por política de tipos ({{contentType}} · {{url}})",
      attachmentDownloadFailed: "No se pudo descargar adjunto ({{status}})",
      usernameMissing: "Configura tu nombre de usuario en los ajustes.",
      noChannelsFound: "No se encontraron canales.",
      errorLoadingChannels: "Error al cargar canales: {{error}}",
      channelCreated: "Canal \"{{title}}\" creado en Are.na",
      errorCreatingChannel: "Error al crear canal: {{error}}",
      channelsCacheCleared: "Caché de canales borrado. El próximo \"Explorar mis canales\" lo descargará de nuevo.",
      folderHasNoNotes: "La carpeta no contiene notas `.md`.",
      folderMissingLinkedChannel: "Esta carpeta todavía no está vinculada a un único canal de Are.na.",
      folderAlreadyLinkedChannel: "Esta carpeta ya está vinculada a /{{channel}}. Se reutilizará ese canal en vez de crear otro.",
      folderLinkedChannelDeleted: "El canal vinculado /{{channel}} ya no existe en Are.na. Se creará uno nuevo.",
      creatingChannel: "Creando canal \"{{title}}\"…",
      uploadingNotesProgress: "Subiendo notas… {{uploaded}}/{{total}}",
      folderUploadSummary: "{{uploaded}} notas subidas al canal \"{{title}}\"",
      folderUploadSummarySkipped: "{{uploaded}} notas subidas al canal \"{{title}}\" · {{skipped}} omitidas por {{flag}}",
      genericError: "Error: {{error}}",
      noteMarkedSkipped: "Esta nota está marcada con {{flag}}: true.",
      noteMissingBlockIdFrontmatter: "Esta nota no tiene `blockid` en el frontmatter.",
      pullSkippedToProtectLocalOnlyMarkdown: "Pull omitido para proteger Markdown local que está excluido de la publicación.",
      noteUpdatedFromBlock: "Nota actualizada desde bloque {{id}}",
      blockUpdated: "Bloque {{id}} actualizado en Are.na",
      warningLoadingChannelList: "No se pudo cargar la lista de canales: {{error}}",
      notePublished: "Publicado en /{{channel}} como bloque {{id}}",
      couldNotExtractBlockId: "No se pudo extraer el ID.",
      blockImported: "Bloque {{id}} importado",
      noteMissingBlockId: "Esta nota no tiene `blockid`.",
      downloadingChannel: "Descargando canal \"{{slug}}\"…",
      channelImportSummary: "\"{{title}}\": {{saved}} bloques importados",
      channelImportSummarySkipped: "\"{{title}}\": {{saved}} bloques importados · {{skipped}} omitidos por {{flag}}",
      channelImportProtectedLocalOnlyMarkdown: "No se sobrescribieron {{count}} nota(s) para proteger Markdown local excluido de la publicación.",
      blockImportSkippedToProtectLocalOnlyMarkdown: "La nota no se sobrescribió para proteger Markdown local excluido de la publicación.",
      configureToken: "Configura tu Personal Access Token en los ajustes del plugin.",
      languageChanged: "Idioma actualizado. Recarga el plugin o reinicia Obsidian para refrescar los nombres de comandos.",
      channelCacheCleared: "Caché de usuario/canales vaciada.",
      blockCacheCleared: "Caché de bloques vaciada.",
      allCacheCleared: "Toda la caché del plugin ha sido vaciada.",
    },
    settings: {
      title: "Are.na Bridge",
      tokenName: "Personal Access Token",
      tokenDesc: "Obtén tu token en are.na/settings/oauth. Para Push y crear canales, usa scope `write`. Una vez guardado, el token queda oculto.",
      tokenPlaceholder: "Tu token de Are.na",
      usernameName: "Usuario (slug)",
      usernameDesc: "Tu slug de Are.na, ej. `marco-noris`.",
      usernamePlaceholder: "tu-usuario",
      languageName: "Idioma",
      languageDesc: "Idioma por defecto de la interfaz del plugin. Los nombres de comandos cambian al recargar el plugin.",
      languageAuto: "Automático (sistema)",
      languageEnglish: "Inglés",
      languageSpanish: "Español",
      folderName: "Carpeta",
      folderDesc: "Carpeta del vault donde se guardarán los bloques importados",
      downloadAttachmentsName: "Descargar adjuntos",
      downloadAttachmentsDesc: "Descarga automáticamente adjuntos permitidos (imágenes, PDF, EPUB, audio, vídeo y texto plano)",
      attachmentsFolderName: "Carpeta de adjuntos",
      attachmentsFolderDesc: "Nombre de la carpeta local donde se guardan imágenes y adjuntos descargados",
      publishCodeBlockFilterName: "Omitir lenguajes de bloque de código al publicar",
      publishCodeBlockFilterDesc: "Lista separada por comas con los lenguajes de fenced code blocks que se eliminarán antes de enviar el Markdown a Are.na. Ejemplo: `dataview, mermaid`",
      publishStripCalloutsName: "Omitir callouts al publicar",
      publishStripCalloutsDesc: "Elimina bloques callout de Obsidian como `> [!note]` antes de enviar el Markdown a Are.na.",
      cacheDiagnosticsTitle: "Diagnóstico de caché",
      cacheStatusName: "Estado de la caché",
      cacheStatusSummary: "{{total}} respuestas API · {{users}} de usuario · {{channels}} de canales · {{blocks}} de bloques · {{other}} de otros endpoints · {{localChannels}} canales en lista local",
      clearChannelsButton: "Vaciar canales",
      clearBlocksButton: "Vaciar bloques",
      clearAllButton: "Vaciar todo",
    },
    manifest: {
      description: "Conecta tu bóveda de Obsidian con Are.na. Importa bloques y canales, publica notas y sincroniza contenido.",
    },
  },
};

function interpolate(template, variables = {}) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}

function getTranslation(language, key) {
  return key.split(".").reduce((current, part) => {
    if (!current || typeof current !== "object") return undefined;
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
    },
  };
}

module.exports = {
  SUPPORTED_LANGUAGES,
  LANGUAGE_PREFERENCE_AUTO,
  createTranslator,
};
