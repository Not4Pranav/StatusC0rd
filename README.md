# StatusC0rd

StatusC0rd is a Node.js dashboard for controlling a Discord bot's presence and
connecting user accounts through Discord OAuth.

The Discord application is named **VanC0rd**. The application ID and client ID
are `1554342719923560518`. Its public key is
`cd1c10dd26d6f42bf638c40bb2d556077df764ebade5f23cf09cbaec4b8d14cc`.
These identifiers are public; never publish the bot token, client secret,
session secret, dashboard key, or OAuth tokens.

## Requirements

- Node.js 18 or newer
- A Discord application with a bot user and an OAuth2 client secret
- A publicly reachable HTTPS URL for a hosted deployment
- A Discord account to authorize for the RPC connection

## Discord Developer Portal setup

1. Create or select the application named **VanC0rd**.
2. Confirm its Application ID and Client ID are `1554342719923560518`. The
   public key is provided above. This app does not currently receive Discord
   interaction webhooks, so the public key is not consumed by this project.
3. Under **Bot**, create/reset the bot token. Keep it private.
4. Under **OAuth2**, obtain the client secret. The previously shared client
   secret must be revoked/reset before deployment; do not reuse it.
5. Add the exact callback URL to the OAuth2 redirect URLs:
   `https://<your-render-service>.onrender.com/api/rpc/callback`
   (for local development, use
   `http://localhost:3000/api/rpc/callback`).
6. The app requests the `rpc` scope for account authorization. The dashboard
   also creates a bot invite URL with the `bot` scope and no requested
   permissions.

## Local setup

```sh
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Required value |
| --- | --- |
| `CLIENT_ID` | Discord client ID: `1554342719923560518` |
| `APPLICATION_ID` | Discord application ID: `1554342719923560518` (currently informational) |
| `PUBLIC_KEY` | Discord public key above (currently informational) |
| `DISCORD_TOKEN` | Private bot token from the Developer Portal |
| `CLIENT_SECRET` | New private OAuth2 client secret from the Developer Portal |
| `SESSION_SECRET` | A unique, random secret used to sign dashboard sessions |
| `DASHBOARD_KEY` | A separate, strong password for dashboard login |
| `REDIRECT_URI` | Exact callback URL registered in OAuth2; locally `http://localhost:3000/api/rpc/callback` |

Generate different random values for `SESSION_SECRET` and `DASHBOARD_KEY`, for
example with `openssl rand -hex 32`. Do not use the example file as a production
environment file.

Start the server:

```sh
npm start
```

Open `http://localhost:3000/login` and enter the `DASHBOARD_KEY`. The health
endpoint is `http://localhost:3000/health`.

## Render deployment

1. Push the repository to GitHub and create a Render Blueprint using
   `render.yaml` (or create a Node web service with `npm install` and `npm
   start`).
2. Set the secret environment variables in Render: `DISCORD_TOKEN`,
   `CLIENT_SECRET`, `SESSION_SECRET`, and `DASHBOARD_KEY`. Generate fresh
   values for the last two. Do not commit these values.
3. Set `REDIRECT_URI` to the exact public callback URL for the Render service:
   `https://<your-render-service>.onrender.com/api/rpc/callback`.
4. Add that same URL under the Discord application's OAuth2 redirect URLs.
5. Deploy and open the service URL. Log in with `DASHBOARD_KEY`.

`render.yaml` defines the public application identifiers and prompts for
private values with `sync: false`. `data/users.json` stores user OAuth tokens
and is ignored by Git; configure persistent storage if connected accounts must
survive redeployments.
