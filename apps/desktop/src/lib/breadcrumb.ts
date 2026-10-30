import type { T } from "../i18n/index.ts";
import { type AppState, sessionKey } from "./app-store.ts";
import { basename } from "./paths.ts";
import type { Route } from "./router.ts";

/** One step of the header's path: a label and, when it can be clicked, where it goes. */
export interface Crumb {
  label: string;
  route?: Route;
}

/** The steps with the last one plain: where the user is does not link to itself. */
const path = (...steps: Crumb[]): Crumb[] =>
  steps.map((step, i) => (i === steps.length - 1 ? { label: step.label } : step));

/** Where the user is, as the header's path. */
export function breadcrumb(route: Route, state: AppState, t: T): Crumb[] {
  const hostName = (id: string) => state.hosts.find((h) => h.id === id)?.name ?? id;
  const host = (id: string): Crumb => ({ label: hostName(id), route: { name: "host", host: id } });
  const sessions: Crumb = { label: t("sidebar.sessions"), route: { name: "hub" } };
  const projectName = (hostId: string, projectId: string) =>
    state.projects[hostId]?.find((p) => p.id === projectId)?.name ?? projectId;
  /** A terminal or history session: the name given to it, else its folder or its id. */
  const claudeTitle = (hostId: string, id: string) => {
    const key = sessionKey(hostId, id);
    const cwd = state.externals[key]?.cwd;
    return (
      state.meta[key]?.name ??
      state.hub[hostId]?.history.find((h) => h.claudeSessionId === id)?.title ??
      (cwd ? basename(cwd) : id.slice(0, 8))
    );
  };
  const projects = (hostId: string, focus?: "board" | "workflows"): Route => ({
    name: "projects",
    host: hostId,
    ...(focus ? { focus } : {}),
  });

  switch (route.name) {
    case "hub":
    case "home":
      return path(sessions);
    case "session": {
      const session = state.hosts
        .find((h) => h.id === route.host)
        ?.sessions.find((s) => s.id === route.id);
      return path(sessions, {
        label: session?.name ?? (session ? basename(session.cwd) : route.id),
      });
    }
    case "external":
      return path(sessions, { label: claudeTitle(route.host, route.claudeSessionId) });
    case "reader": {
      const { hostId, claudeSessionId } = route.target;
      const title = { label: claudeTitle(hostId, claudeSessionId) };
      return route.list === "history"
        ? path(
            { label: t("sidebar.history") },
            { label: hostName(hostId), route: { name: "history", host: hostId } },
            title,
          )
        : path(sessions, title);
    }
    case "new-session":
      return path(sessions, { label: t("sidebar.newSession") });
    case "needs-you":
      return path({ label: t("sidebar.needsYou") });
    case "history":
      return path({ label: t("sidebar.history") }, { label: hostName(route.host) });
    case "host":
      return path({ label: t("sidebar.hosts") }, { label: hostName(route.host) });
    case "projects":
      return path(host(route.host), {
        label: route.focus ? t(`sidebar.${route.focus}`) : t("sidebar.hostProjects"),
      });
    case "board":
      return path(
        host(route.host),
        { label: t("sidebar.board"), route: projects(route.host, "board") },
        { label: projectName(route.host, route.projectId) },
      );
    case "auto-approvals":
      return path(host(route.host), { label: t("autoApprovalsUi.open") });
    case "terminal":
      return path(host(route.host), { label: t("terminalUi.title") });
    case "automations":
    case "actions":
      return path(
        host(route.host),
        { label: t("projectsUi.list"), route: projects(route.host) },
        { label: route.projectName },
      );
    case "workflows":
      return path(
        host(route.host),
        { label: t("sidebar.workflows"), route: projects(route.host, "workflows") },
        { label: route.projectName },
      );
    case "agent":
      return path(
        host(route.host),
        { label: t("sidebar.hostProjects"), route: { name: "projects", host: route.host } },
        { label: route.projectName },
        { label: t("agent.crumb") },
      );
    case "card":
      return path(
        host(route.host),
        { label: t("sidebar.board"), route: projects(route.host, "board") },
        {
          label: projectName(route.host, route.projectId),
          route: { name: "board", host: route.host, projectId: route.projectId },
        },
        { label: state.cards[sessionKey(route.host, route.cardId)]?.title ?? route.cardId },
      );
    case "costs":
      return path({ label: t("sidebar.costs") });
    case "connections":
      return path({ label: t("sidebar.connections") });
    case "snippets":
      return path({ label: t("sidebar.snippets") });
    case "vault":
      return path({ label: t("sidebar.vault") });
    case "settings":
      return path({ label: t("sidebar.settings") });
    case "add-host":
      return path({ label: t("sidebar.hosts") }, { label: t("sidebar.addHostCrumb") });
  }
}
