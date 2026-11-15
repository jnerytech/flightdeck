import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ALL_CLIENTS, UNASSIGNED } from "@/features/clients/index.ts";
import { AssignMenu, ClientChip } from "@/features/clients/ui.ts";
import type { Density } from "@/features/shell/index.ts";
import { cn } from "@/lib/utils";
import { CardGrid } from "@/shared/layout/index.ts";
import { StatusDot } from "@/shared/status/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { usd } from "../costs/index.ts";
import { AsleepMark } from "./asleep-mark";
import { CacheTimer } from "./cache-timer";
import type { HubGroup, HubRow, HubView } from "./domain/hub.ts";
import { rowSummary, showsStateWord } from "./domain/hub-derive.ts";
import { rowStatus, sessionLineText, sharedMeta } from "./domain/hub-status.ts";
import { activeCount, type HubGroupView } from "./domain/hub-view.ts";
import { CountChip, HostChip, ProjectHeader } from "./group-header";
import { type RowActionsContext, rowActions } from "./hub-row-actions.tsx";
import { RuntimeBadge } from "./runtime-badge";
import { SessionCard, STATE_TONES } from "./session-card";

/** The key of a row's state: an asleep session is its own word, though it is idle underneath. */
const stateKey = (row: HubRow) => (row.asleep ? "asleep" : row.state);

/**
 * One project of the Sessions list: its header (client, hint, counts, hosts, origin) and its
 * sessions as cards or as a list, with the earlier ones behind a button. The hub keeps the fold and
 * cursor state; the group draws it and reports the open, the fold and the earlier toggle.
 */
export function ProjectGroup(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "clientList" | "clientOverrides" | "clientSelection">;
    group: HubGroup;
    /** The group as the list shows it (live rows, earlier ones, folds); absent before the list is built. */
    groupView: HubGroupView | undefined;
    layout: HubView;
    density: Density;
    /** The text search is on: no "earlier" button then. */
    searching: boolean;
    /** The cost of each session, by `host/session`. */
    costs: Record<string, number>;
    rowCtx: RowActionsContext;
    /** The row the keyboard cursor is on, and how a click moves it. */
    activeKey: string | undefined;
    mark(row: HubRow): void;
    isOpen(row: HubRow): boolean;
    onOpen(row: HubRow): void;
    onToggle(): void;
    onToggleEarlier(): void;
  }>,
) {
  const {
    store,
    state,
    group,
    groupView,
    layout,
    density,
    searching,
    costs,
    rowCtx,
    activeKey,
    mark,
    isOpen,
    onOpen,
    onToggle,
    onToggleEarlier,
  } = props;
  const { t } = store.i18n;
  const scope = store.clientScope.get();
  /** The prompt cache countdown: only an idle session that says since when it has been idle. */
  const cacheOf = (row: HubRow) =>
    row.state === "idle" && row.summary?.state === "idle" ? (
      <CacheTimer store={store} since={row.summary.since} />
    ) : null;
  /** A card's cost, when its host reported one. */
  const cardCost = (row: HubRow) => {
    const cost = costs[`${row.hostId}/${row.claudeSessionId}`];
    return {
      costLabel: t("hub.cost", { title: row.title }),
      ...(cost === undefined ? {} : { cost: usd(cost, t.lang) }),
    };
  };
  const shared = sharedMeta(group.rows);
  const clientChip = scope.chipOf(group.key);
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
        onToggle={() => onToggle()}
      >
        {clientChip && state.clientSelection === ALL_CLIENTS && (
          <ClientChip name={clientChip.name} color={clientChip.color} />
        )}
        {scope.active && scope.clientOf(group.key) === UNASSIGNED && (
          <AssignMenu store={store} state={state} projectKey={group.key} name={group.name} />
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
          <span data-slot="group-meta" className="min-w-0 truncate text-muted-foreground/80">
            {t(`hub.originTags.${shared.origin}` as Key)}
          </span>
        )}
      </ProjectHeader>
      {/* The rows sit under the folder icon, the footer with them (#588). */}
      <div data-slot="group-body" className="group-body">
        {layout === "cards" ? (
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
                current={isOpen(row)}
                active={activeKey === row.key}
                onOpen={() => {
                  mark(row);
                  onOpen(row);
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
              const showWord = showsStateWord(density, row);
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
                  aria-current={isOpen(row) ? "true" : undefined}
                  data-active={activeKey === row.key}
                  className={cn(
                    "group flex items-center gap-x-2 rounded-md px-2 transition-colors duration-150 hover:bg-accent data-[active=true]:bg-accent aria-[current=true]:bg-accent",
                    density === "compact" ? "h-8" : "min-h-10 flex-wrap py-1",
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
                          onOpen(row);
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
                      <Radio aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
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
                      title={[said.word, row.lastActivity && store.formatDateTime(row.lastActivity)]
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
                      density === "compact" ? "sr-only" : "basis-full pl-4",
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
            onClick={() => onToggleEarlier()}
          >
            {groupView.earlier.length === 1
              ? t("hub.earlierOne")
              : t("hub.earlier", { n: groupView.earlier.length })}
          </Button>
        )}
      </div>
    </section>
  );
}
