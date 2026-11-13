import { account } from "./en/account.ts";
import { agent } from "./en/agent.ts";
import { assistant } from "./en/assistant.ts";
import { automations } from "./en/automations.ts";
import { backup } from "./en/backup.ts";
import { board } from "./en/board.ts";
import { changes } from "./en/changes.ts";
import { chrome } from "./en/chrome.ts";
import { clients } from "./en/clients.ts";
import { costs } from "./en/costs.ts";
import { doctor } from "./en/doctor.ts";
import { firstrun } from "./en/firstrun.ts";
import { github } from "./en/github.ts";
import { hosts } from "./en/hosts.ts";
import { inbox } from "./en/inbox.ts";
import { notifications } from "./en/notifications.ts";
import { palette } from "./en/palette.ts";
import { personas } from "./en/personas.ts";
import { plugins } from "./en/plugins.ts";
import { projects } from "./en/projects.ts";
import { refusals } from "./en/refusals.ts";
import { sessions } from "./en/sessions.ts";
import { shortcuts } from "./en/shortcuts.ts";
import { snippets } from "./en/snippets.ts";
import { telemetry } from "./en/telemetry.ts";
import { terminal } from "./en/terminal.ts";
import { vault } from "./en/vault.ts";
import { watch } from "./en/watch.ts";
import type { Dictionary } from "./index.ts";

