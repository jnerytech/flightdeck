import type { KnowledgeEntry, KnowledgeListResult } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Key } from "@/i18n";
import type { AppStore } from "@/lib/app-store";
import { KnowledgeFeedSwitch } from "./knowledge-feed-switch";

type Status = KnowledgeEntry["status"];
const STATUSES: readonly Status[] = ["valid", "transitional", "obsolete", "unclassified"];

/**
 * The project's library of documents (PRDs, RFCs, ADRs, specs) with the status each one says it
 * has (issue #76). Read only; the status is always written out, not only coloured. Hidden by its
 * caller on a host that does not announce `knowledge`.
 */
export function KnowledgePanel(
  props: Readonly<{ store: AppStore; hostId: string; path: string; feed?: boolean }>,
) {
  const { store, hostId, path } = props;
  const { t } = store.i18n;
  const [loaded, setLoaded] = useState<KnowledgeListResult | "failed" | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");

  useEffect(() => {
    let live = true;
    void store.hostCommand(hostId, "knowledge.list", { path }).then((result) => {
      if (live) setLoaded(result ?? "failed");
    });
    return () => {
      live = false;
    };
  }, [store, hostId, path]);

  if (loaded === null) return null;
  const title = t("projectPage.knowledge.title");
  if (loaded === "failed") {
    return (
      <Panel title={title} label={title}>
        <p className="text-sm">{t("projectPage.knowledge.failed")}</p>
      </Panel>
    );
  }
  const count = (status: Status) => loaded.entries.filter((e) => e.status === status).length;
  const shown = loaded.entries.filter((e) => filter === "all" || e.status === filter);
  const word = (status: Status) => t(`projectPage.knowledge.status.${status}` as Key);
  return (
    <Panel title={title} label={title}>
      <p className="text-muted-foreground text-sm">{t("projectPage.knowledge.hint")}</p>
      {props.feed && <KnowledgeFeedSwitch store={store} hostId={hostId} path={path} />}
      {loaded.entries.length === 0 ? (
        <p className="text-sm">{t("projectPage.knowledge.empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(["all", ...STATUSES] as const).map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
              >
                {t("projectPage.knowledge.filter", {
                  status: status === "all" ? t("projectPage.knowledge.all") : word(status),
                  n: status === "all" ? loaded.entries.length : count(status),
                })}
              </Button>
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {shown.map((entry) => (
              <li key={entry.path} className="flex flex-col gap-1 rounded-md border p-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.title}</span>
                  <Badge variant="outline">{word(entry.status)}</Badge>
                  {entry.type && (
                    <span className="text-muted-foreground text-xs">
                      {t(`projectPage.knowledge.type.${entry.type}` as Key)}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground text-xs">
                  {entry.path} ·{" "}
                  {t("projectPage.knowledge.changed", {
                    date: store.formatDateTime(entry.changedAt),
                  })}
                </span>
                {entry.warnings.map((warning) => (
                  <span key={warning} className="text-sm">
                    {t("projectPage.knowledge.referencesObsolete", {
                      path: warning.slice(warning.indexOf(":") + 1),
                    })}
                  </span>
                ))}
                {entry.problems.map((problem) => (
                  <span key={problem} className="text-sm">
                    {t(`projectPage.knowledge.problem.${problem}` as Key)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {loaded.truncated && <p className="text-sm">{t("projectPage.knowledge.truncated")}</p>}
    </Panel>
  );
}
