import { ALL_CLIENTS, UNASSIGNED } from "@/features/clients/index.ts";
import type { T } from "../../../i18n/index.ts";
import type { AppState } from "../../../lib/app-store.ts";
import { anyHostHas, hasFeature } from "../../../lib/version.ts";
import { type SessionViewName as SessionView, VIEW_LABEL } from "../../sessions/index.ts";
import { keysLabel, type ShortcutAction, shortcutOf } from "../../shortcuts/index.ts";
import type { AppSnippet } from "../../snippets/index.ts";
import { entityItems } from "./palette-entities.ts";
import type { PaletteItem, PaletteScope, PaletteSection, PaletteTarget } from "./palette-types.ts";

export type {
  PaletteAction,
  PaletteItem,
  PaletteScope,
  PaletteSection,
  PaletteTarget,
} from "./palette-types.ts";
export { paletteScope } from "./palette-types.ts";

/** A PR link of Azure DevOps (`/pullrequest/<n>`) or GitHub (`/pull/<n>`). */
const PR_LINK = /^https?:\/\/\S+\/(?:pullrequest|pull)\/\d+(?:[/?#]\S*)?$/;

/** How many recent entries the palette shows. */
const RECENTS_SHOWN = 6;

/** How soon a recent entry is wanted: what waits for you, then what runs, then the rest. */
const RANK = { needs_you: 0, running: 1, idle: 2 } as const;

const GITHUB_ISSUE = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)(?:[/?#]\S*)?$/;

/** The most of a task a palette row shows; the prompt itself is never cut. */
const SHOWN = 48;
const shortened = (text: string) =>
  text.length > SHOWN ? `${text.slice(0, SHOWN).trimEnd()}…` : text;

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
    /**
     * The oldest request waiting for the person, as one line, and whether it must be opened to be
     * answered: the approve and deny commands (or Open) show and name it.
     */
    oldest?: { text: string; opens: boolean; key: string };
    /** The mode the window could switch to (none when the host is locked). */
    modeSwitch?: "simple" | "full" | null;
    /** Issue #107: the views of the session page on screen; none off such a page. */
    views?: readonly SessionView[];
    /** Only what belongs to this host and project (actions, which belong to none, stay). */
    scope?: PaletteScope;
    /** The recents are already in the order to show (the palette froze it when it opened). */
    keepRecentOrder?: boolean;
  },
): PaletteSection[] {
  const { t } = options;
  const online = state.hosts.filter((h) => h.status === "online");
  const { sessions, cards, projects, hosts, connections, snippets } = entityItems(
    state,
    t,
    options.globalSnippets,
  );

  const action = (
    id: string,
    label: string,
    target: PaletteTarget,
    detail = t("palette.actionDetail"),
    shortcut?: string,
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
  const oldest = options.oldest;
  const decideActions = () => {
    if (!oldest) return [];
    if (oldest.opens) {
      return [
        action("decide:open", t("palette.openOldest", { what: oldest.text }), {
          kind: "decide-oldest",
          decision: "approve",
          key: oldest.key,
        }),
      ];
    }
    return [
      action(
        "decide:approve",
        t("palette.approveOldest", { what: oldest.text }),
        { kind: "decide-oldest", decision: "approve", key: oldest.key },
        undefined,
        "A",
      ),
      action(
        "decide:deny",
        t("palette.denyOldest", { what: oldest.text }),
        { kind: "decide-oldest", decision: "deny", key: oldest.key },
        undefined,
        "N",
      ),
    ];
  };
  const oldestActions = decideActions();
  const actions = [
    // First: the view of the page on screen is what the person is most likely to want from here.
    ...(options.views ?? []).map((view, i) =>
      action(
        `view:${view}`,
        t("palette.showView", { view: t(VIEW_LABEL[view]) }),
        { kind: "session-view", view },
        undefined,
        `Alt+${i + 1}`,
      ),
    ),
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
    ...oldestActions,
    action("theme", t("palette.toggleTheme"), { kind: "toggle-theme" }),
    ...(options.modeSwitch
      ? [
          action(
            "ui-mode",
            t(options.modeSwitch === "simple" ? "palette.switchToSimple" : "palette.switchToFull"),
            { kind: "toggle-ui-mode" },
            undefined,
            "toggle-mode",
          ),
        ]
      : []),
    action("language", t("palette.switchLanguage"), { kind: "switch-language" }),
    ...(options.costs
      ? [action("costs", t("palette.goCosts"), { kind: "costs" }, undefined, "go-costs")]
      : []),
    action("settings", t("palette.goSettings"), { kind: "settings" }, undefined, "go-settings"),
    action("add-host", t("palette.addHost"), { kind: "add-host" }),
    action("shortcuts", t("palette.showShortcuts"), { kind: "shortcuts" }, undefined, "help"),
    // Last: the actions section shows eight, and the commands above are the ones used most.
    action(
      "go:activity",
      t("palette.goActivity"),
      { kind: "go", to: "activity" },
      undefined,
      "go-activity",
    ),
    action("go:pull-requests", t("palette.goPullRequests"), { kind: "go", to: "pull-requests" }),
  ];

  // The clients have a section of their own, shown whole: one switches between all of them (#147).
  const clients: PaletteItem[] = [
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

  const needle = query.trim().toLowerCase();
  const matches = (item: PaletteItem) =>
    item.label.toLowerCase().includes(needle) ||
    (item.keywords?.toLowerCase().includes(needle) ?? false);
  const link = query.trim();
  const prLink: PaletteItem[] =
    PR_LINK.test(link) && anyHostHas(online, "watch")
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
    { title: t("palette.sectionClients"), items: clients, uncapped: true as const },
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
  // Issue #1135: any text can also be the task of a session started in the project's folder.
  const start = (): PaletteItem[] => {
    const text = query.trim();
    const place = createPlace(state, scope);
    if (text === "" || !place) return [];
    // A sentence is a task. One word that finds a row is a search, and a lone issue number or link
    // is for Create card.
    const sentence = /\s/.test(text);
    const searching = filtered.some((section) => section.items.length > 0);
    if (!sentence && (searching || text.startsWith("#") || text.includes("/"))) return [];
    const { host, project } = place;
    return [
      {
        id: "start:session",
        label: t("palette.startIn", { project: project.name, text: shortened(text) }),
        detail: t("palette.startDetail"),
        target: { kind: "start-session", hostId: host.id, cwd: project.path, prompt: text },
        actions: [],
        hostId: host.id,
        projectId: project.id,
      },
    ];
  };
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
    { title: t("palette.sectionStart"), items: start() },
    { title: t("palette.sectionCreate"), items: create() },
  ].filter((section) => section.items.length > 0);
}
