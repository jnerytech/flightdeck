import type { KnowledgeEntry, KnowledgeListResult, KnowledgeStatus } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Panel } from "@/components/layout/panel";
import { LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Key } from "@/i18n";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";
import { KnowledgeCreate } from "./knowledge-create";
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
    /** The host announces `knowledgeCreate`: a document can be started from a template here. */
    create?: boolean;
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
  const [note, setNote] = useState<{
    id: number;
    ok: boolean;
    text: string;
    title?: string;
    open?: () => void;
  } | null>(null);
  // The specs a card is being made from: a second click waits, so it makes no second card. The ref
  // answers at once (two clicks in one tick); the state disables the button.
  const busy = useRef(new Set<string>());
  // The status each document's picker shows when it is not the file's own yet, by path.
  // Each note gets a number: the same words said twice are a new node, so they are read twice.
  const said = useRef(0);
  const [chosen, setChosen] = useState<Readonly<Record<string, KnowledgeStatus>>>({});
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
  // A write is on its way until the list read again shows it: a second press (a double click, a held
  // Enter) comes before the host answers and would write with the hash the first one used up.
  const writing = useRef(new Set<string>());
  const pickers = useRef(new Map<string, HTMLSelectElement>());
  const filters = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  // Try again keeps the failed view on screen (the button is where the focus is) until the host answers.
  const [retrying, setRetrying] = useState(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const refocusRetry = useRef(false);
  // Once the list is read again: a choice the file now agrees with is done, and the focus goes back to
  // the picker of the document that was changed (or to the filter in use, when it no longer fits).
  useEffect(() => {
    if (loaded === null || loaded === "failed") return;
    writing.current.clear();
    setChosen((now) => {
      const kept = Object.entries(now).filter(
        ([file, status]) => loaded.entries.find((e) => e.path === file)?.status !== status,
      );
      return kept.length === Object.keys(now).length ? now : Object.fromEntries(kept);
    });
    const wanted = refocus.current;
    if (wanted === null) return;
    refocus.current = null;
    (
      pickers.current.get(wanted) ??
      filters.current?.querySelector<HTMLElement>("[aria-pressed='true']")
    )?.focus();
  }, [loaded]);
  // After a retry the focus is on the button if it failed again, else on the first filter.
  useEffect(() => {
    if (retrying || !refocusRetry.current) return;
    refocusRetry.current = false;
    (retryButton.current ?? filters.current?.querySelector<HTMLElement>("button"))?.focus();
  }, [retrying]);
  const retry = async () => {
    setRetrying(true);
    const result = await store.hostCommand(hostId, "knowledge.list", { path });
    refocusRetry.current = true;
    setLoaded(result ?? "failed");
    setRetrying(false);
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
    // Said here, where the person pressed the button, with a way to open the card.
    setNote({
      id: ++said.current,
      ok: true,
      text: t(key, { title: made.title }),
      title: made.title,
      ...(open ? { open: () => open(made.id) } : {}),
    });
  };
  // The file is written by the host only if it is as the list showed it; a refusal says why, and
  // the list is read again so the next try has what the file is now.
  const change = async (entry: KnowledgeEntry, status: KnowledgeStatus) => {
    if (writing.current.has(entry.path)) return;
    writing.current.add(entry.path);
    const result = await store.hostRequest(hostId, "knowledge.setStatus", {
      path,
      file: entry.path,
      status,
      expectedHash: entry.hash,
    });
    if (result.ok) refocus.current = entry.path;
    else writing.current.delete(entry.path);
    setNote(
      result.ok
        ? {
            id: ++said.current,
            ok: true,
            text: t("projectPage.knowledge.setStatus.changed", {
              title: entry.title,
              status: t(`projectPage.knowledge.status.${status}` as Key),
            }),
          }
        : {
            id: ++said.current,
            ok: false,
            text: t("projectPage.knowledge.setStatus.failed", {
              why: refusalText(result.code, result.message, t, result),
            }),
          },
    );
    reload();
  };

  const title = t("projectPage.knowledge.title");
  if (loaded === null) {
    return (
      <Panel title={title} label={title}>
        <LoadingState label={t("projectPage.knowledge.loading")} />
      </Panel>
    );
  }
  if (loaded === "failed") {
    return (
      <Panel title={title} label={title}>
        <InlineNotice tone="error">
          <span>{t("projectPage.knowledge.failed")}</span>{" "}
          <span>{t("projectPage.knowledge.failedHint")}</span>
        </InlineNotice>
        <Button
          ref={retryButton}
          type="button"
          size="sm"
          variant="outline"
          className="self-start aria-disabled:pointer-events-none aria-disabled:opacity-50"
          aria-disabled={retrying || undefined}
          onClick={() => {
            if (!retrying) void retry();
          }}
        >
          {t("projectPage.knowledge.retry")}
        </Button>
        {retrying && <LoadingState label={t("projectPage.knowledge.loading")} />}
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
      {props.create && (
        <KnowledgeCreate store={store} hostId={hostId} path={path} onCreated={reload} />
      )}
      {/* The live region for what worked stays in the page: one inserted with its text is often not read. */}
      <div data-slot="knowledge-note" role="status" className="empty:-mb-3">
        {note?.ok && (
          <p key={note.id} className="flex flex-wrap items-center gap-2 text-sm">
            {note.text}
            {note.open && note.title !== undefined && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={t("projectPage.knowledge.openMade", { title: note.title })}
                onClick={note.open}
              >
                {t("kanban.openCard")}
              </Button>
            )}
          </p>
        )}
      </div>
      {note && !note.ok && (
        <p role="alert" className="text-sm">
          {note.text}
        </p>
      )}
      {loaded.entries.length === 0 ? (
        <p className="text-sm">{t("projectPage.knowledge.empty")}</p>
      ) : (
        <>
          <div ref={filters} className="flex flex-wrap gap-2">
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
                      ref={(el) => {
                        if (el) pickers.current.set(entry.path, el);
                        else pickers.current.delete(entry.path);
                      }}
                      aria-label={t("projectPage.knowledge.setStatus.label", {
                        title: entry.title,
                      })}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={
                        chosen[entry.path] ?? (entry.status === "unclassified" ? "" : entry.status)
                      }
                      // Choosing only picks: an arrow key on a closed select fires a change for each
                      // value it passes, and each would write the file (#1089).
                      onChange={(event) => {
                        const next = event.target.value as KnowledgeStatus;
                        setChosen((now) => ({ ...now, [entry.path]: next }));
                      }}
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
                  {props.status && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("projectPage.knowledge.setStatus.applyLabel", {
                        title: entry.title,
                      })}
                      disabled={
                        chosen[entry.path] === undefined || chosen[entry.path] === entry.status
                      }
                      onClick={() => {
                        const next = chosen[entry.path];
                        if (next !== undefined) void change(entry, next);
                      }}
                    >
                      {t("projectPage.knowledge.setStatus.apply")}
                    </Button>
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
                      // Unavailable, not disabled: the button keeps the focus while the card is made.
                      aria-disabled={making.has(entry.path) || undefined}
                      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
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