/** English: the same keys as pt-BR.ts (a missing or extra one fails typecheck). */
export const en: Dictionary = {
  inFlight: { stillWorking: "Still working…" },
  nav: { back: "Back", forward: "Forward", overview: "Home" },
  ...chrome,
  scope: {
    menu: "Data from {scope}",
    all: "All hosts",
    projects: "Projects",
    showing: "Showing {scope}",
    offline: "{host} is offline. Its numbers come back when it reconnects.",
    offlineSessions: "{host} is offline. Its sessions show again when it reconnects.",
    incompatible: "{host} needs a daemon update before its data shows here.",
    showAll: "Show all hosts",
    projectNoSessions: "{project} has no sessions.",
    noCosts: "{host} does not report costs.",
    projectEmpty: "{project} has no costs in this period.",
  },
  ...sessions,
  ...hosts,
  ...projects,
  ...doctor,
  ...github,
  ...board,
  ...costs,
  ...inbox,
  ...personas,
  ...snippets,
  ...vault,
  ...backup,
  states: {
    connecting: "Connecting to {host}…",
    loading: "Loading…",
    loadingSessions: "Loading sessions",
    loadingProjects: "Loading projects",
    loadingBoard: "Loading the board",
    loadBoardFailed: "The board did not load.",
    retry: "Try again",
    emptyHistory: "No sessions in the history.",
    emptyHistoryHint: "Start a session and it shows up here once it ends.",
    emptyHistoryLink: "New session",
    emptyProjects: "No projects yet.",
    addProject: "Add project",
    emptyCards: "No cards in this project.",
    newCard: "Create the first card",
  },
  ...firstrun,
  activity: {
    thinking: "Thinking",
    writing: "Writing",
    waiting: "Waiting for you",
    command: "Running a command",
    edit: "Editing files",
    read: "Reading files",
    search: "Searching the project",
    web: "Searching the web",
    agent: "Running a subagent",
    other: "Using {tool}",
  },
  line: {
    request: "Request: {request}",
    running: "running",
    runningTool: "running {tool}",
    waiting: "waiting for approval",
    waitingTool: "waiting for approval of {tool}",
    idle: "idle {since}",
    lessThanMinute: "less than 1 min ago",
    minutes: "{n} min ago",
    hours: "{n} h ago",
  },
  history: {
    pick: "Choose a session to read.",
  },
  settings: {
    language: "Language",
    theme: "Theme",
    density: "List density",
    densities: { compact: "Compact", comfortable: "Comfortable" },
    themes: { system: "System", light: "Light", dark: "Dark" },
    terminalFont: "Terminal font size",
    terminalReader: "Screen reader support in the terminal",
    terminalReaderHint:
      "Lets a screen reader read the terminal's output. Long output draws more slowly.",
    cacheTimer: "Prompt cache timer",
    cacheTtl: "Cache lifetime",
    cacheTtls: { fiveMinutes: "5 minutes", oneHour: "1 hour" },
    tabOrder: "Ctrl+Tab order",
    tabOrders: { mru: "Most recently used", sequential: "Tab order" },
  },
  cacheTimer: {
    expires: "Prompt cache expires in {time}",
    cold: "Prompt cache is cold",
    coldTip: "The next message will re-send the full context as uncached tokens",
    minutes: "{n} minutes",
    minutesOne: "1 minute",
    seconds: "{n} seconds",
    secondsOne: "1 second",
  },
  languages: { "pt-BR": "Português (Brasil)", en: "English" },
  ...palette,
  time: {
    now: "just now",
    ago: "{d} ago",
    agoDay: "1 day ago",
    agoDays: "{n} days ago",
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
    plainWaiting: {
      one: "Flightdeck: {n} task waiting for your answer ({hosts})",
      other: "Flightdeck: {n} tasks waiting for your answer ({hosts})",
    },
    autoApproved: {
      one: "{n} automatic approval",
      other: "{n} automatic approvals",
    },
  },
  ...notifications,
  ...account,
  errors: {
    bad_request: "The host refused the request.",
    unauthorized:
      "The host refused the token: pair again with the host's new link (flightdeckd pair).",
    not_found: "Not found on the host.",
    invalid_state: "That can't be done right now.",
    contract_unmet: "The card does not meet what that column asks for.",
    forbidden_cwd:
      "The folder is outside the host's allowed folders. Add it with flightdeckd setup or in allowedRoots, in ~/.flightdeck/config.json.",
    protocol_incompatible:
      "The host's version doesn't work with this app: update the host and the app to the same version.",
    internal: "Internal error on the host: check the daemon's log; Details carry its message.",
    invalid_permission_update: "That permission rule isn't accepted.",
    update_verification_failed: "The update failed verification.",
    update_needs_service: "To update, the host has to run as a service.",
    offline:
      "The host is offline: check that the daemon runs there (flightdeckd start) and that the network reaches its address.",
    timeout:
      "The host didn't answer in time: try again; if it repeats, check the network and the daemon.",
    file_conflict: "The file changed on disk after it was opened.",
    terminal_disabled:
      "The terminal is off on this host: turn it on in the host's settings, then try again.",
    hostkey_unconfirmed:
      "This server's key was never confirmed: check its fingerprint, then confirm it to connect.",
    hostkey_changed:
      "The server's key changed since you confirmed it: check with whoever runs it; if the change is expected, forget the saved key and confirm the new one.",
    snippet_untrusted:
      "This command comes from the project's snippets file, which is not trusted yet: trust the file to run it, or paste without Enter.",
    persona_secret: "A persona can't contain a secret: keep it in the vault instead.",
    persona_untrusted:
      "This persona comes from the project and changes the agent's behavior: trust it before using it.",
    snippet_secret:
      "A snippet can't contain a secret: keep it in the vault instead, or turn it into an action.",
    unknown:
      "The host reported an error the app does not know. Try again; if it repeats, check the daemon's log.",
  },
  ...automations,
  ...watch,
  ...refusals,
  ...assistant,
  common: {
    cancel: "Cancel",
    close: "Close",
    /** A wide table's frame (#641): it scrolls sideways by itself. */
    scrollsSideways: "{name}, scrolls sideways",
  },
  toolCall: {
    waiting: "waiting for the result…",
  },
  whatsNew: {
    title: "What's new",
    description: "The highlights of the latest releases of Flightdeck.",
    loading: "Reading the release notes…",
    releases: "Releases",
    noHighlights: "No highlights for this release.",
    none: "No connected host can read the release notes yet: connect a host with a recent daemon, or open the releases page.",
    retry: "Try again",
    viewAll: "View all releases",
    open: "On GitHub",
    openRelease: "Open {title} on GitHub",
    close: "Close",
  },
  alwaysAllow: {
    rule: "Rule",
    saveRule: "Save rule",
    session: "Allow for this session",
    project: "Always in this project",
    refusedFolder:
      "That rule names a folder, or a path that is not there yet, so it would cover everything below it ({tool}). Name one file.",
  },
  modes: {
    option: "{name}: {description}",
    default: {
      name: "Default",
      description: "asks before acting",
      explain: "Asks before it edits files or runs commands",
    },
    acceptEdits: {
      name: "Accept edits",
      description: "edits files without asking",
      explain: "Edits files without asking; still asks before running commands",
    },
    plan: {
      name: "Plan",
      description: "only reads and proposes a plan",
      explain: "Only reads and proposes a plan; changes nothing",
    },
    auto: {
      name: "Automatic",
      description: "a classifier decides what goes on",
      explain: "A classifier decides what goes on",
    },
    dontAsk: {
      name: "Allowed only",
      description: "denies what the rules do not allow",
      explain: "Denies what the rules do not allow",
    },
    bypassPermissions: {
      name: "Bypass permissions",
      description: "no prompts",
      explain: "Runs everything without asking. Only in a folder you can throw away",
    },
    bypassWarning:
      "Bypass permissions: Claude runs everything without asking for approval. Use it only in a folder you can throw away.",
  },
  ...changes,
  status: {
    starting: "starting",
    running: "running",
    awaiting_permission: "waiting for you",
    idle: "idle",
    ended: "ended",
    error: "error",
  },
  ...terminal,
  ...telemetry,
  bg: {
    region: "Background session",
    state: {
      working: "working",
      blocked: "waiting for you",
      done: "done",
      failed: "failed",
      stopped: "stopped",
    },
    waitingFor: "waiting for: {what}",
    cost: "cost {cost}",
    stop: "Stop",
    respawn: "Restart",
    attach: "Bring to the terminal",
    message: "Message",
    send: "Send",
    start: "Start in the background",
    startHint:
      "The session runs with no terminal, with Flightdeck's channel, and shows up in Sessions.",
    note: "Claude Code background sessions (claude --bg).",
  },
  ...clients,
  conversationsUi: {
    title: "Conversations",
    subtitle: "Messages between sessions, on every host",
    list: "Messages between sessions",
    filter: "Filter messages",
    status: "State",
    any: "Any",
    empty: "No messages",
    emptyHint:
      "Messages between sessions show up here once sessions can message each other, for example in a team.",
    emptyLink: "Open Teams",
    noMatch: "No message matches the filter.",
    loading: "Loading messages",
    to: "to",
    open: "Open the session",
    statuses: {
      pending: "Pending",
      delivered: "Delivered",
      queued: "Queued",
      refused: "Refused",
      expired: "Expired",
    },
  },
  deps: {
    blocked: "Blocked · {count}",
    blockedTip: "Waiting for: {titles}",
    blocking: "Blocking {count}",
    blockingTip: "Holding up: {titles}",
    unblocked: "Unblocked",
    filter: "Blocked",
    title: "Blocked by",
    blockingTitle: "Blocking",
    none: "Nothing blocks this card.",
    noneToPick: "No other card can block this one.",
    pickFirst: "Choose the card it waits for first.",
    pick: "Choose a card…",
    addLabel: "Add a blocker",
    add: "Add",
    remove: "Remove blocker {title}",
    whenLabel: "A blocker is satisfied when it is",
    when: { done: "in Done", merged: "merged" },
    autoStart: "Start by itself when unblocked",
    workflowLabel: "Auto-start workflow",
    noWorkflow: "No workflow",
    more: "and {count} more",
    dismiss: "Dismiss notice",
    unblockedNotice: "Every blocker is done: the card can start.",
    notifyTitle: "Card unblocked",
    notifyBody: "{title}: every blocker is done.",
    satisfied: "done",
  },
  postMortem: {
    open: "Draft a post-mortem",
    title: "Draft a post-mortem",
    intro:
      "A new card will write a post-mortem of this one as a Markdown file and ask before it opens a pull request. Check what it will be told about the incident, and edit it.",
    loading: "Reading the session",
    field: "Incident",
    missing:
      "The Post-mortem draft workflow is not set up in this project. Add it from Workflows, Templates, then try again.",
    start: "Start the post-mortem",
    cardTitle: "Post-mortem: {title}",
    started: "Post-mortem started: {title}",
    notStarted:
      'The card "{title}" was made but did not start. Press Start to try again; it will not make another.',
  },
  ...shortcuts,
  historyUi: {
    title: "History of {host}",
    folder: "Folder",
    project: "Project: {name}",
    clearProject: "Clear project",
    from: "From",
    to: "To",
    origin: "Origin",
    allOrigins: "All origins",
    flightdeck: "Flightdeck",
    external: "External",
    externalTag: "external",
    filter: "Filter",
    hideAutomated: "Hide automated runs",
    automatedHidden: "{count} automated runs hidden",
    emptyAutomated: "{count} automated runs are hidden by the filter.",
    emptyFiltered: "No session matches these filters.",
    clearFilters: "Clear the filters",
    showAutomated: "Show them",
    automatedTag: "automated",
    list: "History sessions",
  },
  ...plugins,
  quotaCharts: {
    window: "{label} window",
    utilization: "Utilization of the {label} window",
    consumers: "Who used the 5-hour window",
    attribution: "approximate attribution: the plan does not say who used it",
    title: "Quota",
  },
  prefs: {
    title: "Settings",
    appearance: "Appearance",
    window: "Window",
    notifications: "Notifications",
    closeToTray: "Closing the window sends it to the tray",
    autostart: "Start with Windows",
    unavailable: "unavailable on this platform",
    updates: "Updates",
    notifyUpdates: "Notify about updates",
    autoUpdate: "Update automatically",
    checkNow: "Check for updates now",
    upToDate: "You are on the latest version",
    shortcut: "Global shortcut",
    shortcutNote:
      "Brings Flightdeck to the front with the search open, even in the background. Inside the app, Ctrl+K still opens the search.",
    saveShortcut: "Save shortcut",
    shortcutUnchanged: "Nothing changed",
    shortcutUnavailable: "global shortcut unavailable on this platform",
  },
  ...agent,
  messages: {
    shortcutTaken:
      "The shortcut {accelerator} could not be registered: another program probably uses it. Choose another.",
    terminalFailed:
      "The terminal did not open: {error}. Use Copy command and paste it into your terminal.",
    updateCheckFailed:
      "could not check for updates: {error}. Check the network and try again in Settings.",
    updateDownloadFailed:
      "The new version did not download: {error}. It is tried again at the next check, or install it from Settings.",
    updateInstallFailed:
      "The update was not installed: {error}. Try again; if it repeats, download the new version's installer.",
    daemonUpdateLate: "the daemon did not come back on version {version} in time",
    budgetTitle: "Budget",
    budgetBody: "{host}: {label} at {percent}% of {limit}",
    budgetBodyQuota: "{host}: {label} at {percent}% of its {limit} of the plan{estimate}",
    tokenRefused: "token refused: copy the host's new link (flightdeckd pair) and paste it again.",
    cannotConnect:
      "could not connect: check the address and that the daemon is running (flightdeckd start); if that does not fix it, run flightdeckd doctor.",
    shortcutFormat: "expected format: Modifiers+Key, for example Ctrl+Alt+F",
    shortcutModifier: "use at least Ctrl, Alt or Super",
    shortcutReserved: "Ctrl+K opens the search inside the app; choose another shortcut",
  },
};
