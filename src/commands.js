"use strict";

/**
 * The in-Discord half of the approval flow - the reference pipeline.
 *
 * A member types ";rpc" in a channel (or the bot's DMs); the bot answers with
 * the "Custom RPC Dashboard" card and an "Open Dashboard" button. The button
 * points at the website with a signed 30-minute access token naming the
 * member - registering or logging in through that link approves the Discord
 * account on the spot. The slash commands do the same for people who prefer
 * them, and every server the bot joins gets a welcome card. Works in guilds
 * and, after a user install, in DMs.
 */

const { createAccessToken } = require("./auth");

const ACCESS_TOKEN_TTL_MS = 30 * 60_000;
const RPC_COOLDOWN_MS = 5_000;

const RPC_TITLE = "Custom RPC Dashboard";
const RPC_DESCRIPTION = "Sign in, link your Discord and set your own status and images. Saved a card? Press Launch in Discord on the dashboard (or type /live) and it goes on your profile.";
const WELCOME_TITLE = "Your activity, your way";
const WELCOME_DESCRIPTION =
  "Create a custom, fully configurable Discord activity. Pick the title, details, images and buttons, then go live in seconds.";

function commandDefs() {
  return [
    {
      name: "dashboard",
      description: "Open the web dashboard - your personal access link",
      integration_types: [0, 1],
      contexts: [0, 1, 2]
    },
    {
      name: "card",
      description: "Your public card page link",
      integration_types: [0, 1],
      contexts: [0, 1, 2]
    },
    {
      name: "invite",
      description: "Add this app to your account - works anywhere, no server needed",
      integration_types: [0, 1],
      contexts: [0, 1, 2]
    },
    {
      name: "live",
      description: "Launch the in-Discord app - puts your saved card on your profile",
      integration_types: [0, 1],
      contexts: [0, 1, 2]
    }
  ];
}

