"use strict";

const { requestUrl } = require("obsidian");
const { ARENA_API, ARENA_PAGE_SIZE, ARENA_REQUEST_DELAY_MS } = require("./constants");

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

class ArenaClient {
  constructor(token, options = {}) {
    this.token = token;
    this.base = ARENA_API;
    this.minRequestGapMs = options.minRequestGapMs ?? ARENA_REQUEST_DELAY_MS;
    this.lastRequestAt = 0;
  }

  headers() {
    return {
      Authorization: `Bearer ${this.token}`,
    };
  }

  async paceRequest() {
    const waitMs = (this.lastRequestAt + this.minRequestGapMs) - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    this.lastRequestAt = Date.now();
  }

  getRetryDelayMs(headers, attempt) {
    const retryAfter = parseInt(getHeaderValue(headers, "Retry-After") || "", 10);
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;

    const reset = parseInt(getHeaderValue(headers, "X-RateLimit-Reset") || "", 10);
    if (Number.isFinite(reset) && reset > 0) {
      return Math.max((reset * 1000) - Date.now(), 1000);
    }

    return Math.min(5000 * (attempt + 1), 15000);
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
        throw: false,
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
          etag: getHeaderValue(response.headers, "ETag") || null,
        };
      }

      if (response.status < 200 || response.status >= 300) {
        const payload = parseJsonSafely(response.text || "");
        const detail = payload?.details?.message || payload?.error || "";
        const error = new Error(
          detail
            ? `${detail} (${response.status})`
            : `Request failed, status ${response.status} — ${url.toString()}`
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
        etag: getHeaderValue(response.headers, "ETag") || null,
      };
    }

    throw new Error(`Request failed after retries, status ${lastStatus} — ${url.toString()}`);
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
      body: JSON.stringify(body),
    });
    return result.data;
  }

  async put(path, body = {}) {
    const result = await this.requestJson(`${this.base}${path}`, {
      method: "PUT",
      headers: this.headers(),
      contentType: "application/json",
      body: JSON.stringify(body),
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
}

module.exports = { ArenaClient };
