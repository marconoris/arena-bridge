"use strict";

const { SYNC_SKIP_FLAG } = require("./constants");

function sanitizeFilename(name) {
  return (name || "Untitled")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function sanitizeFolderName(name) {
  return (name || "Untitled")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
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
    updated_at: formatDate(block.updated_at),
  };
  if (block.source?.title) frontmatter.source_title = block.source.title;
  if (block.source?.url) frontmatter.source_url = block.source.url;
  if (isSyncSkipped(existingFrontmatter)) frontmatter[SYNC_SKIP_FLAG] = true;
  return frontmatter;
}

function stringifyFrontmatterValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value == null) return "\"\"";
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
    return value
      .map((item) => extractText(item, { preferMarkdown }))
      .filter(Boolean)
      .join("\n\n");
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
    hasFrontmatter: true,
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
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function replaceBodyPreservingFrontmatter(noteContent, body) {
  const { frontmatterRaw, hasFrontmatter } = splitNoteContent(noteContent);
  const trimmedBody = (body || "").trim();
  if (!hasFrontmatter) return trimmedBody;
  return trimmedBody
    ? `---\n${frontmatterRaw}\n---\n\n${trimmedBody}`
    : `---\n${frontmatterRaw}\n---\n`;
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
    (Array.isArray(excludedLanguages) ? excludedLanguages : [])
      .map((language) => normalizeCodeFenceLanguage(language))
      .filter(Boolean)
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
        excluded: excludedFence,
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

module.exports = {
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
};
