import { selectedClient, tagsFirst } from "@/features/clients/index.ts";
import { basename, isInside } from "@/shared/lib/index.ts";
import type { T } from "../../../i18n/index.ts";
import { type AppState, sessionKey } from "../../../lib/app-store.ts";
import { hostStatusView } from "../../hosts/index.ts";
import { sessionLabel } from "../../sessions/index.ts";
import type { AppSnippet } from "../../snippets/index.ts";
import type { TerminalTarget } from "../../terminal/index.ts";
import type { PaletteAction, PaletteItem, PaletteTarget } from "./palette-types.ts";

const LIVE: ReadonlySet<string> = new Set(["starting", "running", "awaiting_permission", "idle"]);

/** The state a session's status shows as, for its glyph: Idle covers whatever is not running or waiting. */
const stateOf = (status: string): NonNullable<PaletteItem["stateKey"]> => {
  if (status === "awaiting_permission") return "needs_you";
  return status === "running" || status === "starting" ? "running" : "idle";
};

/**
 * What the palette finds by name: the live sessions, the cards, the projects, the hosts, the
 * SSH connections and the snippets (the selected client's first), each as its list of rows.
 */
export function entityItems(state: AppState, t: T, globalSnippets: AppSnippet[] | undefined) {
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
            label:
              sessionLabel(
                {
                  metaName: state.meta[`${host.id}/${s.id}`]?.name,
                  createdName: s.name,
                  names: names.get(s.id),
                  personas: state.personas?.[host.id],
                },
                t,
              ) ?? basename(s.cwd),
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
            label:
              sessionLabel(
                {
                  metaName: state.meta[key]?.name,
                  names: names.get(id),
                  personas: state.personas?.[host.id],
                },
                t,
              ) ?? basename(s.cwd ?? id),
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
      ...(globalSnippets ?? []).map((s) => ({
        tags: s.tags,
        item: snippetItem(s, null, t("snippets.origin.global")),
      })),
    ],
    clientTag,
  ).map(({ item }) => item);

  return { sessions, cards, projects, hosts, connections, snippets };
}
