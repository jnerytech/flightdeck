import { Server, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { HostsBanner } from "@/features/hosts/ui.ts";
import { WorktreeChip } from "@/features/projects/ui.ts";
import type { Density } from "@/features/shell/index.ts";
import { TeleportMove } from "@/features/teleport/ui.ts";
import { EmptyState, Page } from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { InlineNotice } from "../../shared/feedback/index.ts";
import { ALL_SCOPE, awayKey } from "../costs/index.ts";
import type { HubFilter, HubRow, HubView } from "./domain/hub.ts";
import { filterCount, hostlessHub, personasOf } from "./domain/hub-derive.ts";
import { projectName } from "./domain/hub-scope.ts";
import { HUB_ROW_CAP } from "./domain/hub-view.ts";
import { newSessionHost } from "./domain/new-session-host.ts";
import { FoldAll } from "./group-header";
import { ProjectGroup } from "./hub-project-group.tsx";
import { type RowActionsContext, setRowMeta } from "./hub-row-actions.tsx";
import { HubToolbar } from "./hub-toolbar.tsx";
import { focusRowActions, RenameForm } from "./rename-form";
import { useHubCosts } from "./use-hub-costs.ts";
import { useHubCursor } from "./use-hub-cursor.ts";
import { useHubList } from "./use-hub-list.ts";
import { useHubRefresh } from "./use-hub-refresh.ts";
import { type HubProject, useHubScope } from "./use-hub-scope.ts";

/** Native selects: the filters stay light, and keyboard and screen readers work as they are. */

/**
 * The main screen: every session of every online host (managed, opened in the terminal, or from
 * the history), grouped by project; the ones that need you first, then pinned, then the latest
 * activity. Filters are kept in the app; each row has its actions in a menu.
 */
export function SessionsHub(
  props: Readonly<{
    store: AppStore;
    state: AppState;
    onOpen(row: HubRow): void;
    /** Whether the row is the session open on the right. */
    isOpen(row: HubRow): boolean;
    density: Density;
    /** Only this project's sessions, with a chip that clears it (from the project page). */
    project?: HubProject;
    /** Only this host's sessions (its name), set by the route: it applies the host filter once. */
    host?: string;
  }>,
) {
  const { store, state } = props;
  const { t } = store.i18n;
  const [filter, setFilter] = useState<HubFilter>(() => store.viewPrefs.hubFilter());
  const [view, setView] = useState<HubView>(() => store.viewPrefs.hubView());
  const { only, clearOnly, hostScope, scoped, scopedProject, away, showAllHosts } = useHubScope(
    store,
    state,
    props.project,
    props.host,
  );
  const [renaming, setRenaming] = useState<HubRow | null>(null);
  /** Issue #100: the session being moved to another host (the preview's dialog). */
  const [moving, setMoving] = useState<HubRow | null>(null);
  useHubRefresh(store, state.hosts);

  const {
    picked,
    projects,
    projectNames,
    rows,
    allGroups,
    groups,
    hidden,
    viewOf,
    searching,
    openState,
    setOpen,
    earlierOpen,
    setEarlierOpen,
    showMore,
  } = useHubList(store, state, filter, { scoped, scopedProject, only });
  // The personas the sessions run in: the Persona filter offers only those.
  const personas = personasOf(rows);
  /** The rows as listed, top to bottom: what J and K walk. */
  const listed = groups.flatMap((g) => g.rows);
  const { activeKey, mark } = useHubCursor(listed, props.onOpen);
  const costs = useHubCosts(store, state.hosts, rows);
  const set = (patch: Partial<HubFilter>) => {
    const next = { ...filter, ...patch };
    setFilter(next);
    store.viewPrefs.saveHubFilter(next);
  };

  // rowActions reads the mutes: a change of them draws the menu again.
  useSyncExternalStore(store.notifyPrefs.subscribe, () => store.notifyPrefs.value);
  /** Closes the rename form and puts the focus back on the row's actions button. */
  const closeRename = (row: HubRow) => {
    focusRowActions(row.claudeSessionId);
    setRenaming(null);
  };
  const rowCtx: RowActionsContext = {
    store,
    hosts: state.hosts,
    teleportPreview: state.settings.teleportPreview,
    renaming,
    onOpen: props.onOpen,
    onRename: setRenaming,
    onMove: setMoving,
  };
  const active = filterCount(filter);
  const starter = newSessionHost(state.hosts, state.selected);
  const hostless = hostlessHub(state.hosts, rows.length);
  const toolbar = (
    <HubToolbar
      store={store}
      hosts={state.hosts}
      hostsLoaded={state.hostsLoaded}
      projects={projects}
      scope={hostScope}
      scopedProject={scopedProject}
      view={view}
      onView={(next) => {
        setView(next);
        store.viewPrefs.saveHubView(next);
      }}
      filter={filter}
      active={active}
      personas={personas}
      set={set}
    />
  );

  return (
    <Page
      title={t("sidebar.sessions")}
      toolbar={toolbar}
      actions={
        starter && (
          <Button
            size="sm"
            onClick={() => {
              store.subscriptions.select(starter.id, null);
              store.router.push({ name: "new-session", host: starter.id });
            }}
          >
            {t("sidebar.newSession")}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <HostsBanner hosts={state.hosts} t={store.i18n.t} />
        {away && (
          <InlineNotice tone="info">
            <span>{t(awayKey(away.status, "sessions"), { host: away.name })} </span>
            <Button variant="outline" size="sm" onClick={showAllHosts}>
              {t("scope.showAll")}
            </Button>
          </InlineNotice>
        )}
        {/* A project picked on Home or Costs can have no session here: the list says so (#126). */}
        {!hostless && scopedProject && rows.length === 0 && (
          <InlineNotice tone="info">
            <span>
              {t("scope.projectNoSessions", {
                project: projectName(scopedProject, projectNames),
              })}{" "}
            </span>
            <Button variant="outline" size="sm" onClick={() => store.dataScope.set(ALL_SCOPE)}>
              {t("scope.showAll")}
            </Button>
          </InlineNotice>
        )}
        {hostless ? (
          <EmptyState
            icon={Server}
            title={state.hosts.length === 0 ? t("hub.noHost") : t("hub.noOnlineHost")}
            action={
              <Button onClick={() => store.router.push({ name: "add-host" })}>
                {t("hub.addHost")}
              </Button>
            }
          />
        ) : (
          <FoldAll
            expandLabel={t("hub.expandAll")}
            collapseLabel={t("hub.collapseAll")}
            onExpand={() => setOpen(Object.fromEntries(allGroups.map((g) => [g.foldKey, true])))}
            onCollapse={() => setOpen(Object.fromEntries(allGroups.map((g) => [g.foldKey, false])))}
          />
        )}
        {only && (
          <div className="filter-chip self-start rounded-full border bg-muted/40 text-xs">
            <span>{t("hub.projectFilter", { name: only.name })}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              aria-label={t("hub.clearProjectFilter")}
              onClick={clearOnly}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        )}
        {picked && (
          <WorktreeChip filter={picked} t={t} onClear={() => store.setWorktreeFilter(null)} />
        )}
        {moving?.sessionId && (
          <TeleportMove
            store={store}
            hostId={moving.hostId}
            sessionId={moving.sessionId}
            onClose={() => setMoving(null)}
          />
        )}
        {renaming && (
          <RenameForm
            key={renaming.claudeSessionId}
            title={renaming.title}
            onSave={(name) => {
              setRowMeta(store, renaming, { name: name || null });
              closeRename(renaming);
            }}
            onCancel={() => closeRename(renaming)}
          />
        )}
        {groups.map((group) => {
          const groupView = viewOf(group.key);
          return (
            <ProjectGroup
              key={group.key}
              store={store}
              state={state}
              group={group}
              groupView={groupView}
              layout={view}
              density={props.density}
              searching={searching}
              costs={costs}
              rowCtx={rowCtx}
              activeKey={activeKey}
              mark={mark}
              isOpen={props.isOpen}
              onOpen={props.onOpen}
              onToggle={() =>
                setOpen({ ...openState, [group.foldKey]: !(groupView?.expanded ?? false) })
              }
              onToggleEarlier={() =>
                setEarlierOpen({ ...earlierOpen, [group.foldKey]: !groupView?.earlierShown })
              }
            />
          );
        })}
        {hidden > 0 && (
          <Button variant="outline" className="self-center" onClick={showMore}>
            {t("hub.showMore", { n: Math.min(hidden, HUB_ROW_CAP) })}
          </Button>
        )}
      </div>
    </Page>
  );
}
