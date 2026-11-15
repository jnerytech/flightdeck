import { Radio, Server, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ALL_CLIENTS, UNASSIGNED } from "@/features/clients/index.ts";
import { AssignMenu, ClientChip } from "@/features/clients/ui.ts";
import { HostsBanner } from "@/features/hosts/ui.ts";
import { WorktreeChip } from "@/features/projects/ui.ts";
import type { Density } from "@/features/shell/index.ts";
import { TeleportMove } from "@/features/teleport/ui.ts";
import { cn } from "@/lib/utils";
import { CardGrid, EmptyState, Page } from "@/shared/layout/index.ts";
import { StatusDot } from "@/shared/status/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { InlineNotice } from "../../shared/feedback/index.ts";
import { ALL_SCOPE, awayKey, usd } from "../costs/index.ts";
import { AsleepMark } from "./asleep-mark";
import { CacheTimer } from "./cache-timer";
import type { HubFilter, HubRow, HubView } from "./domain/hub.ts";
import {
  filterCount,
  hostlessHub,
  personasOf,
  rowSummary,
  showsStateWord,
} from "./domain/hub-derive.ts";
import { projectName } from "./domain/hub-scope.ts";
import { rowStatus, sessionLineText, sharedMeta } from "./domain/hub-status.ts";
import { activeCount, HUB_ROW_CAP } from "./domain/hub-view.ts";
import { newSessionHost } from "./domain/new-session-host.ts";
import { CountChip, FoldAll, HostChip, ProjectHeader } from "./group-header";
import { type RowActionsContext, rowActions, setRowMeta } from "./hub-row-actions.tsx";
import { HubToolbar } from "./hub-toolbar.tsx";
import { focusRowActions, RenameForm } from "./rename-form";
import { RuntimeBadge } from "./runtime-badge";
import { SessionCard, STATE_TONES } from "./session-card";
import { useHubCosts } from "./use-hub-costs.ts";
import { useHubCursor } from "./use-hub-cursor.ts";
import { useHubList } from "./use-hub-list.ts";
import { useHubRefresh } from "./use-hub-refresh.ts";
import { type HubProject, useHubScope } from "./use-hub-scope.ts";

