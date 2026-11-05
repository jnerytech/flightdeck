import type { T } from "../i18n/index.ts";
import { type AppState, sessionKey } from "./app-store.ts";
import { ALL_CLIENTS, selectedClient, tagsFirst } from "./client-scope.ts";
import { UNASSIGNED } from "./clients.ts";
import type { AppSnippet } from "./global-snippets.ts";
import { hostStatusView } from "./host-status.ts";
import { basename, isInside } from "./paths.ts";
import type { Route } from "./router.ts";
import { keysLabel, type ShortcutAction, shortcutOf } from "./shortcuts.ts";
import type { TerminalTarget } from "./terminal.ts";
import { hasFeature } from "./version.ts";

/** Where an entry of the Ctrl+K palette leads. */
export type PaletteTarget =
  | { kind: "session"; hostId: string; sessionId: string }
  | { kind: "external"; hostId: string; claudeSessionId: string }
  | { kind: "card"; hostId: string; projectId: string; cardId: string }
  | { kind: "board"; hostId: string; projectId: string }
  | { kind: "workflows"; hostId: string; projectId: string; name: string }
  | { kind: "host"; hostId: string }
  | { kind: "projects"; hostId: string }
  /** `persona`: a picker value (`host:<id>`) to open the form with (phase 20). */
  | { kind: "new-session"; hostId: string; persona?: string }
  | { kind: "terminal"; hostId: string; target: TerminalTarget }
  /** A new embedded terminal (phase 14), in a new tab. */
  | { kind: "new-terminal"; hostId: string }
  | { kind: "settings" }
  | { kind: "toggle-theme" }
  | { kind: "switch-language" }
  | { kind: "start-card"; hostId: string; cardId: string }
  | { kind: "costs" }
  /** A screen with no host: Sessions, Needs you or the Projects overview. */
  | { kind: "go"; to: "hub" | "needs-you" | "all-projects" }
  /** The `?` sheet of shortcuts. */
  | { kind: "shortcuts" }
  /** Answers the oldest request waiting for the person (a high-risk one is opened instead). */
  | { kind: "decide-oldest"; decision: "approve" | "deny" }
  /** Phase 29: the Clients screen, and a switch of the client the screens show. */
  | { kind: "clients" }
  | { kind: "switch-client"; clientId: string }
  | { kind: "connect-ssh"; hostId: string; targetId: string }
  /** A snippet to fill and use: a host's, or a global one of the app (`hostId` null). */
  | { kind: "snippet"; hostId: string | null; snippetId: string }
  /** Issue #147: a card made from the text typed in the palette. */
  | { kind: "create-card"; hostId: string; projectId: string; title: string }
  /** A card made from an issue: `ref` when the text names the issue fully, else its `id` in the project. */
  | { kind: "create-card-issue"; hostId: string; projectId: string; ref?: string; id?: string }
  /** A pasted PR link (phase 22): the hosts that watch PRs are asked which card or session it is. */
  | { kind: "pull-link"; url: string };

export interface PaletteAction {
  label: string;
  target: PaletteTarget;
}

export interface PaletteItem {
  /** Unique within the palette. */
  id: string;
  label: string;
  detail: string;
  /** Enter. */
  target: PaletteTarget;
  /** Tab: what else can be done with it. */
  actions: PaletteAction[];
  /** The keys that do the same, as the sheet shows them (`g p`, `?`). */
  shortcut?: string;
  /** More text the query also matches, besides the label (a snippet's tags and content). */
  keywords?: string;
  /** A session's state, for its glyph: the key of `hub.stateDots`. */
  stateKey?: "running" | "needs_you" | "idle";
  /** The host and the project the entry belongs to, for the scope chips. */
  hostId?: string;
  projectId?: string;
}

export interface PaletteSection {
  title: string;
  items: PaletteItem[];
  /** The recent entries: they take Alt+1 to Alt+6. */
  recent?: true;
}

/** The host and project the palette is narrowed to; both null is no scope. */
export interface PaletteScope {
  hostId: string | null;
  projectId: string | null;
}

