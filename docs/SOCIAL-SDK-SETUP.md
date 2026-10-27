# Server-side presence - setup (v7)

The dashboard button **Connect Discord** authorizes your Discord account
(OAuth scopes *openid identify sdk.social_layer_presence*), the server stores
the tokens, and the **Discord Social SDK** pushes your saved card onto your
profile from the server - the way the reference site does it. No Discord
window, no activity launcher, nothing to keep open.

Three things the pipeline needs that only you can do:

## 1. Register the OAuth redirect

Discord Developer Portal -> your application -> OAuth2 -> Add Redirect:

    https://statusc0rd-4oke.onrender.com/oauth/callback

## 2. Keep CLIENT_SECRET as an environment variable

The token exchange runs server-side with the secret. It must be a Render
environment variable - settings stored on the dashboard are wiped with the
disk on every deploy. CLIENT_ID stays as it already is.

## 3. Commit the Social SDK library into the repo

Discord ships the SDK only through the authenticated Developer Portal
(there is no scriptable download URL, and its terms only allow shipping it
inside your own app - this repo is private, which satisfies that).

1. Developer Portal -> your application -> **Discord Social SDK** -> Downloads.
2. Download the SDK zip (any 1.9.x), unzip it.
3. In the zip, find the **Linux** library and the C header:

       lib/.../libdiscord_partner_sdk.so        (the x64 release build)
       include/cdiscord.h

4. Upload both files to this repo (GitHub web "Add file" works for binaries),
   at exactly these paths:

       vendor/socialsdk/libdiscord_partner_sdk.so
       vendor/socialsdk/cdiscord.h

Push to main, Render redeploys, npm installs *koffi* (the FFI binding), and
the engine arms itself at boot. The dashboard pill shows **Card live from
server** once you press Connect Discord and authorize.

## Notes and limits

- The card persists only while the Render service is awake - on the free
  plan it sleeps, so keep an external pinger hitting /health.
- Access tokens last about 7 days; the engine refreshes them automatically
  from the stored refresh token (needs CLIENT_SECRET).
- Buttons do not render in SDK presence (platform limit); text, timestamps
  and uploaded **asset keys** do. Image URLs cannot be sent through the SDK -
  only asset names uploaded under Rich Presence -> Art Assets in the portal.
- If the authorize screen refuses the *sdk.social_layer_presence* scope,
  Discord may require the app to be flagged for the Social SDK in the portal
  first (toggle any Social SDK setting and retry).
- Fallback: the **Go live in Discord** button still works exactly as before
  (the in-Discord activity window).
