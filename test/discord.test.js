"use strict";

/**
 * The Discord application check.
 *
 * These run against a local stub, so they assert what the app *does* with an
 * answer from Discord - including the three answers that matter: user install
 * on, user install off, and a Launch command that is server-only.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { inspectApplication, findEntryPoint, installContexts } = require("../src/discordApi");

/** A one-shot stub of the two Discord endpoints this module reads. */
async function stubDiscord({ application, commands, status = 200 }) {
  const server = http.createServer((req, res) => {
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: "Unauthorized", code: 0 }));
    }
    if (req.url.startsWith("/applications/@me")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(application));
    }
    if (req.url.startsWith("/applications/") && req.url.endsWith("/commands")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(commands));
    }
    res.writeHead(404).end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

const GOOD_APP = {
  id: "123456789012345678",
  name: "Star StatusC0rd",
  integration_types_config: {
    0: { oauth2_install_params: { scopes: ["bot", "applications.commands"], permissions: "0" } },
    1: { oauth2_install_params: { scopes: ["applications.commands"] } }
  }
};

const LAUNCH_FOR_EVERYONE = [{ id: "1", name: "Launch", type: 4, integration_types: [0, 1], contexts: [0, 1, 2] }];

test("a correctly configured app comes back clean", async () => {
  const { server, base } = await stubDiscord({ application: GOOD_APP, commands: LAUNCH_FOR_EVERYONE });
  const previous = process.env.DISCORD_API_BASE;
  process.env.DISCORD_API_BASE = base;
  try {
    const result = await inspectApplication({ token: "bot-token-here" });
    assert.equal(result.name, "Star StatusC0rd");
    assert.equal(result.install.user, true);
    assert.equal(result.install.guild, true);
    assert.equal(result.entryPointOk, true);
    assert.deepEqual(result.problems, []);
  } finally {
    process.env.DISCORD_API_BASE = previous;
    server.close();
  }
});

test("a user-install-less app is told exactly what to turn on", async () => {
  const app = { ...GOOD_APP, integration_types_config: { 0: {} } };
  const { server, base } = await stubDiscord({
    application: app,
    commands: [{ id: "1", name: "Launch", type: 4, integration_types: [0] }]
  });
  const previous = process.env.DISCORD_API_BASE;
  process.env.DISCORD_API_BASE = base;
  try {
    const result = await inspectApplication({ token: "bot-token-here" });
    assert.equal(result.install.user, false);
    assert.equal(result.entryPointOk, false);
    assert.equal(result.problems.length, 2, result.problems.join(" | "));
    assert.match(result.problems[0], /User Install/);
    assert.match(result.problems[1], /App Launcher/);
  } finally {
    process.env.DISCORD_API_BASE = previous;
    server.close();
  }
});

test("a missing Activities setup is explained, not guessed at", async () => {
  const { server, base } = await stubDiscord({ application: GOOD_APP, commands: [] });
  const previous = process.env.DISCORD_API_BASE;
  process.env.DISCORD_API_BASE = base;
  try {
    const result = await inspectApplication({ token: "bot-token-here" });
    assert.equal(result.entryPoint, null);
    assert.match(result.problems.join(" "), /Enable Activities/);
  } finally {
    process.env.DISCORD_API_BASE = previous;
    server.close();
  }
});

test("a rejected bot token is reported as a rejected bot token", async () => {
  const { server, base } = await stubDiscord({ status: 401 });
  const previous = process.env.DISCORD_API_BASE;
  process.env.DISCORD_API_BASE = base;
  try {
    await assert.rejects(() => inspectApplication({ token: "wrong" }), /bot token/i);
  } finally {
    process.env.DISCORD_API_BASE = previous;
    server.close();
  }
});

test("no bot token is refused before any request is made", async () => {
  await assert.rejects(() => inspectApplication({ token: "  " }), /No bot token/);
});

test("helpers read Discord's shapes without throwing on surprises", () => {
  assert.deepEqual(installContexts({}), { user: false, guild: false, raw: null });
  assert.deepEqual(installContexts({ integration_types_config: { 1: {} } }), {
    user: true,
    guild: false,
    raw: { 1: {} }
  });
  assert.equal(findEntryPoint([]), null);
  assert.equal(findEntryPoint(null), null);
  // An entry point that does not say where it installs is server-only.
  assert.deepEqual(findEntryPoint([{ type: 4, name: "Launch" }]), {
    name: "Launch",
    integrationTypes: [0],
    contexts: []
  });
});