/** The scope the palette opens with: where the person is (a board or card: its project; else its host). */
export function paletteScope(route: Route, state: AppState): PaletteScope {
  if (route.name === "board" || route.name === "card") {
    return { hostId: route.host, projectId: route.projectId };
  }
  const hostId = "host" in route && typeof route.host === "string" ? route.host : null;
  return { hostId: state.hosts.some((h) => h.id === hostId) ? hostId : null, projectId: null };
}

/** A PR link of Azure DevOps (`/pullrequest/<n>`) or GitHub (`/pull/<n>`). */
const PR_LINK = /^https?:\/\/\S+\/(?:pullrequest|pull)\/\d+(?:[/?#]\S*)?$/;

/** How many recent entries the palette shows. */
const RECENTS_SHOWN = 6;

const LIVE: ReadonlySet<string> = new Set(["starting", "running", "awaiting_permission", "idle"]);

/** The state a session's status shows as, for its glyph: Idle covers whatever is not running or waiting. */
const stateOf = (status: string): NonNullable<PaletteItem["stateKey"]> =>
  status === "awaiting_permission"
    ? "needs_you"
    : status === "running" || status === "starting"
      ? "running"
      : "idle";

/** How soon a recent entry is wanted: what waits for you, then what runs, then the rest. */
const RANK = { needs_you: 0, running: 1, idle: 2 } as const;

const GITHUB_ISSUE = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)(?:[/?#]\S*)?$/;

/** Where "Create card" puts the card: the scope's project, else the only project there is. */
function createPlace(state: AppState, scope: PaletteScope | undefined) {
  const online = state.hosts.filter((h) => h.status === "online");
  const hosts = scope?.hostId ? online.filter((h) => h.id === scope.hostId) : online;
  const places = hosts.flatMap((host) =>
    (state.projects[host.id] ?? [])
      .filter((project) => !scope?.projectId || project.id === scope.projectId)
      .map((project) => ({ host, project })),
  );
  return places.length === 1 ? (places[0] ?? null) : null;
}

/**
 * The palette's local sections, in order, filtered by `query` (on the label): live sessions,
 * cards, projects, hosts and actions. Empty sections are left out; the history comes from the
 * global search. `costs`: the app has a Custos screen and some host announces it.
 */
export function paletteSections(
  state: AppState,
  query: string,
  options: {
    costs: boolean;
    t: T;
    globalSnippets?: AppSnippet[];
    recents?: string[];
    /** A request waits for the person: the approve and deny commands show. */
    waiting?: boolean;
    /** Only what belongs to this host and project (actions, which belong to none, stay). */
    scope?: PaletteScope;
    /** The recents are already in the order to show (the palette froze it when it opened). */
    keepRecentOrder?: boolean;
  },
): PaletteSection[] {
  const { t } = options;
  const online = state.hosts.filter((h) => h.status === "online");
  const terminal = (hostId: string, target: TerminalTarget): PaletteAction => ({
    label: t("palette.openTerminal"),
    target: { kind: "terminal", hostId, target },
  });

  const projectOf = (hostId: string, cwd: string | null | undefined) =>
    cwd ? (state.projects[hostId] ?? []).find((p) => isInside(cwd, p.path))?.id : undefined;
  const sessions = online.flatMap((host) => {
    // Phase 21: the standard names of the host; an alias addresses its session here too.
    const names = new Map((state.names?.[host.id] ?? []).map((n) => [n.sessionId, n]));
    const keywords = (id: string) => names.get(id)?.aliases.join(" ");
    return [
      ...host.sessions
        .filter((s) => LIVE.has(s.status))
        .map((s): PaletteItem => {
          const target: PaletteTarget = { kind: "session", hostId: host.id, sessionId: s.id };
          const claudeSessionId =
            state.sessions[sessionKey(host.id, s.id)]?.claudeSessionId ??
            state.hub[host.id]?.managed.find((m) => m.id === s.id)?.claudeSessionId;
          return {
            id: `session:${host.id}/${s.id}`,
            label: s.name ?? names.get(s.id)?.display ?? basename(s.cwd),
            detail: `${host.name} · ${s.cwd}`,
            target,
            stateKey: stateOf(s.status),
            hostId: host.id,
            projectId: projectOf(host.id, s.cwd),
            ...(names.has(s.id) ? { keywords: keywords(s.id) } : {}),
            actions: [
              { label: t("palette.open"), target },
              ...(claudeSessionId ? [terminal(host.id, { cwd: s.cwd, claudeSessionId })] : []),
            ],
          };
        }),
      ...Object.entries(state.externals)
        .filter(([key, s]) => key.startsWith(`${host.id}/`) && s.status !== "ended")
        .map(([key, s]): PaletteItem => {
          const id = s.claudeSessionId;
          const target: PaletteTarget = { kind: "external", hostId: host.id, claudeSessionId: id };
          return {
            id: `external:${key}`,
            label: state.meta[key]?.name ?? names.get(id)?.display ?? basename(s.cwd ?? id),
            detail: `${host.name} · ${t("palette.terminalDetail")}`,
            target,
            stateKey: stateOf(s.status),
            hostId: host.id,
            projectId: projectOf(host.id, s.cwd),
            ...(names.has(id) ? { keywords: keywords(id) } : {}),
            actions: [
              { label: t("palette.open"), target },
              ...(s.cwd ? [terminal(host.id, { cwd: s.cwd, claudeSessionId: id })] : []),
            ],
          };
        }),
    ];
  });

  const cards = online.flatMap((host) =>
    Object.entries(state.cards)
      .filter(([key]) => key.startsWith(`${host.id}/`))
      .map(([key, card]): PaletteItem => {
        const target: PaletteTarget = {
          kind: "card",
          hostId: host.id,
          projectId: card.projectId,
          cardId: card.id,
        };
        // Its terminal is on the card's screen, next to its worktree.
        return {
          id: `card:${key}`,
          label: card.title,
          detail: `${host.name} · ${t("palette.cardDetail")}`,
          target,
          hostId: host.id,
          projectId: card.projectId,
          actions: [
            { label: t("palette.open"), target },
            {
              label: t("palette.startCard"),
              target: { kind: "start-card", hostId: host.id, cardId: card.id },
            },
          ],
        };
      }),
  );

  const projects = online.flatMap((host) =>
    (state.projects[host.id] ?? []).map((project): PaletteItem => {
      const board: PaletteTarget = { kind: "board", hostId: host.id, projectId: project.id };
      return {
        id: `project:${host.id}/${project.id}`,
        label: project.name,
        detail: `${host.name} · ${project.path}`,
        target: board,
        hostId: host.id,
        projectId: project.id,
        actions: [
          { label: t("palette.openBoard"), target: board },
          {
            label: t("palette.workflows"),
            target: {
              kind: "workflows",
              hostId: host.id,
              projectId: project.id,
              name: project.name,
            },
          },
          terminal(host.id, { cwd: project.path, claudeSessionId: null }),
        ],
      };
    }),
  );

  const hosts = state.hosts
    .filter((h) => h.status !== "incompatible")
    .map((host): PaletteItem => {
      const page: PaletteTarget = { kind: "host", hostId: host.id };
      return {
        id: `host:${host.id}`,
        label: host.name,
        detail: hostStatusView(host.status, t).label,
        target: page,
        hostId: host.id,
        actions: [
          { label: t("palette.openHost"), target: page },
          { label: t("palette.newSession"), target: { kind: "new-session", hostId: host.id } },
          { label: t("palette.projects"), target: { kind: "projects", hostId: host.id } },
        ],
      };
    });

  const action = (
    id: string,
    label: string,
    target: PaletteTarget,
    detail = t("palette.actionDetail"),
    shortcut?: ShortcutAction | string,
  ): PaletteItem => {
    // A registry action shows its keys; the approve and deny commands show their one key.
    const keys = shortcut
      ? (() => {
          const def = shortcutOf(shortcut as ShortcutAction);
          return def ? keysLabel(def, false) : shortcut;
        })()
      : undefined;
    return { id, label, detail, target, actions: [], ...(keys ? { shortcut: keys } : {}) };
  };
  const waiting = options.waiting === true;
  const actions = [
    ...online.map((host) =>
      action(`new:${host.id}`, t("palette.newSessionIn", { host: host.name }), {
        kind: "new-session",
        hostId: host.id,
      }),
    ),
    ...online.flatMap((host) =>
      (state.personas?.[host.id] ?? []).map((persona) =>
        action(
          `new-as:${host.id}/${persona.id}`,
          t("palette.newSessionAs", { persona: persona.name }),
          { kind: "new-session", hostId: host.id, persona: `host:${persona.id}` },
        ),
      ),
    ),
    ...online
      .filter((host) => hasFeature(host.hostInfo?.features, "terminal", false))
      .map((host) =>
        action(`terminal:${host.id}`, t("palette.newTerminalIn", { host: host.name }), {
          kind: "new-terminal",
          hostId: host.id,
        }),
      ),
    action("go:hub", t("palette.goSessions"), { kind: "go", to: "hub" }, undefined, "go-sessions"),
    action(
      "go:needs-you",
      t("palette.goNeedsYou"),
      { kind: "go", to: "needs-you" },
      undefined,
      "go-needs-you",
    ),
    action(
      "go:all-projects",
      t("palette.goProjects"),
      { kind: "go", to: "all-projects" },
      undefined,
      "go-projects",
    ),
    ...(waiting
      ? [
          action(
            "decide:approve",
            t("palette.approveOldest"),
            { kind: "decide-oldest", decision: "approve" },
            undefined,
            "A",
          ),
          action(
            "decide:deny",
            t("palette.denyOldest"),
            { kind: "decide-oldest", decision: "deny" },
            undefined,
            "N",
          ),
        ]
      : []),
    action("theme", t("palette.toggleTheme"), { kind: "toggle-theme" }),
    action("language", t("palette.switchLanguage"), { kind: "switch-language" }),
    ...(options.costs
      ? [action("costs", t("palette.goCosts"), { kind: "costs" }, undefined, "go-costs")]
      : []),
    action("settings", t("palette.goSettings"), { kind: "settings" }, undefined, "go-settings"),
    action("shortcuts", t("palette.showShortcuts"), { kind: "shortcuts" }, undefined, "help"),
    action("clients", t("clients.manageShort"), { kind: "clients" }),
    ...((state.clientList ?? []).length === 0
      ? []
      : [
          action("client:all", t("clients.switchTo", { name: t("clients.allClients") }), {
            kind: "switch-client",
            clientId: ALL_CLIENTS,
          }),
          ...(state.clientList ?? []).map((client) =>
            action(`client:${client.id}`, t("clients.switchTo", { name: client.name }), {
              kind: "switch-client",
              clientId: client.id,
            }),
          ),
          action("client:unassigned", t("clients.switchTo", { name: t("clients.unassigned") }), {
            kind: "switch-client",
            clientId: UNASSIGNED,
          }),
        ]),
  ];

  const connections = online.flatMap((host) =>
    (state.ssh[host.id] ?? []).map((target): PaletteItem => {
      const connect: PaletteTarget = { kind: "connect-ssh", hostId: host.id, targetId: target.id };
      return {
        id: `ssh:${host.id}/${target.id}`,
        label: t("palette.connectTo", { name: target.name }),
        detail: `${target.user}@${target.host} · ${host.name}`,
        target: connect,
        hostId: host.id,
        actions: [{ label: t("palette.connect"), target: connect }],
      };
    }),
  );

  const snippetItem = (snippet: AppSnippet, hostId: string | null, where: string): PaletteItem => {
    const target: PaletteTarget = { kind: "snippet", hostId, snippetId: snippet.id };
    return {
      id: `snippet:${hostId ?? "global"}/${snippet.id}`,
      label: t("palette.snippet", { name: snippet.name }),
      detail: t("palette.snippetDetail", { type: t(`snippets.kind.${snippet.type}`), where }),
      target,
      actions: [{ label: t("palette.useSnippet"), target }],
      keywords: [...snippet.tags, snippet.run ?? snippet.text ?? ""].join("\n"),
    };
  };
  // The selected client's snippets (those with its tag) come first (phase 29).
  const clientTag = selectedClient(state.clientList ?? [], state.clientSelection)?.defaults
    .snippetTag;
  const snippets = tagsFirst(
    [
      ...online.flatMap((host) =>
        (state.snippets?.[host.id] ?? []).map((s) => ({
          tags: s.tags,
          item: snippetItem(s, host.id, host.name),
        })),
      ),
      ...(options.globalSnippets ?? []).map((s) => ({
        tags: s.tags,
        item: snippetItem(s, null, t("snippets.origin.global")),
      })),
    ],
    clientTag,
  ).map(({ item }) => item);

  const needle = query.trim().toLowerCase();
  const matches = (item: PaletteItem) =>
    item.label.toLowerCase().includes(needle) ||
    (item.keywords?.toLowerCase().includes(needle) ?? false);
  const link = query.trim();
  const prLink: PaletteItem[] =
    PR_LINK.test(link) && online.some((h) => hasFeature(h.hostInfo?.features, "watch", false))
      ? [action(`pr-link:${link}`, t("palette.openPrLink"), { kind: "pull-link", url: link }, link)]
      : [];
  const scope = options.scope;
  /** What is not tied to a host or a project (the actions) stays whatever the scope. */
  const inScope = (item: PaletteItem) =>
    (!scope?.hostId || item.hostId === undefined || item.hostId === scope.hostId) &&
    (!scope?.projectId || !("projectId" in item) || item.projectId === scope.projectId);
  const filtered = [
    { title: t("palette.sectionSessions"), items: sessions },
    { title: t("palette.sectionCards"), items: cards },
    { title: t("palette.sectionProjects"), items: projects },
    { title: t("palette.sectionHosts"), items: hosts },
    { title: t("palette.sectionConnections"), items: connections },
    { title: t("palette.sectionSnippets"), items: snippets },
    { title: t("palette.sectionActions"), items: actions },
  ].map((section) => ({ ...section, items: section.items.filter(inScope).filter(matches) }));
  // With nothing typed, what was used lately comes first (an entry that is gone is dropped).
  const everything = filtered.flatMap((section) => section.items);
  const used =
    needle === ""
      ? (options.recents ?? []).flatMap((id) => everything.find((item) => item.id === id) ?? [])
      : [];
  // What waits for you comes first, then what runs; the palette freezes the order once it is open.
  const ranked = options.keepRecentOrder
    ? used
    : used
        .map((item, i) => ({ item, i }))
        .sort(
          (a, b) => RANK[a.item.stateKey ?? "idle"] - RANK[b.item.stateKey ?? "idle"] || a.i - b.i,
        )
        .map(({ item }) => item);
  const recent = ranked.slice(0, RECENTS_SHOWN);
  // Text that matches no card can become one (or an issue's card); it is the last thing offered.
  const create = (): PaletteItem[] => {
    const text = query.trim();
    const place = createPlace(state, scope);
    if (text === "" || !place || filtered[1]?.items.length) return [];
    const { host, project } = place;
    const where = { hostId: host.id, projectId: project.id };
    const issues =
      project.issues !== null &&
      project.issues !== undefined &&
      hasFeature(host.hostInfo?.features, "issues", false);
    const url = GITHUB_ISSUE.exec(text);
    const number = /^#(\d+)$/.exec(text);
    const fromIssue = (issue: string, target: Partial<PaletteTarget>): PaletteItem => ({
      id: "create:issue",
      label: t("palette.createCardIssue", { issue, project: project.name }),
      detail: t("palette.createDetail"),
      target: { kind: "create-card-issue", ...where, ...target } as PaletteTarget,
      actions: [],
      ...where,
    });
    if (issues && url) {
      return [
        fromIssue(`${url[1]}/${url[2]}#${url[3]}`, { ref: `github:${url[1]}/${url[2]}#${url[3]}` }),
      ];
    }
    if (issues && number) return [fromIssue(text, { id: number[1] as string })];
    return [
      {
        id: "create:card",
        label: t("palette.createCard", { title: text, project: project.name }),
        detail: t("palette.createDetail"),
        target: { kind: "create-card", ...where, title: text },
        actions: [],
        ...where,
      },
    ];
  };
  // The link is the query itself, so it is not filtered by it.
  return [
    { title: t("palette.sectionLink"), items: prLink },
    { title: t("palette.sectionRecent"), items: recent, recent: true as const },
    ...filtered,
    { title: t("palette.sectionCreate"), items: create() },
  ].filter((section) => section.items.length > 0);
}
