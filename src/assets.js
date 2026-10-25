"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ADMIN_USER_ID } = require("./settings");

/**
 * Presence artwork ("photos").
 *
 * Discord cannot host arbitrary images for a bot presence, and external URLs
 * must be publicly reachable over HTTPS. So uploads are stored on this server
 * and served from `<publicUrl>/assets/<id>.<ext>`, which both Discord's media
 * proxy and Discord's own servers can fetch.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB after decoding
const ALLOWED = {
  "image/png": { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  "image/webp": { ext: "webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  "image/gif": { ext: "gif", magic: [[0x47, 0x49, 0x46, 0x38]] }
};

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

function hasMagic(buffer, signatures) {
  return signatures.some((sig) => sig.every((byte, index) => buffer[index] === byte));
}

/** Read the pixel dimensions from the file header (PNG, JPEG, GIF, WebP). */
function readDimensions(buffer, mime) {
  try {
    if (mime === "image/png" && buffer.length > 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === "image/gif" && buffer.length > 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mime === "image/webp" && buffer.length > 30) {
      const format = buffer.toString("ascii", 12, 16);
      if (format === "VP8X") {
        return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3)
        };
      }
      if (format === "VP8 ") {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff
        };
      }
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    /* fall through */
  }
  return { width: null, height: null };
}

/**
 * Validate an uploaded data URL.
 * @returns {{ok: true, mime: string, ext: string, buffer: Buffer, width: number|null, height: number|null}
 *          | {ok: false, error: string}}
 */
function parseUpload(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    return { ok: false, error: "No image data received." };
  }
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) {
    return { ok: false, error: "Upload a PNG, JPEG, WebP or GIF image." };
  }

  const mime = match[1];
  const meta = ALLOWED[mime];
  if (!meta) return { ok: false, error: "Unsupported image type." };

  let buffer;
  try {
    buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  } catch {
    return { ok: false, error: "The image data could not be decoded." };
  }

  if (buffer.length === 0) return { ok: false, error: "The image was empty." };
  if (buffer.length > MAX_BYTES) {
    return { ok: false, error: `Images must be smaller than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` };
  }
  if (!hasMagic(buffer, meta.magic)) {
    return { ok: false, error: "The file content does not match its image type." };
  }
  if (mime === "image/webp" && buffer.toString("ascii", 8, 12) !== "WEBP") {
    return { ok: false, error: "The WebP file is malformed." };
  }

  const { width, height } = readDimensions(buffer, mime);
  if (width !== null && (width < 16 || height < 16)) {
    return { ok: false, error: "Images must be at least 16×16 pixels." };
  }
  if (width !== null && (width > 4096 || height > 4096)) {
    return { ok: false, error: "Images must be at most 4096×4096 pixels." };
  }

  return { ok: true, mime, ext: meta.ext, buffer, width, height };
}

class AssetStore {
  /**
   * @param {string} dir directory that holds the image files
   * @param {import('./settings').SettingsStore} settings
   */
  constructor(dir, settings) {
    this.dir = dir;
    this.settings = settings;
  }

  filePath(asset) {
    return path.join(this.dir, `${asset.id}.${asset.ext}`);
  }

  /**
   * Store an uploaded image for one account.
   *
   * Files are content-hashed and shared on disk, but ownership is per account:
   * two members uploading the same picture get one file and two entries, and one
   * of them deleting it leaves the other's card working.
   *
   * @param {{dataUrl: string, name?: string, owner?: string}} input
   */
  save({ dataUrl, name, owner = ADMIN_USER_ID }) {
    const parsed = parseUpload(dataUrl);
    if (!parsed.ok) return parsed;

    const id = crypto.createHash("sha256").update(parsed.buffer).digest("hex").slice(0, 20);
    const existing = this.settings.listAssets(owner).find((asset) => asset.id === id);
    if (existing) return { ok: true, asset: existing, duplicate: true };

    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${id}.${parsed.ext}`);
    // Another account may already have stored these exact bytes.
    if (!fs.existsSync(file)) {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, parsed.buffer, { mode: 0o644 });
      fs.renameSync(tmp, file);
    }

    const asset = this.settings.addAsset(
      {
        id,
        ext: parsed.ext,
        mime: parsed.mime,
        bytes: parsed.buffer.length,
        width: parsed.width,
        height: parsed.height,
        name: String(name || "image").replace(/[^\w.\- ]+/g, "").slice(0, 60) || "image",
        createdAt: new Date().toISOString()
      },
      owner
    );

    return { ok: true, asset };
  }

  /** Drop one account's entry, and the file only when nobody else holds it. */
  remove(id, owner = ADMIN_USER_ID) {
    const result = this.settings.removeAsset(id, owner);
    if (!result.removed) return false;
    if (!result.fileUnused) return true;
    try {
      for (const entry of fs.readdirSync(this.dir)) {
        if (entry.startsWith(`${id}.`)) fs.rmSync(path.join(this.dir, entry), { force: true });
      }
    } catch {
      /* nothing to clean up */
    }
    return true;
  }

  /** Absolute, publicly reachable URL for an asset (requires a public URL). */
  url(asset, publicUrl) {
    if (!asset) return "";
    const base = String(publicUrl || "").replace(/\/+$/, "");
    return `${base}/assets/${asset.id}.${asset.ext}`;
  }

  /** Remove files that no longer have metadata (e.g. after a manual edit). */
  prune() {
    try {
      if (!fs.existsSync(this.dir)) return 0;
      let removed = 0;
      for (const file of fs.readdirSync(this.dir)) {
        const id = file.split(".")[0];
        if (!this.settings.findAsset(id)) {
          fs.rmSync(path.join(this.dir, file), { force: true });
          removed += 1;
        }
      }
      return removed;
    } catch {
      return 0;
    }
  }
}

module.exports = { AssetStore };
