import type { SessionMeta } from "@flightdeck/protocol";
import { ListFilter, MoreHorizontal, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { HostsBanner } from "@/components/hosts/hosts-banner";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Toolbar } from "@/components/layout/stack";
import type { StateTone } from "@/components/status/status-dot";
import { StatusDot } from "@/components/status/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Key } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import type { Density } from "../lib/density.ts";
import {
  type HubFilter,
  type HubRow,
  type HubState,
  hubGroups,
  hubRows,
  sessionLineText,
  sharedMeta,
} from "../lib/hub.ts";
import { typing } from "../lib/keys.ts";
import { hasFeature } from "../lib/version.ts";

const TONES: Record<HubState, StateTone> = {
  running: "running",
  needs_you: "needs-you",
  idle: "idle",
  ended: "ended",
};

/** Native selects: the filters stay light, and keyboard and screen readers work as they are. */

/**
 * The main screen: every session of every online host (managed, opened in the terminal, or from
 * the history), grouped by project; the ones that need you first, then pinned, then the latest
 * activity. Filters are kept in the app; each row has its actions in a menu.
 */
export function SessionsHub(props: {
  store: AppStore;
  state: AppState;
  onOpen(row: HubRow): void;
  /** Whether the row is the session open on the right. */
  isOpen(row: HubRow): boolean;
  density: Density;
}) {
  const { store, state } = props;
  const [filter, setFilter] = useState<HubFilter>(() => store.hubFilter());
  const [renaming, setRenaming] = useState<HubRow | null>(null);
  const [name, setName] = useState("");
  // Reload when hosts come online (and say what they offer) or sessions come and go.
  const signature = state.hosts
    .map((h) => `${h.id}:${h.status}:${h.sessions.length}:${h.hostInfo ? "info" : ""}`)
    .join();
  useEffect(() => {
    if (signature) void store.refreshHub();
  }, [store, signature]);

  const rows = hubRows(state);
  const groups = hubGroups(rows, filter);
  // The personas the sessions run in: the Persona filter offers only those.
  const personas = [
    ...new Map(
      rows.flatMap((r) => (r.persona ? [[r.persona.id, r.persona] as const] : [])),
    ).values(),
  ];
  /** The rows as listed, top to bottom: what J and K walk. */
  const listed = groups.flatMap((g) => g.rows);
  /** The row the keyboard is on (-1: none yet). */
  const [cursor, setCursor] = useState(-1);
  // J and K move the cursor, Enter opens the row under it (a focused button keeps its own Enter).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "j") setCursor(Math.min(listed.length - 1, cursor + 1));
      else if (e.key === "k") setCursor(Math.max(0, cursor - 1));
      else if (
        e.key === "Enter" &&
        listed[cursor] &&
        (e.target as HTMLElement).tagName !== "BUTTON"
      ) {
        props.onOpen(listed[cursor] as HubRow);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  /** Estimated cost of each row's session, by row key (hosts with costs, phase 8). */
  const [costs, setCosts] = useState<Record<string, number>>({});
  const asked = JSON.stringify(
    state.hosts
      .filter((h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false))
      .map((h) => [
        h.id,
        rows.filter((r) => r.hostId === h.id && r.claudeSessionId).map((r) => r.claudeSessionId),
      ]),
  );
  useEffect(() => {
    const byHost = JSON.parse(asked) as Array<[string, string[]]>;
    void Promise.all(
      byHost.map(async ([hostId, ids]) => {
        const result = await store.hostCommand(hostId, "costs.sessions", {
          claudeSessionIds: ids.slice(0, 500),
        });
        return Object.entries(result?.costs ?? {}).map(([id, cost]) => [`${hostId}/${id}`, cost]);
      }),
    ).then((all) => setCosts(Object.fromEntries(all.flat())));
  }, [store, asked]);
  const set = (patch: Partial<HubFilter>) => {
    const next = { ...filter, ...patch };
    setFilter(next);
    store.saveHubFilter(next);
  };
  const meta = (row: HubRow, patch: Partial<SessionMeta>) =>
    void store.setMeta(row.hostId, row.claudeSessionId as string, patch);

  const { t } = store.i18n;
  const active = [
    filter.host !== "",
    filter.origin !== "",
    filter.state !== "",
    filter.persona !== "",
    filter.pinnedOnly,
    filter.showArchived,
  ].filter(Boolean).length;
  const toolbar = (
    <Toolbar label={t("hub.filters")}>
      <Input
        aria-label={t("hub.filterLabel")}
        placeholder={t("hub.filterPlaceholder")}
        value={filter.text}
        onChange={(e) => set({ text: e.target.value })}
        className="h-8 min-w-0 flex-1 text-xs"
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <ListFilter aria-hidden="true" />
            {t("hub.filters")}
            {active > 0 && (
              <Badge className="h-4 min-w-4 px-1 tabular-nums" variant="default">
                {active}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-64 flex-col gap-2">
          <NativeSelect
            compact
            aria-label={t("hub.host")}
            value={filter.host}
            onChange={(e) => set({ host: e.target.value })}
          >
            <option value="">{t("hub.allHosts")}</option>
            {state.hosts
              .filter((h) => h.status !== "incompatible")
              .map((h) => (
                <option key={h.id} value={h.name}>
                  {h.name}
                </option>
              ))}
          </NativeSelect>
          <NativeSelect
            compact
            aria-label={t("hub.origin")}
            value={filter.origin}
            onChange={(e) => set({ origin: e.target.value as HubFilter["origin"] })}
          >
            <option value="">{t("hub.allOrigins")}</option>
            <option value="flightdeck">{t("hub.origins.flightdeck")}</option>
            <option value="terminal">{t("hub.origins.terminal")}</option>
            <option value="history">{t("hub.origins.history")}</option>
          </NativeSelect>
          <NativeSelect
            compact
            aria-label={t("hub.state")}
            value={filter.state}
            onChange={(e) => set({ state: e.target.value as HubFilter["state"] })}
          >
            <option value="">{t("hub.allStates")}</option>
            <option value="running">{t("hub.states.running")}</option>
            <option value="needs_you">{t("hub.states.needs_you")}</option>
            <option value="idle">{t("hub.states.idle")}</option>
            <option value="ended">{t("hub.states.ended")}</option>
          </NativeSelect>
          {personas.length > 0 && (
            <NativeSelect
              compact
              aria-label={t("hub.persona")}
              value={filter.persona}
              onChange={(e) => set({ persona: e.target.value })}
            >
              <option value="">{t("hub.allPersonas")}</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filter.pinnedOnly}
            onClick={() => set({ pinnedOnly: !filter.pinnedOnly })}
          >
            {t("hub.pinnedOnly")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filter.showArchived}
            onClick={() => set({ showArchived: !filter.showArchived })}
          >
            {t("hub.showArchived")}
          </Button>
        </PopoverContent>
      </Popover>
    </Toolbar>
  );

  return (
    <Page title={t("sidebar.sessions")} toolbar={toolbar}>
      <div className="flex flex-col gap-4">
        <HostsBanner hosts={state.hosts} t={store.i18n.t} />
        {renaming && (
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("hub.newName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-64"
            />
            <Button
              onClick={() => {
                meta(renaming, { name: name.trim() || null });
                setRenaming(null);
              }}
            >
              {t("hub.saveName")}
            </Button>
          </div>
        )}
        {groups.map((group) => {
          const shared = sharedMeta(group.rows);
          return (
            <section
              key={group.key}
              aria-label={t("hub.project", { name: group.name })}
              className="flex flex-col gap-1"
            >
              <div className="flex items-baseline gap-2 px-2 text-xs">
                <h3 className="shrink-0 font-medium text-muted-foreground">{group.name}</h3>
                {(shared.hostName || shared.origin) && (
                  <span
                    data-slot="group-meta"
                    className="min-w-0 truncate text-muted-foreground/80"
                  >
                    {[shared.hostName, shared.origin && t(`hub.originTags.${shared.origin}` as Key)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </div>
              <ul className="flex flex-col">
                {group.rows.map((row) => {
                  const cost = costs[`${row.hostId}/${row.claudeSessionId}`];
                  const line = sessionLineText(row.summary, store.now(), t);
                  // What the whole group shares is in its header; the row keeps what differs.
                  const rowMeta = [
                    shared.hostName === null ? row.hostName : null,
                    shared.origin === null ? t(`hub.originTags.${row.origin}` as Key) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li
                      key={row.key}
                      aria-label={row.title}
                      aria-current={props.isOpen(row) ? "true" : undefined}
                      data-active={listed[cursor]?.key === row.key}
                      className={cn(
                        "group flex items-center gap-x-2 rounded-md px-2 transition-colors duration-150 hover:bg-accent data-[active=true]:bg-accent aria-[current=true]:bg-accent",
                        props.density === "compact" ? "h-8" : "min-h-10 flex-wrap py-1",
                      )}
                    >
                      <StatusDot
                        tone={TONES[row.state]}
                        label={t(`hub.stateDots.${row.state}` as Key)}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => {
                              setCursor(listed.findIndex((r) => r.key === row.key));
                              props.onOpen(row);
                            }}
                            className="min-w-0 flex-1 truncate text-left font-medium text-sm"
                          >
                            {row.title}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{row.title}</TooltipContent>
                      </Tooltip>
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
                          {usd(cost)}
                        </output>
                      )}
                      <time
                        dateTime={new Date(row.lastActivity).toISOString()}
                        title={store.formatDateTime(row.lastActivity)}
                        className="shrink-0 text-muted-foreground text-xs tabular-nums"
                      >
                        {store.formatWhen(row.lastActivity)}
                      </time>
                      {row.claudeSessionId && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("hub.actions", { title: row.title })}
                              className="size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                store.tabs.openNextInNewTab();
                                props.onOpen(row);
                              }}
                            >
                              {t("tabs.openInNew")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                setRenaming(row);
                                setName(row.title);
                              }}
                            >
                              {t("hub.rename")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => meta(row, { pinned: !row.pinned })}>
                              {row.pinned ? t("hub.unpin") : t("hub.pin")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => meta(row, { archived: !row.archived })}
                            >
                              {row.archived ? t("hub.unarchive") : t("hub.archive")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                void store.copyText(
                                  `flightdeckd claude --resume ${row.claudeSessionId}`,
                                )
                              }
                            >
                              {t("hub.copyCommand")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <span
                        data-slot="summary"
                        className={cn(
                          "truncate text-muted-foreground text-xs",
                          props.density === "compact" ? "sr-only" : "basis-full pl-4",
                        )}
                      >
                        {line}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
