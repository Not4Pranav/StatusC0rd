"use strict";

/**
 * The server-side presence pipeline - what the reference site does, reached
 * through the public door.
 *
 * The reference (fallinguilt) pushes cards onto profiles from its server
 * because Discord whitelisted its OAuth scopes - "rpc.activities.write" is
 * documented as "only available to approved partners", and no code can
 * request it. This module gets the same user-visible result the way any
 * developer can: the public Discord Social SDK. The user presses
 * "Connect Discord" once on the dashboard (a normal OAuth2 consent screen,
 * scopes "openid identify sdk.social_layer_presence"), the server keeps the
 * tokens, and the SDK's own connection writes the saved card onto the
 * user's profile - no Discord window, no activity launcher, nothing open.
 *
 * The SDK is a native C library Discord ships through the Developer Portal
 * ("Discord Social SDK" -> Downloads). It is bound here with koffi FFI
 * (no node-gyp, no C++). Until the library is committed to the repo the
 * engine reports "not armed" and the dashboard keeps offering the
 * in-Discord fallback:
 *
 *   vendor/socialsdk/libdiscord_partner_sdk.so   Linux x64, release build
 *   vendor/socialsdk/cdiscord.h                  optional; verified if present
 *
 * Token notes: access tokens last about seven days; the SDK asks for a
 * refresh before they expire (TokenExpirationCallback) and the engine
 * exchanges the refresh token itself (confidential client, needs
 * CLIENT_SECRET as an environment variable).
 */

const fs = require("node:fs");
const path = require("node:path");
const { buildActivity } = require("./presence");

const VENDOR_DIR = path.join(__dirname, "..", "vendor", "socialsdk");
const OAUTH_SCOPES = "openid identify sdk.social_layer_presence";
const STATUS_NAMES = { 0: "disconnected", 1: "connecting", 2: "connected", 3: "ready", 4: "reconnecting", 5: "disconnecting" };