/** The key of a row's state: an asleep session is its own word, though it is idle underneath. */
const stateKey = (row: HubRow) => (row.asleep ? "asleep" : row.state);

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
  const scope = store.clientScope.get();
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
  /** A card's cost, when its host reported one. */
  /** The prompt cache countdown: only an idle session that says since when it has been idle. */
  const cacheOf = (row: HubRow) =>
    row.state === "idle" && row.summary?.state === "idle" ? (
      <CacheTimer store={store} since={row.summary.since} />
    ) : null;
  const cardCost = (row: HubRow) => {
    const cost = costs[`${row.hostId}/${row.claudeSessionId}`];
    return {
      costLabel: t("hub.cost", { title: row.title }),
      ...(cost === undefined ? {} : { cost: usd(cost, t.lang) }),
    };
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
          const shared = sharedMeta(group.rows);
          const clientChip = scope.chipOf(group.key);
          const groupView = viewOf(group.key);
          // Two projects with one name tell themselves apart by where they are.
          const label = group.hint ? `${group.name} (${group.hint})` : group.name;
          // Pinned rows stay in the live list after they end or fail; they are not active.
          const liveCount = activeCount(groupView?.live ?? []);
          // The hosts the project's sessions run on, each one a link to the host page.
          const hostChips = [
            ...new Map((groupView?.group.rows ?? group.rows).map((r) => [r.hostId, r.hostName])),
          ].map(([id, name]) => ({ id, name }));
          return (
            <section
              key={group.key}
              aria-label={t("hub.project", { name: label })}
              className="flex flex-col gap-1"
            >
              <ProjectHeader
                name={group.name}
                expanded={groupView?.expanded ?? true}
                toggleLabel={t("hub.toggleProject", { name: label })}
                onToggle={() =>
                  setOpen({ ...openState, [group.foldKey]: !(groupView?.expanded ?? false) })
                }
              >
                {clientChip && state.clientSelection === ALL_CLIENTS && (
                  <ClientChip name={clientChip.name} color={clientChip.color} />
                )}
                {scope.active && scope.clientOf(group.key) === UNASSIGNED && (
                  <AssignMenu
                    store={store}
                    state={state}
                    projectKey={group.key}
                    name={group.name}
                  />
                )}
                {group.hint && (
                  <span data-slot="group-hint" className="min-w-0 truncate text-muted-foreground">
                    {group.hint}
                  </span>
                )}
                <CountChip
                  live={liveCount}
                  total={groupView?.total ?? group.rows.length}
                  label={t("hub.countChip", {
                    live: liveCount,
                    total: groupView?.total ?? group.rows.length,
                  })}
                  text={t("hub.countShort", {
                    live: liveCount,
                    total: groupView?.total ?? group.rows.length,
                  })}
                />
                {hostChips.map((chip) => (
                  <HostChip
                    key={chip.id}
                    name={chip.name}
                    label={t("hub.openHost", { name: chip.name })}
                    onOpen={() => store.router.push({ name: "host", host: chip.id })}
                  />
                ))}
                {/* A terminal session says so on its own row, as a chip (#583). */}
                {shared.origin && shared.origin !== "terminal" && (
                  <span
                    data-slot="group-meta"
                    className="min-w-0 truncate text-muted-foreground/80"
                  >
                    {t(`hub.originTags.${shared.origin}` as Key)}
                  </span>
                )}
              </ProjectHeader>
              {/* The rows sit under the folder icon, the footer with them (#588). */}
              <div data-slot="group-body" className="group-body">
                {view === "cards" ? (
                  <CardGrid>
                    {group.rows.map((row) => (
                      <SessionCard
                        key={row.key}
                        title={row.title}
                        project={group.name}
                        host={row.hostName}
                        stateLabel={t(`hub.stateDots.${stateKey(row)}` as Key)}
                        tone={STATE_TONES[row.state]}
                        line={sessionLineText(row.summary, store.now(), t)}
                        {...cardCost(row)}
                        persona={row.persona?.name ?? null}
                        asleep={row.asleep ? t("hub.asleep") : null}
                        cache={cacheOf(row)}
                        runtime={row.runtime ? t("session.runtimeOpenCode") : null}
                        current={props.isOpen(row)}
                        active={activeKey === row.key}
                        onOpen={() => {
                          mark(row);
                          props.onOpen(row);
                        }}
                        actions={rowActions(rowCtx, row)}
                      />
                    ))}
                  </CardGrid>
                ) : (
                  <ul className="flex flex-col">
                    {group.rows.map((row) => {
                      const cost = costs[`${row.hostId}/${row.claudeSessionId}`];
                      const line = sessionLineText(row.summary, store.now(), t);
                      const said = rowStatus(row, store.now(), t);
                      // #1132: the row's state in words. A working or waiting row in the compact
                      // list shows the word where its time was (the time stays in the tooltip):
                      // the row has no room for one more item. An idle or past row keeps its time,
                      // which says more there. The summary carries the word and its detail.
                      const showWord = showsStateWord(props.density, row);
                      const summaryText = rowSummary(said, line);
                      // What the whole group shares is in its header; the row keeps what differs.
                      const rowMeta = [
                        shared.origin === null && row.origin !== "terminal"
                          ? t(`hub.originTags.${row.origin}` as Key)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <li
                          key={row.key}
                          aria-label={row.title}
                          aria-current={props.isOpen(row) ? "true" : undefined}
                          data-active={activeKey === row.key}
                          className={cn(
                            "group flex items-center gap-x-2 rounded-md px-2 transition-colors duration-150 hover:bg-accent data-[active=true]:bg-accent aria-[current=true]:bg-accent",
                            props.density === "compact" ? "h-8" : "min-h-10 flex-wrap py-1",
                          )}
                        >
                          <StatusDot
                            tone={STATE_TONES[row.state]}
                            label={t(`hub.stateDots.${stateKey(row)}` as Key)}
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => {
                                  mark(row);
                                  props.onOpen(row);
                                }}
                                className="row-title min-w-0 flex-1 truncate text-left font-medium text-sm"
                              >
                                {row.title}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{row.title}</TooltipContent>
                          </Tooltip>
                          {shared.hostName === null && (
                            <HostChip
                              name={row.hostName}
                              label={t("hub.openHost", { name: row.hostName })}
                              onOpen={() => store.router.push({ name: "host", host: row.hostId })}
                            />
                          )}
                          {rowMeta && (
                            <span
                              data-slot="row-meta"
                              className="hidden max-w-[40%] min-w-0 shrink-[3] truncate text-muted-foreground text-xs @[20rem]:inline"
                            >
                              {rowMeta}
                            </span>
                          )}
                          {row.persona && (
                            <span className="shrink-0 rounded bg-muted px-1 text-xs">
                              {row.persona.name}
                            </span>
                          )}
                          {row.asleep && <AsleepMark label={t("hub.asleep")} />}
                          {row.origin === "terminal" && (
                            <RuntimeBadge slot="origin-chip" label={t("hub.originTags.terminal")} />
                          )}
                          {row.runtime && <RuntimeBadge label={t("session.runtimeOpenCode")} />}
                          {row.controllable && (
                            <>
                              <Radio
                                aria-hidden="true"
                                className="size-3 shrink-0 text-muted-foreground"
                              />
                              <span className="sr-only">{t("hub.controllable")}</span>
                            </>
                          )}
                          {cost !== undefined && (
                            <output
                              aria-label={t("hub.cost", { title: row.title })}
                              className="shrink-0 text-muted-foreground text-xs tabular-nums"
                            >
                              {usd(cost, t.lang)}
                            </output>
                          )}
                          {cacheOf(row)}
                          {showWord ? (
                            <span
                              data-slot="row-word"
                              title={[
                                said.word,
                                row.lastActivity && store.formatDateTime(row.lastActivity),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                              className="row-word"
                            >
                              {said.word}
                            </span>
                          ) : (
                            row.lastActivity && (
                              <time
                                dateTime={new Date(row.lastActivity).toISOString()}
                                title={store.formatDateTime(row.lastActivity)}
                                className="shrink-0 text-muted-foreground text-xs tabular-nums"
                              >
                                {store.formatWhen(row.lastActivity)}
                              </time>
                            )
                          )}
                          {rowActions(rowCtx, row)}
                          <span
                            data-slot="summary"
                            className={cn(
                              "truncate text-muted-foreground text-xs",
                              props.density === "compact" ? "sr-only" : "basis-full pl-4",
                            )}
                          >
                            {summaryText}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {groupView?.expanded && !searching && groupView.earlier.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start text-muted-foreground text-xs"
                    aria-expanded={groupView.earlierShown}
                    onClick={() =>
                      setEarlierOpen({ ...earlierOpen, [group.foldKey]: !groupView.earlierShown })
                    }
                  >
                    {groupView.earlier.length === 1
                      ? t("hub.earlierOne")
                      : t("hub.earlier", { n: groupView.earlier.length })}
                  </Button>
                )}
              </div>
            </section>
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
