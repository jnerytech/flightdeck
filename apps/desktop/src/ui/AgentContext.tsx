import type { ContextBudget } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { ListRow } from "@/components/layout/list-row";
import { Stack } from "@/components/layout/stack";
import { LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "../i18n/format.ts";
import type { AppStore } from "../lib/app-store.ts";

/**
 * Phase 26: what enters Claude Code's context when a session starts, source by source, with an
 * estimate of tokens, and what the memory leaves out: only the start of `MEMORY.md` is loaded.
 */
export function AgentContext(props: { store: AppStore; hostId: string; projectId: string }) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const number = (value: number) => formatNumber(value, store.i18n.lang);
  const [budget, setBudget] = useState<ContextBudget | null>(null);

  useEffect(() => {
    void store
      .hostCommand(hostId, "memory.budget", { projectId })
      .then((result) => setBudget(result));
  }, [store, hostId, projectId]);

  if (!budget) return <LoadingState label={t("agent.loading")} />;
  const { memory } = budget;
  const cut = memory.cutBy !== null;
  return (
    <section aria-label={t("contextUi.title")}>
      <Stack>
        <p className="text-sm">{t("contextUi.start", { tokens: number(budget.startTokens) })}</p>
        <Stack as="ul" gap={1}>
          {budget.sources.map((source) => (
            <li key={`${source.kind}/${source.path}`}>
              <ListRow
                leading={<Badge variant="secondary">{t(`contextUi.kind.${source.kind}`)}</Badge>}
                title={<span className="break-all">{source.path}</span>}
                trailing={
                  <span className="text-sm tabular-nums">
                    {source.load === "start" ? t("contextUi.atStart") : t("contextUi.onDemand")} ·{" "}
                    {t("contextUi.tokens", { tokens: number(source.tokens) })}
                  </span>
                }
              />
            </li>
          ))}
        </Stack>
        {memory.indexLines > 0 && (
          <p className="text-sm">
            {t("contextUi.index", {
              loaded: memory.loadedLines,
              total: memory.indexLines,
              bytes: Math.round(memory.loadedBytes / 1024),
              limit: Math.round(memory.limitBytes / 1024),
            })}
          </p>
        )}
        {cut && (
          <InlineNotice tone="error">
            {memory.cutBy === "lines"
              ? t("contextUi.cutLines", { limit: memory.limitLines })
              : t("contextUi.cutBytes", { limit: Math.round(memory.limitBytes / 1024) })}
          </InlineNotice>
        )}
        {memory.leftOutLines.length > 0 && (
          <Stack gap={2}>
            <Stack
              as="ul"
              gap={1}
              label={t("contextUi.leftOutLines")}
              className="font-mono text-xs"
            >
              {memory.leftOutLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </Stack>
            {memory.leftOutFiles.length > 0 && (
              <p className="text-sm">
                {t("contextUi.leftOutFiles", { files: memory.leftOutFiles.join(", ") })}
              </p>
            )}
          </Stack>
        )}
      </Stack>
    </section>
  );
}