function createCommandsService({ effective, store, logger = console }) {
  let registeredGlobal = false;
  const cooldowns = new Map();

  function base() {
    return String(effective().publicUrl || "").replace(/\/+$/, "");
  }

  /** The Discord side of a member: avatar hash and decoration asset, when they wear one. */
  function profileOf(user) {
    const deco = user && (user.avatarDecorationData || user.avatar_decoration_data);
    return {
      avatar: String((user && user.avatar) || ""),
      decoration: String((deco && (deco.asset || deco.avatar_decoration_asset)) || "")
    };
  }

  /** A signed 30-minute link naming the member - the Discord half of the approval. */
  function accessUrl(discordId, name, profile) {
    const url = base();
    if (!url || !discordId) return "";
    const token = createAccessToken({ id: discordId, name: name || "Discord user", avatar: profile && profile.avatar, decoration: profile && profile.decoration }, store.sessionSecret(), ACCESS_TOKEN_TTL_MS);
    return url + "/access/" + token;
  }

  function builders() {
    return require("discord.js");
  }

  /** The "Custom RPC Dashboard" card the reference bot sends on ;rpc. */
  function rpcPayload(discordId, name, profile) {
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = builders();
    const url = accessUrl(discordId, name, profile);
    const embed = new EmbedBuilder().setTitle(RPC_TITLE).setDescription(RPC_DESCRIPTION);
    const buttons = [];
    if (url) buttons.push(new ButtonBuilder().setLabel("Open Dashboard").setStyle(ButtonStyle.Link).setURL(url));
    buttons.push(new ButtonBuilder().setLabel("Add to my apps").setStyle(ButtonStyle.Link).setURL(base() + "/invite"));
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };
  }

  /** The welcome card posted in every server the bot joins. */
  function welcomePayload() {
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = builders();
    const embed = new EmbedBuilder()
      .setTitle(WELCOME_TITLE)
      .setDescription(WELCOME_DESCRIPTION)
      .addFields({ name: "Getting started", value: "Type ;rpc anywhere I am to get your personal dashboard access link." });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Open Dashboard").setStyle(ButtonStyle.Link).setURL(base() + "/"),
      new ButtonBuilder().setLabel("Add to my apps").setStyle(ButtonStyle.Link).setURL(base() + "/invite")
    );
    return { embeds: [embed], components: [row] };
  }

  async function register(rest, clientId, guildId) {
    const { Routes } = require("discord.js");
    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    // Discord auto-adds an "Entry Point" command to apps with an Activity; a
    // bulk overwrite that drops it is refused. Fetch it and keep it verbatim.
    let body = commandDefs();
    try {
      const current = await rest.get(route);
      const entryPoints = (current || [])
        .filter((cmd) => Number(cmd && cmd.type) === 4)
        .map((cmd) => Object.assign({}, cmd));
      body = entryPoints.concat(body);
    } catch {
      /* first run or nothing to preserve: plain update */
    }
    await rest.put(route, { body: body });
  }

  /** Called when the gateway is ready: publish the commands globally, once. */
  async function onReady({ token, clientId }) {
    if (!token || !clientId || registeredGlobal) return;
    const { REST } = require("discord.js");
    const rest = new REST().setToken(token);
    try {
      await register(rest, clientId, null);
      registeredGlobal = true;
      logger.log("[commands] slash commands registered globally.");
    } catch (error) {
      logger.warn("[commands] global registration failed:", error.message);
    }
  }

  /** Bind ;rpc, the slash commands and the join welcome to a live client. */
  function wire(client) {
    if (!client) return;

    client.on("interactionCreate", async (interaction) => {
      try {
        if (typeof interaction.isChatInputCommand !== "function" || !interaction.isChatInputCommand()) return;
        if (!base()) return;
        if (interaction.commandName === "dashboard") {
          await interaction.reply(Object.assign({ flags: 64 }, rpcPayload(interaction.user.id, interaction.user.username, profileOf(interaction.user))));
        } else if (interaction.commandName === "card") {
          await interaction.reply({
            content: "Your public card page (publish it in the dashboard first): " + base() + "/card/" + interaction.user.id,
            flags: 64
          });
        } else if (interaction.commandName === "live") {
          const { MessageFlags, Routes } = require("discord.js");
          const launchFlag = MessageFlags && MessageFlags.LaunchActivity ? MessageFlags.LaunchActivity : (1 << 15);
          try {
            await interaction.reply({ flags: launchFlag });
          } catch (error) {
            logger.warn("[commands] /live reply failed:", error.message);
            try {
              await interaction.client.rest.post(Routes.interactionCallback(interaction.id, interaction.token), { body: { type: 12, data: {} } });
            } catch (error2) {
              logger.warn("[commands] /live callback failed:", error2.message);
              await interaction.reply({ content: "Could not launch the app here. Join a voice channel, open the App Launcher and start " + (interaction.client && interaction.client.user ? interaction.client.user.username : "the app") + " - then your card goes live on your profile.", flags: 64 }).catch(function () {});
            }
          }
        } else if (interaction.commandName === "invite") {
          await interaction.reply(Object.assign(
            { content: "Add me to your account - no server needed:", flags: 64 },
            rpcPayload(interaction.user.id, interaction.user.username, profileOf(interaction.user))
          ));
        }
      } catch (error) {
        logger.warn("[commands] interaction failed:", error.message);
      }
    });

    // The reference pipeline: ";rpc" brings the personal dashboard link.
    // Reading message content needs the privileged Message Content intent
    // (SETUP section 2.5); without it the handler simply never fires.
    client.on("messageCreate", async (message) => {
      try {
        if (!message.author || message.author.bot) return;
        if (String(message.content || "").trim().toLowerCase() !== ";rpc") return;
        if (!base()) return;
        const last = Number(cooldowns.get(message.author.id)) || 0;
        if (Date.now() - last < RPC_COOLDOWN_MS) return;
        cooldowns.set(message.author.id, Date.now());
        if (cooldowns.size > 5000) cooldowns.clear();
        await message.reply(rpcPayload(message.author.id, message.author.username, profileOf(message.author)));
      } catch (error) {
        logger.warn("[commands] ;rpc failed:", error.message);
      }
    });

    client.on("guildCreate", async (guild) => {
      try {
        // Instant availability: publish the commands to this guild on join.
        const token = effective().botToken;
        const clientId = effective().clientId;
        if (token && clientId) {
          const { REST } = require("discord.js");
          const rest = new REST().setToken(token);
          await register(rest, clientId, guild.id);
        }
        if (!base()) return;
        const channel =
          guild.systemChannel ||
          guild.channels.cache.find((c) => c.type === 0 && c.permissionsFor(guild.members.me)?.has("SendMessages"));
        if (!channel) return;
        await channel.send(welcomePayload());
        logger.log("[commands] welcomed by " + guild.name);
      } catch (error) {
        logger.warn("[commands] welcome in " + (guild && guild.name) + " failed:", error.message);
      }
    });
  }

  return { onReady, wire, rpcPayload, welcomePayload };
}

module.exports = { createCommandsService };
