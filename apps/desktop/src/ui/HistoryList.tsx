import type { HistoryOrigin, HistorySessionSummary } from "@flightdeck/protocol";
import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/layout/form";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMinLoading } from "@/hooks/use-min-loading";
import { cn } from "@/lib/utils";
import type { AppStore, HistoryFilter } from "../lib/app-store.ts";
import type { Density } from "../lib/density.ts";
import { basename } from "../lib/paths.ts";

/** Native selects, as in the hub. */

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
  density: Density;
  /** The session open on the right, if any. */
  openId: string | null;
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
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <h2 className="font-semibold text-base">
          {t("historyUi.title", { host: props.hostName })}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t("historyUi.folder")}
            placeholder={t("historyUi.folder")}
            className="w-32"
            {...field("cwd")}
          />
          <Input aria-label={t("historyUi.from")} type="date" className="w-36" {...field("from")} />
          <Input aria-label={t("historyUi.to")} type="date" className="w-36" {...field("to")} />
          <NativeSelect inline aria-label={t("historyUi.origin")} {...field("origin")}>
            <option value="">{t("historyUi.allOrigins")}</option>
            <option value="flightdeck">{t("historyUi.flightdeck")}</option>
            <option value="external">{t("historyUi.external")}</option>
          </NativeSelect>
          <Button variant="outline" onClick={() => setFilter(toFilter(draft))}>
            {t("historyUi.filter")}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && <LoadingState label={t("states.loadingSessions")} />}
        {!loading && sessions?.length === 0 && (
          <EmptyState
            icon={History}
            title={t("states.emptyHistory")}
            action={
              <>
                <p className="text-muted-foreground text-xs">{t("states.emptyHistoryHint")}</p>
                <Button
                  variant="link"
                  onClick={() => store.router.push({ name: "new-session", host: hostId })}
                >
                  {t("states.emptyHistoryLink")}
                </Button>
              </>
            }
          />
        )}
        {!loading && sessions && sessions.length > 0 && (
          <ul aria-label={t("historyUi.list")} className="flex flex-col">
            {sessions.map((s) => (
              <li
                key={s.claudeSessionId}
                aria-current={props.openId === s.claudeSessionId ? "true" : undefined}
                className={cn(
                  "flex items-center rounded-md transition-colors duration-150 hover:bg-accent aria-[current=true]:bg-accent",
                  props.density === "compact" ? "h-8" : "min-h-10 py-1",
                )}
              >
                <button
                  type="button"
                  onClick={() => props.onOpen(s.claudeSessionId)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {[
                      s.title ?? s.claudeSessionId,
                      basename(s.cwd),
                      store.formatDateTime(s.lastTs ?? ""),
                      t(`hub.originTags.${s.origin === "external" ? "terminal" : "flightdeck"}`),
                    ].join(" · ")}
                  </span>
                  {s.maybeActive && (
                    <span className="shrink-0 text-status-needs-you text-xs">
                      {t("reader.maybeActive")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
