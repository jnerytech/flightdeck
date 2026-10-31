import type { ContextBudget } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import type { AppStore } from "../lib/app-store.ts";

/**
 * Phase 26: what enters Claude Code's context when a session starts, source by source, with an
 * estimate of tokens, and what the memory leaves out: only the start of `MEMORY.md` is loaded.
 */
export function AgentContext(props: { store: AppStore; hostId: string; projectId: string }) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
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
    <section aria-label={t("contextUi.title")} className="flex flex-col gap-4">
      <p className="text-sm">{t("contextUi.start", { tokens: budget.startTokens })}</p>
      <table className="w-full text-left text-sm tabular-nums">
        <tbody>
          {budget.sources.map((source) => (
            <tr key={`${source.kind}/${source.path}`} className="border-t first:border-t-0">
              <td className="py-1 pr-2">
                <Badge variant="secondary">{t(`contextUi.kind.${source.kind}`)}</Badge>
              </td>
              <td className="break-all py-1 pr-2">{source.path}</td>
              <td className="py-1 pr-2 text-right">
                {t("contextUi.tokens", { tokens: source.tokens })}
              </td>
              <td className="py-1">
                {source.load === "start" ? t("contextUi.atStart") : t("contextUi.onDemand")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <div className="flex flex-col gap-2">
          <ul
            aria-label={t("contextUi.leftOutLines")}
            className="flex flex-col gap-1 font-mono text-xs"
          >
            {memory.leftOutLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {memory.leftOutFiles.length > 0 && (
            <p className="text-sm">
              {t("contextUi.leftOutFiles", { files: memory.leftOutFiles.join(", ") })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
