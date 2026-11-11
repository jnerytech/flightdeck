/** The first-run screens: the empty start, the welcome and the setup. */
export const firstrun = {
  start: {
    title: "Nothing open",
    addHost: "Add a host",
    subtitle: "Pick a screen in the sidebar, or begin here.",
    recent: "Recent sessions",
    shortcuts: "Shortcuts",
    shortcut: {
      search: "Search",
      newTab: "New tab",
      reopen: "Reopen the closed tab",
      split: "Split the window",
    },
  },
  welcome: {
    /** The first-run screen's title, and the Add host screen's once a host exists (#728). */
    title: "Connect your first host",
    titleMore: "Add a host",
    /** The first-run screen's tab and header crumb (#1551). */
    crumb: "Connect a host",
    addHost: "Add a host with the flightdeckd address and token.",
    stepsLabel: "First steps",
    step1: "On the computer that runs Claude Code, install and start the daemon:",
    step2: "Copy the pairing link it prints at the end (it also shows a QR code).",
    step3: "Paste the link below and press Test and add.",
    step4:
      "Done: the app opens the host page, where you check the host and choose the project folders.",
    trouble:
      "Not connecting? On that computer run the command below: it says what is missing and how to fix it.",
    copy: "Copy {command}",
  },
  setup: {
    title: "Setup",
    row: "Setup, {done} of {total} steps done",
    count: "{done}/{total}",
    ring: "{done} of {total} steps done",
    hide: "Hide the setup checklist",
    subtitle:
      "What is set up and what is not, read from your hosts and the app. Nothing here is ticked by hand.",
    core: "To get going",
    optional: "Worth doing",
    allDone: "Everything to get going is done. The checklist leaves the sidebar by itself.",
    done: "Done",
    todo: "To do",
    go: "Open",
    restore: "Show the setup checklist",
    step: {
      host: {
        title: "Connect a host",
        text: "A host is a machine that runs flightdeckd. Add one to see its sessions.",
        action: "Add a host",
      },
      hooks: {
        title: "Install the Claude Code hooks",
        text: "The hooks let a session you start in a terminal be seen and approved here.",
        action: "Open the host",
      },
      project: {
        title: "Add a project",
        text: "A project is a folder with a git repository and a base branch. Cards and workflows live in it.",
        action: "Add a project",
      },
      session: {
        title: "Start a first session or card",
        text: "Start a session in a project, or a card on its board.",
        action: "New session",
      },
      github: {
        title: "Sign in to GitHub on the host",
        text: "With the host's gh signed in, pull requests and issues work.",
        action: "Open the host",
      },
      notifications: {
        title: "Check that notifications work",
        text: "Send a test notification and see it appear.",
        action: "Open Settings",
      },
      budget: {
        title: "Set a budget",
        text: "A limit warns you before a project or a host spends more than you meant to.",
        action: "Open Settings",
      },
      worktreeinclude: {
        title: "Add a .worktreeinclude to a project",
        text: "It lists the untracked files (such as .env) that a card's worktree should receive.",
        action: "Open projects",
      },
    },
    tools: {
      title: "{tool} is missing on {host}",
      text: "Some features need it.",
      fix: "How to install it",
      dismiss: "Dismiss",
    },
  },
};
