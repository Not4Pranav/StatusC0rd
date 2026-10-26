"use strict";

/**
 * The in-Discord half of the approval flow.
 *
 * When the bot joins a server it posts the dashboard link in the channel, and
 * the slash commands point every member at the website. Signing in there with
 * Discord is the entire approval: the account is created and the in-Discord
 * app recognises it from that moment - the same one-click flow as the
 * reference site. Works in servers and, for user installs, in DMs.
 */

const GUILD_WELCOME =
  "Thanks for adding {SITE}! Build your card in the dashboard - press the button, " +
  "sign in with Discord, and your account is approved on the spot. " +
  "Then open the App Launcher to put it on your profile.";

function commandDefs() {
  return [
    {
      name: "dashboard",
      description: "Open the web dashboard - sign in with Discord to approve your account",
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
    }
  ];
}

function createCommandsService({ effective, logger = console }) {
  let registeredGlobal = false;

  function base() {
    return String(effective().publicUrl || "").replace(/\/+$/, "");
  }

  function row() {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
    const url = base();
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Open the dashboard").setStyle(ButtonStyle.Link).setURL(url + "/auth/discord"),
      new ButtonBuilder().setLabel("Add to my apps").setStyle(ButtonStyle.Link).setURL(url + "/invite")
    );
  }

  function welcomeText() {
    return GUILD_WELCOME.replace("{SITE}", effective().siteName || "StatusC0rd");
  }

  async function register(rest, clientId, guildId) {
    const { Routes } = require("discord.js");
    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commandDefs() });
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

  /** Bind command handling and the join welcome to a live client. */
  function wire(client) {
    if (!client) return;

    client.on("interactionCreate", async (interaction) => {
      try {
        if (typeof interaction.isChatInputCommand !== "function" || !interaction.isChatInputCommand()) return;
        if (!base()) return;
        if (interaction.commandName === "dashboard") {
          await interaction.reply({ content: welcomeText(), components: [row()], flags: 64 });
        } else if (interaction.commandName === "card") {
          await interaction.reply({
            content: "Your public card page (publish it in the dashboard first): " + base() + "/card/" + interaction.user.id,
            flags: 64
          });
        } else if (interaction.commandName === "invite") {
          await interaction.reply({
            content: "Add me to your account - no server needed:",
            components: [row()],
            flags: 64
          });
        }
      } catch (error) {
        logger.warn("[commands] interaction failed:", error.message);
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
        await channel.send({ content: welcomeText(), components: [row()] });
        logger.log("[commands] welcomed by " + guild.name);
      } catch (error) {
        logger.warn("[commands] welcome in " + (guild && guild.name) + " failed:", error.message);
      }
    });
  }

  return { onReady, wire };
}

module.exports = { createCommandsService };
