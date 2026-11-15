import type { ReactNode } from "react";
import { ExternalView } from "@/features/sessions/external-session-view.tsx";
import { rowRoute } from "@/features/sessions/index.ts";
import { lazyScreen } from "../app/lazy-screen.ts";
import { SessionTabs } from "../features/sessions/session-tabs.tsx";
import type { Route } from "../lib/router.ts";
import { hasFeature } from "../lib/version.ts";
import type { HostInfo, ScreenProps } from "./screen-states.tsx";

/** The host's pages load when their route opens, like the other screens (`route-screens.tsx`). */
const HostPage = lazyScreen(() => import("../features/hosts/page.tsx"), "HostPage");
const ProjectsPage = lazyScreen(() => import("../features/projects/page.tsx"), "ProjectsPage");

/** A session of another tool on the host: its tabs and its view, with the host's features as switches. */
export function externalScreen(
  props: ScreenProps,
  route: Extract<Route, { name: "external" }>,
  host: HostInfo | undefined,
): ReactNode {
  const { store, state, go } = props;
  const features = host?.hostInfo?.features;
  const has = (name: string) => hasFeature(features, name, false);
  return (
    <SessionTabs
      key={`${route.host}/${route.claudeSessionId}`}
      viewKey={`${route.host}/${route.claudeSessionId}`}
      // Issue #107: the PTY the session was started from, when there is one.
      {...(store.terminals.embedded(route.host)
        ? {
            terminal: {
              launch: state.externals[`${route.host}/${route.claudeSessionId}`]?.launchId ?? null,
            },
          }
        : {})}
      store={store}
      hostId={route.host}
      claudeSessionId={route.claudeSessionId}
      enabled={has("review")}
      messagingId={has("messaging") ? route.claudeSessionId : null}
      telemetry={has("telemetry")}
      trace={has("trace")}
      files={has("file.list")}
    >
      <ExternalView
        store={store}
        state={state}
        hostId={route.host}
        hostName={host?.name ?? route.host}
        claudeSessionId={route.claudeSessionId}
        onResumed={() => go({ name: "home" })}
        {...(has("snippets")
          ? {
              prompts: store.snippets.prompts(
                route.host,
                state.externals[`${route.host}/${route.claudeSessionId}`]?.cwd ?? "",
              ),
            }
          : {})}
      />
    </SessionTabs>
  );
}

/** One host's page, with its actions wired to the router and the store. */
export function hostScreen(props: ScreenProps, host: HostInfo): ReactNode {
  const { store, go } = props;
  return (
    <HostPage
      key={host.id}
      store={store}
      host={host}
      {...(props.route.name === "host" && props.route.section
        ? {
            section: props.route.section,
            // The ask is used up: the tab goes back to the plain host page. Only while the focused
            // tab still shows this ask, so another screen is never replaced.
            onSectionDone: () => {
              const now = store.router.current;
              if (now.name === "host" && now.host === host.id && now.section)
                store.router.replace({ name: "host", host: host.id });
            },
          }
        : {})}
      onRename={(name) => store.roster.rename(host.id, name)}
      onReconnect={() => void store.roster.reconnect(host.id)}
      onPairAgain={(input) => store.roster.pairAgain(host.id, input)}
      onOpenAutoApprovals={() => go({ name: "auto-approvals", host: host.id })}
      onOpenHistory={(f) => go({ name: "history", host: host.id, ...f })}
      onOpenSession={(row) => go(rowRoute(row))}
      onOpenProject={(card) =>
        go({ name: "project", host: card.hostId, projectId: card.projectId })
      }
      onSeeAllSessions={() => {
        // The hub applies the host for this visit only: the saved filter stays the person's.
        go({ name: "hub", host: host.name });
      }}
      onSeeAllProjects={() => go({ name: "all-projects", host: host.id })}
      onNewSession={() => go({ name: "new-session", host: host.id })}
      onRemove={() => {
        go({ name: "hub" });
        void store.roster.remove(host.id);
      }}
    />
  );
}

/** A host's projects, with the pages each one opens switched on by the host's features. */
export function projectsScreen(
  props: ScreenProps,
  route: Extract<Route, { name: "projects" }>,
  host: HostInfo | undefined,
): ReactNode {
  const { store, go } = props;
  const has = (name: string) => hasFeature(host?.hostInfo?.features, name, false);
  const open =
    (name: "agent" | "workflows" | "automations" | "actions") =>
    ({ id, name: projectName }: { id: string; name: string }) =>
      go({ name, host: route.host, projectId: id, projectName });
  return (
    <ProjectsPage
      key={route.host}
      store={store}
      hostId={route.host}
      hostName={host?.name ?? route.host}
      rules={has("rules")}
      personas={has("personas")}
      agent={has("agentcfg")}
      onOpenAgent={open("agent")}
      {...(route.focus ? { focus: route.focus } : {})}
      onOpenBoard={(projectId) => go({ name: "board", host: route.host, projectId })}
      onOpenWorkflows={open("workflows")}
      automations={has("automation")}
      onOpenAutomations={open("automations")}
      actions={has("actions")}
      onOpenActions={open("actions")}
    />
  );
}
