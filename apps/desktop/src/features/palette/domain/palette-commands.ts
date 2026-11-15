import { ALL_CLIENTS, UNASSIGNED } from "@/features/clients/index.ts";
import type { T } from "../../../i18n/index.ts";
import type { AppState } from "../../../lib/app-store.ts";
import { hasFeature } from "../../../lib/version.ts";
import { type SessionViewName as SessionView, VIEW_LABEL } from "../../sessions/index.ts";
import { keysLabel, type ShortcutAction, shortcutOf } from "../../shortcuts/index.ts";
import type { PaletteItem, PaletteTarget } from "./palette-types.ts";

/** Builds a command row: its id, label, target and, when it has one, its shortcut. */
export function actionBuilder(t: T) {
  return (
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
}

/**
 * The palette's commands, in the order they show, and the clients' section.
 */
export function commandItems(
  state: AppState,
  t: T,
  options: {
    costs: boolean;
    oldest?: { text: string; opens: boolean; key: string };
    modeSwitch?: "simple" | "full" | null;
    views?: readonly SessionView[];
  },
) {
  const action = actionBuilder(t);
  const online = state.hosts.filter((h) => h.status === "online");
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

  return { actions, clients };
}
