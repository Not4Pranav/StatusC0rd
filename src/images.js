"use strict";

/**
 * Photo intake.
 *
 * Discord fetches card images itself over public HTTPS, so the file a browser
 * uploads is judged here before it is ever stored: the type comes from the
 * bytes, not the header; real dimensions are read for every supported format;
 * anything unreadable or oversized is refused with a reason.
 */

const crypto = require("node:crypto");

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_DIM = 16;
const MAX_DIM = 4096;

class ImageError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageError";
  }
}

function isPng(b) {
  return b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
}

function isJpeg(b) {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isGif(b) {
  const head = b.subarray(0, 6).toString("latin1");
  return b.length > 10 && (head === "GIF87a" || head === "GIF89a");
}

function isWebp(b) {
  return b.length > 30 && b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP";
}

function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // Start-of-frame markers carry the dimensions; everything else is skipped.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function webpSize(b) {
  const chunk = b.subarray(12, 16).toString("latin1");
  if (chunk === "VP8 ") {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6))
    };
  }
  if (chunk === "VP8X") {
    return {
      width: 1 + (b[20] | (b[21] << 8) | (b[22] << 16)),
      height: 1 + (b[23] | (b[24] << 8) | (b[25] << 16))
    };
  }
  return null;
}

/**
 * Validate an upload buffer and return the stored asset record.
 * @returns {{ id: string, ext: string, bytes: number, width: number, height: number, addedAt: string }}
 */
function validateImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImageError("That file is empty.");
  }
  if (buffer.length > MAX_BYTES) {
    throw new ImageError("That image is larger than 2 MB. Discord cards look best at 512 by 512.");
  }

  let ext = null;
  let size = null;
  if (isPng(buffer)) {
    ext = "png";
    size = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } else if (isJpeg(buffer)) {
    ext = "jpg";
    size = jpegSize(buffer);
  } else if (isGif(buffer)) {
    ext = "gif";
    size = { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  } else if (isWebp(buffer)) {
    ext = "webp";
    size = webpSize(buffer);
  }

  if (!ext) {
    throw new ImageError("That file type is not supported. Use PNG, JPEG, GIF or WebP.");
  }
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    throw new ImageError("That image is damaged - its dimensions cannot be read, so it is refused.");
  }
  if (size.width < MIN_DIM || size.height < MIN_DIM || size.width > MAX_DIM || size.height > MAX_DIM) {
    throw new ImageError("Images must be between " + MIN_DIM + " and " + MAX_DIM + " pixels on each side. Yours is " + size.width + " by " + size.height + ".");
  }

  return {
    id: crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16),
    ext,
    bytes: buffer.length,
    width: size.width,
    height: size.height,
    addedAt: new Date().toISOString()
  };
}

module.exports = { validateImage, ImageError, MAX_BYTES };
