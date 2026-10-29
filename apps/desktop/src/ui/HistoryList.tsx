import type { HistoryOrigin, HistorySessionSummary } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { useMinLoading } from "@/hooks/use-min-loading";
import type { AppStore, HistoryFilter } from "../lib/app-store.ts";
import { basename } from "../lib/paths.ts";
import { when } from "./GlobalSearch.tsx";

const ORIGIN_LABELS: Record<HistoryOrigin, string> = {
  flightdeck: "Flightdeck",
  external: "externa",
};

interface Draft {
  cwd: string;
  from: string;
  to: string;
  origin: "" | HistoryOrigin;
}

/** Date inputs give whole days; the daemon compares ISO timestamps (UTC). */
function toFilter(draft: Draft): HistoryFilter {
  return {
    ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
    ...(draft.from ? { from: `${draft.from}T00:00:00.000Z` } : {}),
    ...(draft.to ? { to: `${draft.to}T23:59:59.999Z` } : {}),
    ...(draft.origin ? { origin: draft.origin } : {}),
  };
}

/** Indexed sessions of one host, newest first, with folder, period and origin filters. */
export function HistoryList(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
  onOpen(claudeSessionId: string): void;
}) {
  const { store, hostId } = props;
  const [draft, setDraft] = useState<Draft>({ cwd: "", from: "", to: "", origin: "" });
  const [filter, setFilter] = useState<HistoryFilter>({});
  /** `null` until the host answers (the skeleton shows meanwhile). */
  const [sessions, setSessions] = useState<HistorySessionSummary[] | null>(null);
  const loading = useMinLoading(sessions === null);
  const { t } = store.i18n;

  useEffect(() => {
    let live = true;
    void store.historyList(hostId, filter).then((result) => {
      if (live && result) setSessions(result.sessions);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, filter]);

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });

  return (
    <section className="card history">
      <h2>{`Histórico de ${props.hostName}`}</h2>
      <div className="row filters">
        <input aria-label="Pasta" placeholder="Pasta" {...field("cwd")} />
        <input aria-label="De" type="date" {...field("from")} />
        <input aria-label="Até" type="date" {...field("to")} />
        <select aria-label="Origem" {...field("origin")}>
          <option value="">Todas as origens</option>
          <option value="flightdeck">Flightdeck</option>
          <option value="external">Externa</option>
        </select>
        <button type="button" onClick={() => setFilter(toFilter(draft))}>
          Filtrar
        </button>
      </div>
      {loading && <LoadingState label={t("states.loadingSessions")} />}
      {!loading && sessions?.length === 0 && <EmptyState title={t("states.emptyHistory")} />}
      {!loading && sessions && sessions.length > 0 && (
        <ul aria-label="Sessões do histórico">
          {sessions.map((s) => (
            <li key={s.claudeSessionId}>
              <button type="button" onClick={() => props.onOpen(s.claudeSessionId)}>
                <span>
                  {[
                    s.title ?? s.claudeSessionId,
                    basename(s.cwd),
                    when(s.lastTs),
                    ORIGIN_LABELS[s.origin],
                  ].join(" · ")}
                </span>
                {s.maybeActive && <span className="badge badge-warn">possivelmente em uso</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
