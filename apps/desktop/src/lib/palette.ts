import type { T } from "../i18n/index.ts";
import { type AppState, sessionKey } from "./app-store.ts";
import { hostStatusView } from "./host-status.ts";
import { basename } from "./paths.ts";
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
  | { kind: "new-session"; hostId: string }
  | { kind: "terminal"; hostId: string; target: TerminalTarget }
  /** A new embedded terminal (phase 14), in a new tab. */
  | { kind: "new-terminal"; hostId: string }
  | { kind: "settings" }
  | { kind: "toggle-theme" }
  | { kind: "switch-language" }
  | { kind: "start-card"; hostId: string; cardId: string }
  | { kind: "costs" }
  | { kind: "connect-ssh"; hostId: string; targetId: string };

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
}

export interface PaletteSection {
  title: string;
  items: PaletteItem[];
}

const LIVE: ReadonlySet<string> = new Set(["starting", "running", "awaiting_permission", "idle"]);

/**
 * The palette's local sections, in order, filtered by `query` (on the label): live sessions,
 * cards, projects, hosts and actions. Empty sections are left out; the history comes from the
 * global search. `costs`: the app has a Custos screen and some host announces it.
 */
export function paletteSections(
  state: AppState,
  query: string,
  options: { costs: boolean; t: T },
): PaletteSection[] {
  const { t } = options;
  const online = state.hosts.filter((h) => h.status === "online");
  const terminal = (hostId: string, target: TerminalTarget): PaletteAction => ({
    label: t("palette.openTerminal"),
    target: { kind: "terminal", hostId, target },
  });

  const sessions = online.flatMap((host) => [
    ...host.sessions
      .filter((s) => LIVE.has(s.status))
      .map((s): PaletteItem => {
        const target: PaletteTarget = { kind: "session", hostId: host.id, sessionId: s.id };
        const claudeSessionId =
          state.sessions[sessionKey(host.id, s.id)]?.claudeSessionId ??
          state.hub[host.id]?.managed.find((m) => m.id === s.id)?.claudeSessionId;
        return {
          id: `session:${host.id}/${s.id}`,
          label: s.name ?? basename(s.cwd),
          detail: `${host.name} · ${s.cwd}`,
          target,
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
          label: state.meta[key]?.name ?? basename(s.cwd ?? id),
          detail: `${host.name} · ${t("palette.terminalDetail")}`,
          target,
          actions: [
            { label: t("palette.open"), target },
            ...(s.cwd ? [terminal(host.id, { cwd: s.cwd, claudeSessionId: id })] : []),
          ],
        };
      }),
  ]);

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
        actions: [
          { label: t("palette.openHost"), target: page },
          { label: t("palette.newSession"), target: { kind: "new-session", hostId: host.id } },
          { label: t("palette.projects"), target: { kind: "projects", hostId: host.id } },
        ],
      };
    });

  const action = (id: string, label: string, target: PaletteTarget): PaletteItem => ({
    id,
    label,
    detail: t("palette.actionDetail"),
    target,
    actions: [],
  });
  const actions = [
    ...online.map((host) =>
      action(`new:${host.id}`, t("palette.newSessionIn", { host: host.name }), {
        kind: "new-session",
        hostId: host.id,
      }),
    ),
    ...online
      .filter((host) => hasFeature(host.hostInfo?.features, "terminal", false))
      .map((host) =>
        action(`terminal:${host.id}`, t("palette.newTerminalIn", { host: host.name }), {
          kind: "new-terminal",
          hostId: host.id,
        }),
      ),
    action("theme", t("palette.toggleTheme"), { kind: "toggle-theme" }),
    action("language", t("palette.switchLanguage"), { kind: "switch-language" }),
    ...(options.costs ? [action("costs", t("palette.goCosts"), { kind: "costs" })] : []),
    action("settings", t("palette.goSettings"), { kind: "settings" }),
  ];

  const connections = online.flatMap((host) =>
    (state.ssh[host.id] ?? []).map((target): PaletteItem => {
      const connect: PaletteTarget = { kind: "connect-ssh", hostId: host.id, targetId: target.id };
      return {
        id: `ssh:${host.id}/${target.id}`,
        label: t("palette.connectTo", { name: target.name }),
        detail: `${target.user}@${target.host} · ${host.name}`,
        target: connect,
        actions: [{ label: t("palette.connect"), target: connect }],
      };
    }),
  );

  const needle = query.trim().toLowerCase();
  const matches = (item: PaletteItem) => item.label.toLowerCase().includes(needle);
  return [
    { title: t("palette.sectionSessions"), items: sessions },
    { title: t("palette.sectionCards"), items: cards },
    { title: t("palette.sectionProjects"), items: projects },
    { title: t("palette.sectionHosts"), items: hosts },
    { title: t("palette.sectionConnections"), items: connections },
    { title: t("palette.sectionActions"), items: actions },
  ]
    .map((section) => ({ ...section, items: section.items.filter(matches) }))
    .filter((section) => section.items.length > 0);
}
