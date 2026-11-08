import type { KnowledgeEntry, KnowledgeListResult, KnowledgeStatus } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Key } from "@/i18n";
import { refusalText } from "@/i18n/errors";
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
  props: Readonly<{
    store: AppStore;
    hostId: string;
    path: string;
    feed?: boolean;
    /** The host announces `knowledgeStatus`: a document's status can be changed here. */
    status?: boolean;
    /** The project on the board: a spec can become a card of it (#78, S-T2). */
    projectId?: string;
    /** Opens a card the panel made. */
    onOpenCard?(cardId: string): void;
  }>,
) {
  const { store, hostId, path } = props;
  const { t } = store.i18n;
  const [loaded, setLoaded] = useState<KnowledgeListResult | "failed" | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // The specs a card is being made from: a second click waits, so it makes no second card. The ref
  // answers at once (two clicks in one tick); the state disables the button.
  const busy = useRef(new Set<string>());
  const [making, setMaking] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let live = true;
    void store.hostCommand(hostId, "knowledge.list", { path }).then((result) => {
      if (live) setLoaded(result ?? "failed");
    });
    return () => {
      live = false;
    };
  }, [store, hostId, path]);

  const reload = () => {
    void store.hostCommand(hostId, "knowledge.list", { path }).then((result) => {
      setLoaded(result ?? "failed");
    });
  };
  // Issue #78, S-T2: a spec becomes a card that names it, so its first start reads it first and
  // works test first. A card the host refuses is not named; the banner says why.
  const makeCard = async (entry: KnowledgeEntry, projectId: string) => {
    if (busy.current.has(entry.path)) return;
    busy.current.add(entry.path);
    setMaking(new Set(busy.current));
    try {
      await makeCardOf(entry, projectId);
    } finally {
      busy.current.delete(entry.path);
      setMaking(new Set(busy.current));
    }
  };
  const makeCardOf = async (entry: KnowledgeEntry, projectId: string) => {
    const made = await store.hostCommand(hostId, "card.create", {
      projectId,
      title: entry.title,
      description: "",
    });
    if (!made) return;
    // The card exists either way: when it could not be pointed at the spec (the banner says why),
    // the person is told so and can open it to set the path, instead of making a second card.
    const named = await store.hostCommand(hostId, "card.update", {
      cardId: made.id,
      specPath: entry.path,
    });
    const open = props.onOpenCard;
    const key = named ? "projectPage.knowledge.cardMade" : "projectPage.knowledge.cardMadeNoSpec";
    store.success(
      t(key, { title: made.title }),
      open ? { label: t("kanban.openCard"), run: () => open(made.id) } : undefined,
    );
  };
  // The file is written by the host only if it is as the list showed it; a refusal says why, and
  // the list is read again so the next try has what the file is now.
  const change = async (entry: KnowledgeEntry, status: KnowledgeStatus) => {
    const result = await store.hostRequest(hostId, "knowledge.setStatus", {
      path,
      file: entry.path,
      status,
      expectedHash: entry.hash,
    });
    setNote(
      result.ok
        ? {
            ok: true,
            text: t("projectPage.knowledge.setStatus.changed", {
              title: entry.title,
              status: t(`projectPage.knowledge.status.${status}` as Key),
            }),
          }
        : {
            ok: false,
            text: t("projectPage.knowledge.setStatus.failed", {
              why: refusalText(result.code, result.message, t, result),
            }),
          },
    );
    reload();
  };

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
      {/* With no document there is no status to change (#1050). */}
      {props.status && loaded.entries.length > 0 && (
        <p className="text-muted-foreground text-sm">{t("projectPage.knowledge.setStatus.hint")}</p>
      )}
      {note && (
        <p role={note.ok ? "status" : "alert"} className="text-sm">
          {note.text}
        </p>
      )}
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
                  {props.status && (
                    <select
                      aria-label={t("projectPage.knowledge.setStatus.label", {
                        title: entry.title,
                      })}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={entry.status === "unclassified" ? "" : entry.status}
                      onChange={(event) =>
                        void change(entry, event.target.value as KnowledgeStatus)
                      }
                    >
                      {entry.status === "unclassified" && (
                        <option value="" disabled>
                          {word("unclassified")}
                        </option>
                      )}
                      {(["valid", "transitional", "obsolete"] as const).map((status) => (
                        <option key={status} value={status}>
                          {word(status)}
                        </option>
                      ))}
                    </select>
                  )}
                  {entry.type && (
                    <span className="text-muted-foreground text-xs">
                      {t(`projectPage.knowledge.type.${entry.type}` as Key)}
                    </span>
                  )}
                  {entry.type === "spec" && props.projectId && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("projectPage.knowledge.makeCardOf", { title: entry.title })}
                      disabled={making.has(entry.path)}
                      onClick={() => void makeCard(entry, props.projectId as string)}
                    >
                      {t("projectPage.knowledge.makeCard")}
                    </Button>
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
