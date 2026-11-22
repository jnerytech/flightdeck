import type { ContextBudget } from "@flightdeck/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { EmptyState, ErrorState, ListRow, LoadingState, Stack } from "@/shared/layout/index.ts";
import { formatNumber } from "../../i18n/format.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { contextPath } from "./domain/file-list.ts";

/**
 * Phase 26: what enters Claude Code's context when a session starts, source by source, with an
 * estimate of tokens, and what the memory leaves out: only the start of `MEMORY.md` is loaded.
 */
export function AgentContext(
  props: Readonly<{ store: AppStore; hostId: string; projectId: string }>,
) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const number = (value: number) => formatNumber(value, store.i18n.lang);
  const [budget, setBudget] = useState<ContextBudget | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the latest ask counts: a late answer of another project or host, or of an earlier try, is dropped.
  const asked = useRef(0);

  const load = useCallback(async () => {
    const mine = ++asked.current;
    setFailed(false);
    setBudget(null);
    const result = await store.hostCommand(hostId, "memory.budget", { projectId });
    if (mine !== asked.current) return;
    if (result) setBudget(result);
    else setFailed(true);
  }, [store, hostId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <ErrorState message={t("agent.loadFailed")} retryLabel={t("agent.retry")} onRetry={load} />
    );
  }
  if (!budget) return <LoadingState label={t("agent.loading")} />;
  const { memory } = budget;
  const cut = memory.cutBy !== null;
  return (
    <section aria-label={t("contextUi.title")}>
      <Stack>
        <p className="text-sm">{t("contextUi.start", { tokens: number(budget.startTokens) })}</p>
        {budget.sources.length === 0 ? (
          <EmptyState title={t("contextUi.noSources")} />
        ) : (
          <Stack as="ul" gap={1} label={t("contextUi.sources")}>
            {budget.sources.map((source) => (
              <li key={`${source.kind}/${source.path}`}>
                <ListRow
                  leading={<Badge variant="secondary">{t(`contextUi.kind.${source.kind}`)}</Badge>}
                  title={
                    <span className="break-all">
                      {contextPath(source.path, budget.root, budget.home)}
                    </span>
                  }
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
        )}
        {memory.indexLines > 0 && (
          <p className="text-sm">
            {t(cut ? "contextUi.index" : "contextUi.indexAll", {
              loaded: memory.loadedLines,
              total: memory.indexLines,
              used:
                memory.loadedBytes < 1024
                  ? t("contextUi.underOne")
                  : t("contextUi.size", { kb: Math.round(memory.loadedBytes / 1024) }),
              limit: Math.round(memory.limitBytes / 1024),
            })}
          </p>
        )}
        {cut && (
          <InlineNotice tone="warn">
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