function createSocialSdkService({ effective, store, logger }) {
  const log = (...a) => (logger ? logger.log("[socialsdk]", ...a) : console.log("[socialsdk]", ...a));
  const warn = (...a) => (logger ? logger.warn("[socialsdk]", ...a) : console.warn("[socialsdk]", ...a));

  let koffi = null;
  let ffi = null;
  let loadError = "";
  let libPath = "";
  let bearerType = 1;
  let pumpTimer = null;
  let pumpFailed = 0;
  const clients = new Map();

  /* ---- loading ---- */

  function headerPath() {
    for (const p of [path.join(VENDOR_DIR, "cdiscord.h"), path.join(VENDOR_DIR, "include", "cdiscord.h")]) {
      if (fs.existsSync(p)) return p;
    }
    return "";
  }

  function load() {
    if (ffi || loadError) return ffi;
    libPath = process.env.SOCIALSDK_LIB || path.join(VENDOR_DIR, "libdiscord_partner_sdk.so");
    try {
      const header = headerPath();
      if (header) {
        const text = fs.readFileSync(header, "utf8");
        const direct = /Discord_AuthorizationTokenType_Bearer\s*=\s*(\d+)/.exec(text);
        const inside = /Discord_AuthorizationTokenType\s*\{[^}]*?Bearer\s*=\s*(\d+)/.exec(text);
        const match = direct || inside;
        if (match) bearerType = Number(match[1]);
      }
      if (process.env.SOCIALSDK_TOKEN_TYPE) bearerType = Number(process.env.SOCIALSDK_TOKEN_TYPE) || bearerType;
      if (!fs.existsSync(libPath)) throw new Error("the Discord Social SDK library is not installed (expected " + libPath + ")");
      koffi = require("koffi");
      const lib = koffi.load(libPath);

      const DString = koffi.struct("sc_DString", { ptr: "const char *", size: "size_t" });
      const ClientH = koffi.struct("sc_Client", { opaque: "void *" });
      const ActH = koffi.struct("sc_Activity", { opaque: "void *" });
      const TsH = koffi.struct("sc_Timestamps", { opaque: "void *" });
      const AssetsH = koffi.struct("sc_Assets", { opaque: "void *" });
      const StatusCb = koffi.proto("void sc_StatusCb(int32_t status, int32_t error, int32_t detail, void *udata)");
      const ExpiryCb = koffi.proto("void sc_ExpiryCb(void *udata)");
      const ResultCb = koffi.proto("void sc_ResultCb(void *result, void *udata)");
      const LogCb = koffi.proto("void sc_LogCb(sc_DString msg, int32_t severity, void *udata)");

      ffi = {
        DString, ClientH, ActH, TsH, AssetsH, StatusCb, ExpiryCb, ResultCb, LogCb,
        Init: lib.func("void Discord_Client_Init(sc_Client *self)"),
        Drop: lib.func("void Discord_Client_Drop(sc_Client *self)"),
        SetAppId: lib.func("void Discord_Client_SetApplicationId(sc_Client *self, uint64_t id)"),
        SetStatusCb: lib.func("void Discord_Client_SetStatusChangedCallback(sc_Client *self, sc_StatusCb *cb, void *freeFn, void *udata)"),
        SetExpiryCb: lib.func("void Discord_Client_SetTokenExpirationCallback(sc_Client *self, sc_ExpiryCb *cb, void *freeFn, void *udata)"),
        UpdateToken: lib.func("void Discord_Client_UpdateToken(sc_Client *self, int32_t type, sc_DString token, sc_ResultCb *cb, void *freeFn, void *udata)"),
        Connect: lib.func("void Discord_Client_Connect(sc_Client *self)"),
        Disconnect: lib.func("void Discord_Client_Disconnect(sc_Client *self)"),
        RunCallbacks: lib.func("void Discord_RunCallbacks()"),
        ActInit: lib.func("void Discord_Activity_Init(sc_Activity *self)"),
        ActDrop: lib.func("void Discord_Activity_Drop(sc_Activity *self)"),
        SetName: lib.func("void Discord_Activity_SetName(sc_Activity *self, sc_DString name)"),
        SetType: lib.func("void Discord_Activity_SetType(sc_Activity *self, int32_t type)"),
        SetDetails: lib.func("void Discord_Activity_SetDetails(sc_Activity *self, sc_DString *details)"),
        SetState: lib.func("void Discord_Activity_SetState(sc_Activity *self, sc_DString *state)"),
        TsInit: lib.func("void Discord_ActivityTimestamps_Init(sc_Timestamps *self)"),
        TsSetStart: lib.func("void Discord_ActivityTimestamps_SetStart(sc_Timestamps *self, uint64_t start)"),
        SetTs: lib.func("void Discord_Activity_SetTimestamps(sc_Activity *self, sc_Timestamps *ts)"),
        TsDrop: lib.func("void Discord_ActivityTimestamps_Drop(sc_Timestamps *self)"),
        AssetsInit: lib.func("void Discord_ActivityAssets_Init(sc_Assets *self)"),
        AssetsSetLarge: lib.func("void Discord_ActivityAssets_SetLargeImage(sc_Assets *self, sc_DString *image)"),
        AssetsSetLargeText: lib.func("void Discord_ActivityAssets_SetLargeText(sc_Assets *self, sc_DString *text)"),
        AssetsSetSmall: lib.func("void Discord_ActivityAssets_SetSmallImage(sc_Assets *self, sc_DString *image)"),
        AssetsSetSmallText: lib.func("void Discord_ActivityAssets_SetSmallText(sc_Assets *self, sc_DString *text)"),
        SetAssets: lib.func("void Discord_Activity_SetAssets(sc_Activity *self, sc_Assets *assets)"),
        AssetsDrop: lib.func("void Discord_ActivityAssets_Drop(sc_Assets *self)"),
        UpdateRP: lib.func("void Discord_Client_UpdateRichPresence(sc_Client *self, sc_Activity *activity, sc_ResultCb *cb, void *freeFn, void *udata)"),
        ResultOk: lib.func("bool Discord_ClientResult_Successful(void *result)"),
        ResultErr: lib.func("void Discord_ClientResult_Error(void *result, sc_DString *out)")
      };
      try {
        const AddLog = lib.func("void Discord_Client_AddLogCallback(sc_Client *self, sc_LogCb *cb, void *freeFn, void *udata, int32_t severity)");
        ffi.AddLog = AddLog;
      } catch (error) {
        /* the log callback is optional - its signature varies by SDK build */
      }
      ensurePump();
      log("armed - " + libPath + (header ? " (cdiscord.h verified, Bearer=" + bearerType + ")" : " (no cdiscord.h, Bearer=" + bearerType + " assumed)"));
    } catch (error) {
      loadError = String((error && error.message) || error);
      ffi = null;
      warn("not armed:", loadError);
    }
    return ffi;
  }

  function ensurePump() {
    if (pumpTimer || !ffi) return;
    pumpTimer = setInterval(() => {
      try {
        ffi.RunCallbacks();
      } catch (error) {
        if (++pumpFailed < 5) warn("pump failed:", (error && error.message) || error);
      }
    }, 100);
    if (pumpTimer.unref) pumpTimer.unref();
  }

  /* ---- string plumbing ---- */

  function dstr(text) {
    const value = String(text === undefined || text === null ? "" : text);
    return { ptr: value, size: Buffer.byteLength(value, "utf8") };
  }

  function decodeDstr(view) {
    try {
      if (!view || !view.ptr) return "";
      return koffi.decode(view.ptr, "str");
    } catch {
      return "";
    }
  }

  function resultError(resultPtr) {
    try {
      if (!resultPtr || !ffi.ResultOk(resultPtr)) {
        const out = { ptr: null, size: 0 };
        try {
          ffi.ResultErr(resultPtr, out);
        } catch {
          /* keep the generic message */
        }
        const text = decodeDstr(out);
        return text || "Discord refused the request";
      }
      return "";
    } catch (error) {
      return (error && error.message) || "unknown result error";
    }
  }

  /* ---- one client per connected user ---- */

  function userStatus(id) {
    const client = clients.get(String(id));
    const armed = Boolean(ffi);
    return {
      armed,
      libPath: armed ? libPath : "",
      loadError: armed ? "" : loadError,
      connected: Boolean(client),
      status: client ? client.status : "",
      lastError: client ? client.lastError : "",
      scopes: OAUTH_SCOPES
    };
  }

  function summary() {
    return {
      armed: Boolean(ffi),
      libPath,
      loadError,
      clients: [...clients.values()].map((c) => ({ id: c.id, status: c.status, lastError: c.lastError }))
    };
  }

  function connectUser(user) {
    if (!load()) return { ok: false, error: loadError || "the Social SDK is not armed" };
    const id = String(user.id);
    const oauth = store.getOauth(id);
    if (!oauth || !oauth.accessToken) return { ok: false, error: "Connect Discord first" };
    const clientId = effective().clientId;
    if (!clientId) return { ok: false, error: "no CLIENT_ID configured" };
    if (clients.has(id)) return { ok: true, note: "already connecting or connected" };

    const handle = { opaque: null };
    const state = { id, handle, status: "init", lastError: "", regs: [], tokenCb: null, rpCb: null };
    clients.set(id, state);
    try {
      ffi.Init(handle);
      ffi.SetAppId(handle, BigInt(clientId));

      const statusCb = koffi.register((status, error, detail) => {
        state.status = STATUS_NAMES[status] || String(status);
        if (status === 3) {
          // Ready: the SDK connection is live - put the card on the profile.
          log(id + " ready");
          pushUser(id);
        } else if (status === 0) {
          log(id + " disconnected" + (error ? " (error " + error + " detail " + detail + ")" : ""));
        }
      }, ffi.StatusCb);
      state.regs.push(statusCb);
      ffi.SetStatusCb(handle, statusCb, null, null);

      const expiryCb = koffi.register(() => {
        log(id + " token expiring - refreshing");
        void refreshAndRetoken(id);
      }, ffi.ExpiryCb);
      state.regs.push(expiryCb);
      ffi.SetExpiryCb(handle, expiryCb, null, null);

      if (ffi.AddLog) {
        try {
          const logCb = koffi.register((msg) => {
            const line = decodeDstr(msg);
            if (line) log("(" + id + ") " + line);
          }, ffi.LogCb);
          state.regs.push(logCb);
          ffi.AddLog(handle, logCb, null, null, 3 /* Error..Info */);
        } catch {
          /* logging through the SDK is a bonus, never a blocker */
        }
      }

      const token = dstr(oauth.accessToken);
      if (state.tokenCb) {
        try {
          koffi.unregister(state.tokenCb);
        } catch {
          /* already released */
        }
        state.tokenCb = null;
      }
      const tokenCb = koffi.register((result) => {
        const problem = resultError(result);
        if (problem) {
          state.status = "token-error";
          state.lastError = "Discord rejected the token: " + problem;
          warn(id + " token rejected:", problem);
          return;
        }
        try {
          ffi.Connect(handle);
          state.status = "connecting";
        } catch (error) {
          state.status = "error";
          state.lastError = String((error && error.message) || error);
        }
      }, ffi.ResultCb);
      state.tokenCb = tokenCb;
      ffi.UpdateToken(handle, bearerType, token, tokenCb, null, null);
      state.status = "authenticating";
      return { ok: true };
    } catch (error) {
      state.status = "error";
      state.lastError = String((error && error.message) || error);
      warn(id + " connect failed:", state.lastError);
      try {
        ffi.Drop(handle);
      } catch {
        /* nothing left to free */
      }
      clients.delete(id);
      return { ok: false, error: state.lastError };
    }
  }

  function disconnectUser(id) {
    const key = String(id);
    const state = clients.get(key);
    if (!state) return;
    clients.delete(key);
    try {
      ffi.Disconnect(state.handle);
    } catch {
      /* already gone */
    }
    for (const reg of [...state.regs, state.tokenCb, state.rpCb]) {
      if (!reg) continue;
      try {
        koffi.unregister(reg);
      } catch {
        /* best effort */
      }
    }
    try {
      ffi.Drop(state.handle);
    } catch {
      /* best effort */
    }
    log(key + " disconnected by request");
  }

  /* ---- the card, through the SDK ---- */

  function activityFor(user) {
    const config = effective();
    return buildActivity(user.presence, {
      target: "profile",
      publicUrl: config.publicUrl,
      resolveAsset: (assetId) => {
        const asset = store.findAsset(user.id, assetId);
        return asset ? store.assetUrl(asset, config.publicUrl) : "";
      }
    });
  }

  function pushUser(id) {
    if (!ffi) return { ok: false, error: "not armed" };
    const key = String(id);
    const state = clients.get(key);
    if (!state) return { ok: false, error: "not connected" };
    const user = store.getUser(key);
    if (!user || !user.oauth) return { ok: false, error: "not authorized" };
    if (!user.presence || !user.presence.enabled) return { ok: false, error: "card disabled" };

    const activityObject = activityFor(user);
    if (!activityObject) return { ok: false, error: "nothing to show" };

    const activity = { opaque: null };
    const ts = { opaque: null };
    const assets = { opaque: null };
    // Retire the previous push callback between pumps - unregistering a
    // callback from inside itself would be unsafe.
    if (state.rpCb) {
      try {
        koffi.unregister(state.rpCb);
      } catch {
        /* already released */
      }
      state.rpCb = null;
    }
    try {
      ffi.ActInit(activity);
      ffi.SetName(activity, dstr(activityObject.name || "StatusC0rd"));
      ffi.SetType(activity, Number(activityObject.type) || 0);
      if (activityObject.details) ffi.SetDetails(activity, dstr(activityObject.details));
      if (activityObject.state) ffi.SetState(activity, dstr(activityObject.state));

      if (activityObject.timestamps && Number(activityObject.timestamps.start) > 0) {
        ffi.TsInit(ts);
        ffi.TsSetStart(ts, BigInt(Math.floor(Number(activityObject.timestamps.start) / 1000)));
        ffi.SetTs(activity, ts);
        ffi.TsDrop(ts);
      }

      // The SDK only understands asset keys uploaded to the application in
      // the Developer Portal - never URLs. Keys pass through untouched.
      const large = (activityObject.assets && activityObject.assets.large_image) || "";
      const small = (activityObject.assets && activityObject.assets.small_image) || "";
      const largeText = (activityObject.assets && activityObject.assets.large_text) || "";
      const smallText = (activityObject.assets && activityObject.assets.small_text) || "";
      const usableLarge = large && !/^https?:\/\//i.test(large) ? large : "";
      const usableSmall = small && !/^https?:\/\//i.test(small) ? small : "";
      if (usableLarge || usableSmall) {
        ffi.AssetsInit(assets);
        if (usableLarge) {
          ffi.AssetsSetLarge(assets, dstr(usableLarge));
          if (largeText) ffi.AssetsSetLargeText(assets, dstr(largeText));
        }
        if (usableSmall) {
          ffi.AssetsSetSmall(assets, dstr(usableSmall));
          if (smallText) ffi.AssetsSetSmallText(assets, dstr(smallText));
        }
        ffi.SetAssets(activity, assets);
        ffi.AssetsDrop(assets);
      }

      const rpCb = koffi.register((result) => {
        const problem = resultError(result);
        if (problem) {
          state.lastError = "presence push refused: " + problem;
          warn(key + " presence refused:", problem);
        } else {
          state.lastError = "";
          log(key + " card pushed to profile");
        }
      }, ffi.ResultCb);
      state.rpCb = rpCb;
      ffi.UpdateRP(state.handle, activity, rpCb, null, null);
      return { ok: true };
    } catch (error) {
      state.lastError = String((error && error.message) || error);
      warn(key + " presence push failed:", state.lastError);
      return { ok: false, error: state.lastError };
    } finally {
      try {
        ffi.ActDrop(activity);
      } catch {
        /* best effort */
      }
    }
  }

  /* ---- token lifecycle ---- */

  async function refreshAccessToken(id) {
    const oauth = store.getOauth(id);
    if (!oauth || !oauth.refreshToken) return null;
    const config = effective();
    if (!config.clientId || !config.clientSecret) return null;
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: oauth.refreshToken
    });
    const res = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      warn(id + " token refresh failed:", json.error || "HTTP " + res.status);
      return null;
    }
    store.setOauth(id, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || oauth.refreshToken,
      expiresAt: Date.now() + (Number(json.expires_in) || 604800) * 1000,
      scope: json.scope || oauth.scope,
      connectedAt: oauth.connectedAt
    });
    return json.access_token;
  }

  async function refreshAndRetoken(id) {
    const fresh = await refreshAccessToken(id);
    const state = clients.get(String(id));
    if (!fresh || !state) return;
    if (state.tokenCb) {
      try {
        koffi.unregister(state.tokenCb);
      } catch {
        /* already released */
      }
      state.tokenCb = null;
    }
    const tokenCb = koffi.register((result) => {
      const problem = resultError(result);
      if (!problem) {
        try {
          ffi.Connect(state.handle);
        } catch {
          /* the status callback reports it */
        }
      } else {
        state.status = "token-error";
        state.lastError = "Discord rejected the refreshed token: " + problem;
      }
    }, ffi.ResultCb);
    state.tokenCb = tokenCb;
    ffi.UpdateToken(state.handle, bearerType, dstr(fresh), tokenCb, null, null);
  }

  /* ---- what the routes call ---- */

  // A save, a clear, a toggle: bring the profile in line with the stored card.
  function syncUser(id) {
    const user = store.getUser(id);
    if (!user) return;
    const oauth = user.oauth;
    if (!oauth) return;
    const enabled = user.presence && user.presence.enabled && user.presence.name;
    if (!enabled) {
      disconnectUser(id);
      return;
    }
    if (!clients.has(String(id))) {
      connectUser(user);
    } else {
      pushUser(id);
    }
  }

  // After a boot (and a restore): everyone with tokens comes back, staggered.
  function restore() {
    if (!load()) return;
    const waiting = [];
    for (const user of Object.values(store.data.users || {})) {
      if (user.oauth && user.oauth.accessToken && user.presence && user.presence.enabled) waiting.push(user);
    }
    waiting.forEach((user, index) => {
      setTimeout(() => {
        const fresh = store.getUser(user.id);
        if (fresh && fresh.oauth && fresh.presence && fresh.presence.enabled) connectUser(fresh);
      }, 1500 + index * 2500);
    });
    if (waiting.length) log("restoring " + waiting.length + " presence connection(s)");
  }

  function stopAll() {
    for (const id of [...clients.keys()]) disconnectUser(id);
    if (pumpTimer) {
      clearInterval(pumpTimer);
      pumpTimer = null;
    }
  }

  return { load, userStatus, summary, connectUser, disconnectUser, pushUser, syncUser, restore, stopAll, OAUTH_SCOPES };
}

module.exports = { createSocialSdkService };
