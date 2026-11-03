import type { HistoryOrigin, HistorySessionSummary } from "@flightdeck/protocol";
import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { CardGrid } from "@/components/hub/card-grid";
import { HistoryCard } from "@/components/hub/history-card";
import { ViewToggle } from "@/components/hub/view-toggle";
import { CheckField, NativeSelect } from "@/components/layout/form";
import { Inline } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMinLoading } from "@/hooks/use-min-loading";
import { cn } from "@/lib/utils";
import type { AppStore, HistoryFilter } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import type { Density } from "../lib/density.ts";
import type { HubView } from "../lib/hub.ts";
import { basename } from "../lib/paths.ts";
import { projectLabel } from "../lib/usage-rows.ts";
import { hasFeature } from "../lib/version.ts";

/** Native selects, as in the hub. */

interface Draft {
  cwd: string;
  /** Set by a usage row of a remote project; the chip clears it. */
  projectKey: string;
  from: string;
  to: string;
  origin: "" | HistoryOrigin;
}

/** Date inputs give whole days; the daemon compares ISO timestamps (UTC). */
function toFilter(draft: Draft): HistoryFilter {
  return {
    ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
    ...(draft.projectKey ? { projectKey: draft.projectKey } : {}),
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
  /** Opened from a usage row: starts filtered by that folder and day (UTC). */
  initial?: { cwd?: string; projectKey?: string; day?: string };
}) {
  const { store, hostId } = props;
  const [draft, setDraft] = useState<Draft>(() => ({
    cwd: props.initial?.cwd ?? "",
    projectKey: props.initial?.projectKey ?? "",
    from: props.initial?.day ?? "",
    to: props.initial?.day ?? "",
    origin: "",
  }));
  const [filter, setFilter] = useState<HistoryFilter>(() => toFilter(draft));
  /** The runs nobody typed (print-mode, temp folders) stay out of the list unless asked for. */
  const [hideAutomated, setHideAutomated] = useState(true);
  // A usage row opened this list again with another folder or day: the filter follows it.
  const [seen, setSeen] = useState(props.initial);
  if (
    props.initial &&
    (props.initial.cwd !== seen?.cwd ||
      props.initial.projectKey !== seen?.projectKey ||
      props.initial.day !== seen?.day)
  ) {
    const next = {
      cwd: props.initial.cwd ?? "",
      projectKey: props.initial.projectKey ?? "",
      from: props.initial.day ?? "",
      to: props.initial.day ?? "",
      origin: "" as const,
    };
    setSeen(props.initial);
    setDraft(next);
    setFilter(toFilter(next));
  }
  const [automatedCount, setAutomatedCount] = useState(0);
  /** `null` until the host answers (the skeleton shows meanwhile). */
  const [sessions, setSessions] = useState<HistorySessionSummary[] | null>(null);
  const loading = useMinLoading(sessions === null);
  const { t } = store.i18n;
  /** Lines or cards: the same choice as the hub's. */
  const [view, setView] = useState<HubView>(() => store.hubView());
  /** Estimated cost by session id (hosts with costs); asked only for the cards. */
  const [costs, setCosts] = useState<Record<string, number>>({});
  const hasCosts = hasFeature(
    store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "costs",
    false,
  );
  const ids = view === "cards" && hasCosts ? (sessions ?? []).map((s) => s.claudeSessionId) : [];
  const asked = ids.join();
  useEffect(() => {
    if (!asked) return;
    let live = true;
    void store
      .hostCommand(hostId, "costs.sessions", { claudeSessionIds: asked.split(",").slice(0, 500) })
      .then((result) => {
        if (live) setCosts(result?.costs ?? {});
      });
    return () => {
      live = false;
    };
  }, [store, hostId, asked]);

  useEffect(() => {
    let live = true;
    void store.historyList(hostId, { ...filter, hideAutomated }).then((result) => {
      if (!live || !result) return;
      setSessions(result.sessions);
      setAutomatedCount(result.automatedCount ?? 0);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, filter, hideAutomated]);

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });
  const clearProject = () => {
    const next = { ...draft, projectKey: "" };
    setDraft(next);
    setFilter(toFilter(next));
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <Inline gap={3}>
          <h2 className="font-semibold text-base">
            {t("historyUi.title", { host: props.hostName })}
          </h2>
          <ViewToggle
            view={view}
            label={t("hub.view")}
            listLabel={t("hub.viewList")}
            cardsLabel={t("hub.viewCards")}
            onChange={(next) => {
              setView(next);
              store.saveHubView(next);
            }}
          />
        </Inline>
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
        {draft.projectKey && filter.projectKey === draft.projectKey && (
          <Inline gap={2} className="text-sm">
            <span>{t("historyUi.project", { name: projectLabel(draft.projectKey) })}</span>
            <Button variant="link" size="sm" onClick={clearProject}>
              {t("historyUi.clearProject")}
            </Button>
          </Inline>
        )}
        <Inline gap={3} className="text-sm">
          <CheckField checked={hideAutomated} onChange={setHideAutomated}>
            {t("historyUi.hideAutomated")}
          </CheckField>
          {hideAutomated && automatedCount > 0 && (
            <>
              <span className="text-muted-foreground text-xs">
                {t("historyUi.automatedHidden", { count: automatedCount })}
              </span>
              <Button variant="link" size="sm" onClick={() => setHideAutomated(false)}>
                {t("historyUi.showAutomated")}
              </Button>
            </>
          )}
        </Inline>
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
        {!loading && sessions && sessions.length > 0 && view === "cards" && (
          <CardGrid label={t("historyUi.list")}>
            {sessions.map((s) => {
              const title = s.title ?? s.claudeSessionId;
              const cost = costs[s.claudeSessionId];
              return (
                <HistoryCard
                  key={s.claudeSessionId}
                  title={title}
                  project={basename(s.cwd)}
                  host={props.hostName}
                  when={store.formatDateTime(s.lastTs ?? "")}
                  origin={t(
                    `hub.originTags.${s.origin === "external" ? "terminal" : "flightdeck"}`,
                  )}
                  costLabel={t("hub.cost", { title })}
                  {...(cost === undefined ? {} : { cost: usd(cost) })}
                  {...(s.maybeActive ? { maybeActive: t("reader.maybeActive") } : {})}
                  {...(s.automated ? { automated: t("historyUi.automatedTag") } : {})}
                  current={props.openId === s.claudeSessionId}
                  onOpen={() => props.onOpen(s.claudeSessionId)}
                />
              );
            })}
          </CardGrid>
        )}
        {!loading && sessions && sessions.length > 0 && view === "list" && (
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
                      ...(s.automated ? [t("historyUi.automatedTag")] : []),
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
