import type { Dictionary } from "./index.ts";

/** English: the same keys as pt-BR.ts (a missing or extra one fails typecheck). */
export const en: Dictionary = {
  shell: {
    sidebar: "Sidebar",
    collapse: "Collapse sidebar",
    expand: "Show sidebar",
  },
  settings: {
    language: "Language",
    theme: "Theme",
    themes: { system: "System", light: "Light", dark: "Dark" },
  },
  languages: { "pt-BR": "Português (Brasil)", en: "English" },
  palette: { toggleTheme: "Toggle theme", switchLanguage: "Switch language" },
  time: {
    now: "just now",
    ago: "{d} ago",
    hours: "{n} h",
    minutes: "{n} min",
    seconds: "{n} s",
    hoursMinutes: "{h} h {m} min",
  },
  tray: {
    needsYou: "Needs you ({n})",
    empty: "Nothing waiting for you",
    approve: "Approve",
    deny: "Deny",
    open: "Open",
    more: "and {n} more…",
    show: "Open",
    quit: "Quit",
    idle: "Flightdeck: nothing waiting for you",
    waiting: {
      one: "Flightdeck: {n} request waiting for you ({hosts})",
      other: "Flightdeck: {n} requests waiting for you ({hosts})",
    },
  },
  notify: {
    waiting: "{label}: needs you",
    allow: "Allow {tool}?",
    turnDone: "{label}: turn finished",
    turnDoneBody: "idle",
    externalTitle: "Needs you",
    quotaTitle: "Plan quota",
    quotaBody: "{host}: {window} at {percent}%",
  },
  quota: { windows: { five_hour: "5 hours", seven_day: "7 days" } },
  errors: {
    bad_request: "The host refused the request.",
    unauthorized: "The host refused the token.",
    not_found: "Not found on the host.",
    invalid_state: "That can't be done right now.",
    forbidden_cwd: "The folder is outside the host's allowed folders.",
    protocol_incompatible: "The host's version doesn't work with this app.",
    internal: "Internal error on the host.",
    invalid_permission_update: "That permission rule isn't accepted.",
    update_verification_failed: "The update failed verification.",
    update_needs_service: "To update, the host has to run as a service.",
    offline: "The host is offline.",
    timeout: "The host didn't answer in time.",
  },
};
