"use strict";

/**
 * One-click starting points for the editor.
 *
 * A blank form is the reason people stare at a dashboard instead of going live,
 * so every template is a complete, valid presence: text, type and (where it
 * makes sense) buttons. Images are deliberately left empty - they belong to the
 * person, and a stock photo would be worse than none.
 *
 * Kept server-side so the same list feeds the UI, the API and the tests.
 */

const TEMPLATES = Object.freeze([
  {
    id: "focus",
    name: "Focus mode",
    blurb: "Deep work, do not disturb",
    accent: "#3ddc97",
    presence: {
      name: "Focus",
      type: 0,
      status: "dnd",
      details: "Deep work",
      state: "Notifications off",
      buttons: []
    }
  },
  {
    id: "listening",
    name: "Listening",
    blurb: "A track on loop",
    accent: "#5865f2",
    presence: {
      name: "Lo-fi beats",
      type: 2,
      status: "online",
      details: "Track on repeat",
      state: "via StatusC0rd",
      buttons: []
    }
  },
  {
    id: "building",
    name: "Building",
    blurb: "Shipping in public",
    accent: "#f0b232",
    presence: {
      name: "Building StatusC0rd",
      type: 0,
      status: "online",
      details: "Shipping in public",
      state: "commit by commit",
      buttons: [
        { label: "Source", url: "https://github.com/Not4Pranav/StatusC0rd" },
        { label: "Setup", url: "https://github.com/Not4Pranav/StatusC0rd/blob/main/SETUP.md" }
      ]
    }
  },
  {
    id: "watching",
    name: "Watching",
    blurb: "A stream or a series",
    accent: "#eb459e",
    presence: {
      name: "a stream",
      type: 3,
      status: "online",
      details: "Second monitor",
      state: "chat is open",
      buttons: []
    }
  },
  {
    id: "gaming",
    name: "Gaming",
    blurb: "Session with friends",
    accent: "#57f287",
    presence: {
      name: "Minecraft",
      type: 0,
      status: "online",
      details: "Building a base",
      state: "survival",
      buttons: []
    }
  },
  {
    id: "studying",
    name: "Studying",
    blurb: "Course or exam prep",
    accent: "#00b0f4",
    presence: {
      name: "Studying",
      type: 0,
      status: "idle",
      details: "Backend basics",
      state: "lesson 12",
      buttons: []
    }
  },
  {
    id: "reading",
    name: "Reading",
    blurb: "Book, page number, quiet",
    accent: "#c9a227",
    presence: {
      name: "Reading",
      type: 0,
      status: "online",
      details: "Sci-fi novel",
      state: "page 214",
      buttons: []
    }
  },
  {
    id: "break",
    name: "On a break",
    blurb: "Back in ten",
    accent: "#f87171",
    presence: {
      name: "On a break",
      type: 0,
      status: "idle",
      details: "Back in 10 minutes",
      state: "coffee first",
      buttons: []
    }
  },
  {
    id: "studio",
    name: "In the studio",
    blurb: "Mixing, editing, rendering",
    accent: "#a78bfa",
    presence: {
      name: "In the studio",
      type: 0,
      status: "dnd",
      details: "Mixing track 4",
      state: "headphones on",
      buttons: []
    }
  },
  {
    id: "competing",
    name: "Ranked",
    blurb: "Competing in a queue",
    accent: "#ff9f1c",
    presence: {
      name: "Ranked grind",
      type: 5,
      status: "online",
      details: "Climbing the ladder",
      state: "queue open",
      buttons: []
    }
  }
]);

/** Metadata only: what the dashboard needs to draw the chips. */
function templateList() {
  return TEMPLATES.map(({ id, name, blurb, accent }) => ({ id, name, blurb, accent }));
}

/**
 * Merge a template into the current config, keeping the parts a template should
 * not decide (which places the presence goes to, image choices, timer state).
 * The result still has to pass `sanitizePresence` - templates are not a way to
 * bypass validation.
 */
function applyTemplate(id, current = {}) {
  const template = TEMPLATES.find((item) => item.id === id);
  if (!template) return null;
  return {
    ...current,
    name: template.presence.name,
    type: template.presence.type,
    status: template.presence.status,
    details: template.presence.details,
    state: template.presence.state,
    url: "",
    buttons: template.presence.buttons.map((button) => ({ ...button })),
    startedAt: false,
    startTimestamp: null
  };
}

module.exports = { applyTemplate, templateList };
