import type { HistorySessionSummary } from "@flightdeck/protocol";
import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HubView } from "@/features/sessions/index.ts";
import { ViewToggle } from "@/features/sessions/ui.ts";
import type { Density } from "@/features/shell/index.ts";
import { cn } from "@/lib/utils";
import { useMinLoading } from "@/shared/hooks/index.ts";
import {
  CardGrid,
  CheckField,
  EmptyState,
  ErrorState,
  Field,
  Form,
  Inline,
  LoadingState,
  NativeSelect,
} from "@/shared/layout/index.ts";
import { basename } from "@/shared/lib/index.ts";
import type { AppStore, HistoryFilter } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { usageProjectLabel, usd } from "../costs/index.ts";
import { type Draft, emptyReason, periodReversed, toFilter } from "./domain/history-filter.ts";
import { HistoryCard } from "./history-card.tsx";

/** Native selects, as in the hub. */

/** Indexed sessions of one host, newest first, with folder, period and origin filters. */
export function HistoryList(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    hostName: string;
    density: Density;
    /** The session open on the right, if any. */
    openId: string | null;
    onOpen(claudeSessionId: string): void;
    /** Opened from a usage row: starts filtered by that folder and day (UTC). */
    initial?: { cwd?: string; projectKey?: string; day?: string; from?: string; to?: string };
  }>,
) {
  const { store, hostId } = props;
  const [draft, setDraft] = useState<Draft>(() => ({
    cwd: props.initial?.cwd ?? "",
    projectKey: props.initial?.projectKey ?? "",
    from: props.initial?.from ?? props.initial?.day ?? "",
    to: props.initial?.to ?? props.initial?.day ?? "",
    origin: "",
  }));
  const [filter, setFilter] = useState<HistoryFilter>(() => toFilter(draft));
  /** The last apply was refused because From came after To; a date edit clears it. */
  const [reversed, setReversed] = useState(false);
  /** The runs nobody typed (print-mode, temp folders) stay out of the list unless asked for. */
  const [hideAutomated, setHideAutomated] = useState(true);
  // A usage row opened this list again with another folder or day: the filter follows it.
  const [seen, setSeen] = useState(props.initial);
  if (
    props.initial &&
    (props.initial.cwd !== seen?.cwd ||
      props.initial.projectKey !== seen?.projectKey ||
      props.initial.day !== seen?.day ||
      props.initial.from !== seen?.from ||
      props.initial.to !== seen?.to)
  ) {
    const next = {
      cwd: props.initial.cwd ?? "",
      projectKey: props.initial.projectKey ?? "",
      from: props.initial.from ?? props.initial.day ?? "",
      to: props.initial.to ?? props.initial.day ?? "",
      origin: "" as const,
    };
    setSeen(props.initial);
    setDraft(next);
    setFilter(toFilter(next));
    setReversed(false);
  }
  const [automatedCount, setAutomatedCount] = useState(0);
  /** `null` until the host answers (the skeleton shows meanwhile). */
  const [sessions, setSessions] = useState<HistorySessionSummary[] | null>(null);
  /** The last read was refused: the screen says so and offers Try again, not the skeleton for ever. */
  const [failed, setFailed] = useState(false);
  const loading = useMinLoading(sessions === null && !failed);
  const { t } = store.i18n;
  /** Lines or cards: the same choice as the hub's. */
  const [view, setView] = useState<HubView>(() => store.viewPrefs.hubView());
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
    // A new read drops the old list, so it is never shown as the answer to these filters (#3965).
    setSessions(null);
    setFailed(false);
    void store.history.list(hostId, { ...filter, hideAutomated }).then((result) => {
      if (!live) return;
      if (!result) {
        // The store sent the reason to the banner; the screen says it and offers another read.
        setFailed(true);
        return;
      }
      setSessions(result.sessions);
      setAutomatedCount(result.automatedCount ?? 0);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, filter, hideAutomated]);

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => {
      setDraft({ ...draft, [key]: e.target.value });
      if (key === "from" || key === "to") setReversed(false);
    },
  });
  /** Reads the list again with these fields, unless the period is reversed: that is said, not asked. */
  const apply = (next: Draft) => {
    if (periodReversed(next)) {
      setReversed(true);
      return;
    }
    setReversed(false);
    setFilter(toFilter(next));
  };
  /** Why the list is empty, once it is read: the hidden automated runs, the filters, or nothing yet. */
  const emptyBecause = emptyReason({
    open: !loading && sessions?.length === 0,
    automated: hideAutomated && automatedCount > 0,
    filtered: Object.keys(filter).length > 0,
  });
  /** Every filter back to empty, and the list read again without them. */
  const clearFilters = () => {
    const empty: Draft = { cwd: "", projectKey: "", from: "", to: "", origin: "" };
    setDraft(empty);
    setReversed(false);
    setFilter(toFilter(empty));
  };
  const clearProject = () => {
    const next = { ...draft, projectKey: "" };
    // A reversed period is said, not sent; the chip stays until the dates are fixed.
    if (periodReversed(next)) return setReversed(true);
    setDraft(next);
    apply(next);
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
              store.viewPrefs.saveHubView(next);
            }}
          />
        </Inline>
        {/* Issue #180: every filter has a visible label (which date is from and which is to). */}
        <Form
          variant="inline"
          className="flex-row flex-wrap items-end gap-2"
          onSubmit={() => apply(draft)}
        >
          <Field
            label={t("historyUi.folder")}
            help={t("historyUi.folderHelp")}
            className="min-w-48 flex-1"
          >
            {(control) => <Input {...control} {...field("cwd")} />}
          </Field>
          <Field label={t("historyUi.from")}>
            {(control) => <Input {...control} type="date" className="w-36" {...field("from")} />}
          </Field>
          <Field
            label={t("historyUi.to")}
            error={reversed ? t("historyUi.periodReversed") : undefined}
          >
            {(control) => <Input {...control} type="date" className="w-36" {...field("to")} />}
          </Field>
          <Field label={t("historyUi.origin")}>
            {(control) => (
              <NativeSelect
                {...control}
                inline
                value={draft.origin}
                onChange={(e) => {
                  // A pick is one click: it applies at once, and only itself. A typed field waits for Enter or Filter.
                  const origin = e.target.value as Draft["origin"];
                  setDraft({ ...draft, origin });
                  const { origin: _before, ...rest } = filter;
                  setFilter(origin ? { ...rest, origin } : rest);
                }}
              >
                <option value="">{t("historyUi.allOrigins")}</option>
                <option value="flightdeck">{t("historyUi.flightdeck")}</option>
                <option value="external">{t("historyUi.external")}</option>
              </NativeSelect>
            )}
          </Field>
          <Button type="submit" variant="outline">
            {t("historyUi.filter")}
          </Button>
        </Form>
        {draft.projectKey && filter.projectKey === draft.projectKey && (
          <Inline gap={2} className="text-sm">
            <span>{t("historyUi.project", { name: usageProjectLabel(draft.projectKey) })}</span>
            <Button variant="link" size="sm" onClick={clearProject}>
              {t("historyUi.clearProject")}
            </Button>
          </Inline>
        )}
        <Inline gap={3} className="text-sm">
          <CheckField checked={hideAutomated} onChange={setHideAutomated}>
            {t("historyUi.hideAutomated")}
          </CheckField>
          {/* An empty list says it and offers Show them itself (#588). */}
          {hideAutomated && automatedCount > 0 && emptyBecause !== "automated" && (
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
        {failed && (
          <ErrorState
            message={t("historyUi.loadFailed")}
            retryLabel={t("historyUi.retry")}
            // A copy of the applied filters is a new value, so the effect reads once more.
            onRetry={() => setFilter({ ...filter })}
          />
        )}
        {/* Issue #180: an empty list says why: the hidden automated runs, the filters, or nothing yet. */}
        {emptyBecause === "automated" && (
          <EmptyState
            icon={History}
            title={t("historyUi.emptyAutomated", { count: automatedCount })}
            action={
              <Button variant="link" onClick={() => setHideAutomated(false)}>
                {t("historyUi.showAutomated")}
              </Button>
            }
          />
        )}
        {emptyBecause === "filtered" && (
          <EmptyState
            icon={History}
            title={t("historyUi.emptyFiltered")}
            action={
              <Button variant="link" onClick={clearFilters}>
                {t("historyUi.clearFilters")}
              </Button>
            }
          />
        )}
        {emptyBecause === "nothing" && (
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
                  {...(cost === undefined ? {} : { cost: usd(cost, t.lang) })}
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
