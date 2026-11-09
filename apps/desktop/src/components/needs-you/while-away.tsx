import type { ReactNode } from "react";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { formatAgo } from "../../i18n/format.ts";
import type { Key, T } from "../../i18n/index.ts";
import { type AppStore, sessionKey } from "../../lib/app-store.ts";
import type { AwayNews, AwayView } from "../../lib/away-summary.ts";
import { reasonText } from "../../lib/notice-text.ts";
import { basename } from "../../lib/paths.ts";
import type { Route } from "../../lib/router.ts";

/** Lines shown per group; the rest is counted ("and 3 more"), and the host's own screens hold it. */
const SHOWN = 3;

/** One group of a host's news: a heading with its true total, the first lines, and what is left. */
function Group(
  props: Readonly<{
    t: T;
    title: string;
    /** The host's true count; `lines` may hold fewer. */
    total: number;
    /** The lines, newest first, each with the id of what it names. */
    lines: Array<{ key: string; node: ReactNode }>;
  }>,
) {
  const { t, total } = props;
  if (total === 0) return null;
  const shown = props.lines.slice(0, SHOWN);
  const more = total - shown.length;
  return (
    <Stack gap={1}>
      <h4 className="font-medium text-xs">{t("away.group", { title: props.title, n: total })}</h4>
      <Stack as="ul" gap={1}>
        {shown.map((line) => (
          <li key={line.key}>{line.node}</li>
        ))}
        {more > 0 && (
          <li className="text-muted-foreground text-xs">{t("away.more", { n: more })}</li>
        )}
      </Stack>
    </Stack>
  );
}

/** A line that goes to what it names; plain text when there is nowhere to go. */
function Line(props: Readonly<{ text: string; to: Route | null; go(route: Route): void }>) {
  const { to } = props;
  if (!to) return <span className="text-sm">{props.text}</span>;
  return (
    <Button
      variant="link"
      className="h-auto min-h-6 whitespace-normal p-0 text-left text-sm"
      onClick={() => props.go(to)}
    >
      {props.text}
    </Button>
  );
}

/** What one host did while the app was closed. */
function HostNews(props: Readonly<{ store: AppStore; news: AwayNews; go(route: Route): void }>) {
  const { store, news, go } = props;
  const { t } = store.i18n;
  const { hostId, result } = news;
  const card = (cardId: string, projectId: string): Route => ({
    name: "card",
    host: hostId,
    projectId,
    cardId,
  });
  /** A failed run's line; a plain function, so the group takes the node and not a component. */
  const runLine = (run: (typeof result.failedRuns.items)[number]) => {
    const known = store.getState().cards[sessionKey(hostId, run.cardId)];
    const reason = reasonText(t, "", run.reasonKey, run.reasonParams);
    const text = reason ? t("away.run", { workflow: run.workflowName, reason }) : run.workflowName;
    // A card the app has not loaded opens by the project the run carries; an older host sends none.
    const projectId = known?.projectId ?? run.projectId;
    return <Line text={text} to={projectId ? card(run.cardId, projectId) : null} go={go} />;
  };
  const quota = result.quota
    .filter((window) => window.utilization !== null)
    .map((window) => {
      const known = window.window === "five_hour" || window.window === "seven_day";
      const label = known ? t(`quota.windows.${window.window}` as Key) : window.window;
      return t("away.quotaLine", {
        window: label,
        pct: Math.round((window.utilization ?? 0) * 100),
      });
    });
  return (
    <Stack gap={2}>
      <h3 className="font-semibold text-sm">{news.hostName}</h3>
      <Group
        t={t}
        title={t("away.sessions")}
        total={result.sessions.total}
        lines={result.sessions.items.map((s) => ({
          key: s.id,
          node: (
            <Line
              text={s.name ?? basename(s.cwd)}
              to={{ name: "session", host: hostId, id: s.id }}
              go={go}
            />
          ),
        }))}
      />
      <Group
        t={t}
        title={t("away.review")}
        total={result.reviewCards.total}
        lines={result.reviewCards.items.map((c) => ({
          key: c.cardId,
          node: <Line text={c.title} to={card(c.cardId, c.projectId)} go={go} />,
        }))}
      />
      <Group
        t={t}
        title={t("away.prs")}
        total={result.prs.total}
        lines={result.prs.items.map((p) => ({
          key: p.cardId,
          node: (
            <Line
              text={t(p.outcome === "merged" ? "away.merged" : "away.checksFailed", {
                title: p.title,
              })}
              to={card(p.cardId, p.projectId)}
              go={go}
            />
          ),
        }))}
      />
      <Group
        t={t}
        title={t("away.runs")}
        total={result.failedRuns.total}
        lines={result.failedRuns.items.map((run) => ({ key: run.runId, node: runLine(run) }))}
      />
      {quota.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {t("away.quota", { windows: quota.join(", ") })}
        </p>
      )}
    </Stack>
  );
}

/**
 * "While you were away" (#1344): per host, the sessions that finished, the cards that reached
 * review, the PRs merged or with failing checks, and the failed runs since the app was last active,
 * each a way to the thing; a host that did not answer is named. Read-only: Dismiss closes it.
 */
export function WhileAway(
  props: Readonly<{ store: AppStore; view: AwayView; go(route: Route): void }>,
) {
  const { store, view, go } = props;
  const { t } = store.i18n;
  return (
    <section
      aria-label={t("away.title")}
      data-slot="while-away"
      className="max-h-[45%] overflow-y-auto border-b p-4"
    >
      <Stack gap={3}>
        <Inline gap={2}>
          <h2 className="font-semibold text-base">{t("away.title")}</h2>
          <span className="text-muted-foreground text-xs">
            {t("away.lastActive", { ago: formatAgo(store.now() - Date.parse(view.since), t) })}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => store.dismissAway()}>
            {t("away.dismiss")}
          </Button>
        </Inline>
        {view.news.map((news) => (
          <HostNews key={news.hostId} store={store} news={news} go={go} />
        ))}
        {view.unreached.map((host) => (
          <p key={host} role="note" className="text-sm">
            {t("away.unreached", { host })}
          </p>
        ))}
      </Stack>
    </section>
  );
}
