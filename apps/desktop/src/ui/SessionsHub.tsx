import type { SessionMeta } from "@flightdeck/protocol";
import { MoreHorizontal, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { HostsBanner } from "@/components/hosts/hosts-banner";
import { Page } from "@/components/layout/page";
import { Toolbar } from "@/components/layout/stack";
import type { StateTone } from "@/components/status/state-badge";
import { StatusDot } from "@/components/status/status-dot";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import type { Density } from "../lib/density.ts";
import {
  type HubFilter,
  type HubRow,
  type HubState,
  hubGroups,
  hubRows,
  ORIGIN_LABELS,
  STATE_LABELS,
  sessionLineText,
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
const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  // Reload when hosts come online or sessions come and go.
  const signature = state.hosts.map((h) => `${h.id}:${h.status}:${h.sessions.length}`).join();
  useEffect(() => {
    if (signature) void store.refreshHub();
  }, [store, signature]);

  const rows = hubRows(state);
  const groups = hubGroups(rows, filter);
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

  const toolbar = (
    <Toolbar label="Filtros">
      <Input
        aria-label="Filtrar sessões"
        placeholder="Filtrar"
        value={filter.text}
        onChange={(e) => set({ text: e.target.value })}
        className="w-48"
      />
      <select
        aria-label="Host"
        className={SELECT_CLASS}
        value={filter.host}
        onChange={(e) => set({ host: e.target.value })}
      >
        <option value="">Todos os hosts</option>
        {state.hosts
          .filter((h) => h.status !== "incompatible")
          .map((h) => (
            <option key={h.id} value={h.name}>
              {h.name}
            </option>
          ))}
      </select>
      <select
        aria-label="Origem"
        className={SELECT_CLASS}
        value={filter.origin}
        onChange={(e) => set({ origin: e.target.value as HubFilter["origin"] })}
      >
        <option value="">Todas as origens</option>
        <option value="flightdeck">Flightdeck</option>
        <option value="terminal">Terminal</option>
        <option value="history">Histórico</option>
      </select>
      <select
        aria-label="Estado"
        className={SELECT_CLASS}
        value={filter.state}
        onChange={(e) => set({ state: e.target.value as HubFilter["state"] })}
      >
        <option value="">Todos os estados</option>
        <option value="running">Rodando</option>
        <option value="needs_you">Precisa de você</option>
        <option value="idle">Ociosa</option>
        <option value="ended">Encerrada</option>
      </select>
      <Button
        variant="outline"
        aria-pressed={filter.pinnedOnly}
        onClick={() => set({ pinnedOnly: !filter.pinnedOnly })}
      >
        Só fixadas
      </Button>
      <Button
        variant="outline"
        aria-pressed={filter.showArchived}
        onClick={() => set({ showArchived: !filter.showArchived })}
      >
        Mostrar arquivadas
      </Button>
    </Toolbar>
  );

  return (
    <Page title="Sessões" toolbar={toolbar}>
      <div className="flex flex-col gap-4">
        <HostsBanner hosts={state.hosts} t={store.i18n.t} />
        {renaming && (
          <div className="flex items-center gap-2">
            <Input
              aria-label="Novo nome"
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
              Salvar nome
            </Button>
          </div>
        )}
        {groups.map((group) => (
          <section
            key={group.key}
            aria-label={`Projeto ${group.name}`}
            className="flex flex-col gap-1"
          >
            <h3 className="px-2 font-medium text-muted-foreground text-xs">{group.name}</h3>
            <ul className="flex flex-col">
              {group.rows.map((row) => {
                const cost = costs[`${row.hostId}/${row.claudeSessionId}`];
                const line = sessionLineText(row.summary, store.now());
                const origin = ORIGIN_LABELS[row.origin];
                return (
                  <li
                    key={row.key}
                    aria-label={row.title}
                    aria-current={props.isOpen(row) ? "true" : undefined}
                    data-active={listed[cursor]?.key === row.key}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 transition-colors duration-150 hover:bg-accent data-[active=true]:bg-accent aria-[current=true]:bg-accent",
                      props.density === "compact" ? "h-8" : "min-h-10 py-1",
                    )}
                  >
                    <StatusDot tone={TONES[row.state]} label={STATE_LABELS[row.state]} />
                    <button
                      type="button"
                      onClick={() => {
                        setCursor(listed.findIndex((r) => r.key === row.key));
                        props.onOpen(row);
                      }}
                      className="min-w-0 max-w-[60%] truncate text-left font-medium text-sm"
                    >
                      {row.title}
                    </button>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {origin ? `${row.hostName} · ${origin}` : row.hostName}
                    </span>
                    {row.controllable && (
                      <>
                        <Radio
                          aria-hidden="true"
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                        <span className="sr-only">controlável</span>
                      </>
                    )}
                    <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                      {line}
                    </span>
                    {cost !== undefined && (
                      <output
                        aria-label={`Custo de ${row.title}`}
                        className="shrink-0 text-muted-foreground text-xs tabular-nums"
                      >
                        {usd(cost)}
                      </output>
                    )}
                    <time
                      dateTime={new Date(row.lastActivity).toISOString()}
                      className="shrink-0 text-muted-foreground text-xs tabular-nums"
                    >
                      {store.formatDateTime(row.lastActivity)}
                    </time>
                    {row.claudeSessionId && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ações de ${row.title}`}
                            className="size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setRenaming(row);
                              setName(row.title);
                            }}
                          >
                            Renomear
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => meta(row, { pinned: !row.pinned })}>
                            {row.pinned ? "Desafixar" : "Fixar"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => meta(row, { archived: !row.archived })}>
                            {row.archived ? "Desarquivar" : "Arquivar"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              void store.copyText(
                                `flightdeckd claude --resume ${row.claudeSessionId}`,
                              )
                            }
                          >
                            Copiar comando
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  );
}
