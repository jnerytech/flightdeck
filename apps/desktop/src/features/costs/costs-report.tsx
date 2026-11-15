import type { CostsSummary } from "@flightdeck/protocol";
import { Button } from "@/components/ui/button";
import { useFormatNumber, useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { Panel } from "@/shared/layout/index.ts";
import { basename, uniqueKeys } from "@/shared/lib/index.ts";
import { Breakdown } from "./costs-parts.tsx";
import { usd } from "./domain/costs.ts";
import { topModel } from "./domain/costs-scope.ts";

const tokensOf = (t: CostsSummary["totals"]["tokens"]) =>
  t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;

/** The period's totals as tiles, and a line for each model that has no price. */
export function CostsTotals(
  props: Readonly<{ summary: CostsSummary; unpriced: readonly { model: string }[] }>,
) {
  const t = useT();
  const number = useFormatNumber();
  const { summary } = props;
  const top = topModel(summary.byModel);
  return (
    <>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
        {[
          [t("costsUi.estimated"), usd(summary.totals.costUsd, t.lang)],
          [t("costsUi.tokens"), number(tokensOf(summary.totals.tokens))],
          [t("costsUi.cacheSavings"), usd(summary.totals.cacheSavingsUsd, t.lang)],
          ...(top ? [[t("costsUi.topModel"), `${top.model} · ${usd(top.costUsd, t.lang)}`]] : []),
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                label === t("costsUi.topModel") ? "text-base" : "text-xl",
              )}
            >
              <output aria-label={label}>{value}</output>
            </dd>
          </div>
        ))}
      </dl>
      {props.unpriced.map((u) => (
        <p key={u.model} className="text-muted-foreground text-xs">
          {t("costsUi.unpriced", { model: u.model })}
        </p>
      ))}
    </>
  );
}

/** Where the period's spend went: by project, client, model, origin and persona. */
export function CostsBreakdowns(
  props: Readonly<{
    summary: CostsSummary;
    projectName(key: string): string;
    /** The split by client; empty when it is not shown (one client, or no client scope). */
    byClient: readonly { name: string; costUsd: number }[];
    /** The host offers personas: the split by persona is shown. */
    withPersonas: boolean;
    personaName(id: string | null): string;
  }>,
) {
  const t = useT();
  const { summary, byClient, projectName } = props;
  return (
    <div className="grid gap-4 @3xl:grid-cols-3">
      <Breakdown
        name={t("costsUi.byProject")}
        rows={summary.byProject.map((p) => ({
          id: p.projectKey,
          label: projectName(p.projectKey),
          costUsd: p.costUsd,
        }))}
      />
      {byClient.length > 0 && (
        <Breakdown
          name={t("costsUi.byClient")}
          rows={byClient.map((c) => ({ label: c.name, costUsd: c.costUsd }))}
        />
      )}
      <Breakdown
        name={t("costsUi.byModel")}
        rows={summary.byModel.map((m) => ({ label: m.model, costUsd: m.costUsd }))}
      />
      <Breakdown
        name={t("costsUi.byOrigin")}
        rows={summary.byOrigin.map((o) => ({ label: o.origin, costUsd: o.costUsd }))}
      />
      {props.withPersonas && (
        <Breakdown
          name={t("costsUi.byPersona")}
          rows={summary.byPersona.map((p) => ({
            label: props.personaName(p.persona),
            costUsd: p.costUsd,
          }))}
        />
      )}
    </div>
  );
}

/** The sessions that cost the most in the period; a click opens one. */
export function CostsTopSessions(
  props: Readonly<{
    sessions: CostsSummary["topSessions"];
    projectName(key: string): string;
    onOpen(session: CostsSummary["topSessions"][number]): void;
  }>,
) {
  const t = useT();
  // The same session can come from two hosts: each row needs a key of its own.
  const keys = uniqueKeys(props.sessions.map((s) => s.claudeSessionId));
  return (
    <section aria-label={t("costsUi.top")}>
      <Panel title={t("costsUi.top")}>
        <ul className="flex flex-col">
          {props.sessions.map((s, i) => (
            <li key={keys[i]}>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start whitespace-normal py-1 text-left"
                onClick={() => props.onOpen(s)}
              >
                {`${s.title ?? basename(s.cwd ?? s.claudeSessionId)} · ${props.projectName(s.projectKey)} · ${usd(s.costUsd, t.lang)}`}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}
