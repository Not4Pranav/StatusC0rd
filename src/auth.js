"use strict";

/**
 * Email + password sign-in and the ;rpc access links (v5.1).
 *
 * The website no longer talks to Discord's OAuth for sign-in: the bot hands
 * out a signed 30-minute link that names the Discord user, and registering
 * through that link is the approval - the same pipeline as the reference
 * site. Passwords are scrypt-hashed with a per-account salt; tokens are
 * HMAC-signed with the session secret and never touch the database.
 */

const crypto = require("node:crypto");

const DEFAULT_TOKEN_TTL_MS = 30 * 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Sign { id, name } into a compact url-safe token with an expiry. */
function createAccessToken(payload, secret, ttlMs) {
  const body = {
    id: String((payload && payload.id) || ""),
    name: String((payload && payload.name) || "Discord user"),
    avatar: String((payload && payload.avatar) || ""),
    decoration: String((payload && payload.decoration) || ""),
    exp: Date.now() + (ttlMs || DEFAULT_TOKEN_TTL_MS)
  };
  if (!body.id) throw new Error("An access link needs a Discord id.");
  const data = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", String(secret || "")).update(data).digest("base64url");
  return data + "." + signature;
}

/** Verify a link token: returns { id, name } or null when fake or expired. */
function readAccessToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = crypto.createHmac("sha256", String(secret || "")).update(parts[0]).digest("base64url");
  const a = Buffer.from(parts[1], "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || a.length === 0 || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!body || !body.id || Number(body.exp) < Date.now()) return null;
    return { id: String(body.id), name: String(body.name || "Discord user"), avatar: String(body.avatar || ""), decoration: String(body.decoration || "") };
  } catch {
    return null;
  }
}

/** scrypt with a random 16-byte salt; 64 derived bytes. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const computed = crypto.scryptSync(String(password || ""), String(salt || ""), 64);
    const expected = Buffer.from(String(hash || ""), "hex");
    return expected.length === computed.length && crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

function isValidEmail(value) {
  const text = String(value || "").trim();
  return text.length <= 254 && EMAIL_PATTERN.test(text);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

module.exports = { createAccessToken, readAccessToken, hashPassword, verifyPassword, isValidEmail, normalizeEmail };
