import type {
  BoardColumn,
  BoardSyncBoard,
  BoardSyncLogEntry,
  BoardSyncStatus,
} from "@flightdeck/protocol";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { NativeSelect } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import { formatDateTime } from "@/i18n/format";
import type { Key, T } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";

const COLUMNS: readonly BoardColumn[] = ["backlog", "in_progress", "waiting", "review", "done"];

type Refusal = {
  code: string;
  message: string;
  reason?: string;
  params?: Record<string, string | number>;
};

/**
 * The Sync control of a project's board (phase 38): link it to an external board, see where the
 * sync stands, edit which column each status puts a card in, and decide whether the moves made
 * here are sent back. The host talks to the provider; nothing here sees a token.
 */
export function BoardSyncControl(props: { store: AppStore; hostId: string; projectId: string }) {
  const { store, hostId, projectId } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<BoardSyncStatus | null>(null);
  const [boards, setBoards] = useState<BoardSyncBoard[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [askPush, setAskPush] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const say = useCallback(
    (refusal: Refusal) =>
      setError(
        refusalText(refusal.code, refusal.message, t, {
          ...(refusal.reason ? { reason: refusal.reason } : {}),
          ...(refusal.params ? { params: refusal.params } : {}),
        }),
      ),
    [t],
  );

  /** The answer of a command; a refusal is said in the dialog and gives null. */
  const ask = useCallback(
    async <R,>(
      run: () => Promise<({ ok: true; data: R } & object) | ({ ok: false } & Refusal)>,
    ): Promise<R | null> => {
      const result = await run();
      if (result.ok) {
        setError(null);
        return result.data;
      }
      say(result);
      return null;
    },
    [say],
  );

  const show = useCallback((next: BoardSyncStatus) => {
    setStatus(next);
    setDraft(
      Object.fromEntries(
        (next.statusOptions ?? []).map((name) => [name, next.columnMap?.[name] ?? ""]),
      ),
    );
  }, []);

  const load = useCallback(async () => {
    const current = await ask(() => store.hostRequest(hostId, "boardsync.status", { projectId }));
    if (!current) return;
    show(current);
    if (!current.linked) {
      const found = await ask(() => store.hostRequest(hostId, "boardsync.boards", {}));
      setBoards(found?.boards ?? []);
    }
  }, [ask, show, store, hostId, projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const link = async () => {
    if (!picked) return;
    const next = await ask(() =>
      store.hostRequest(hostId, "boardsync.link", { projectId, boardId: picked }),
    );
    if (next) show(next);
  };
  const syncNow = async () => {
    const done = await ask(() => store.hostRequest(hostId, "boardsync.syncNow", { projectId }));
    if (done) show(done.status);
  };
  const saveMap = async () => {
    // Keys that are not statuses of the board (the "No status" entry) are kept as they are.
    const known = new Set(status?.statusOptions ?? []);
    const kept = Object.entries(status?.columnMap ?? {}).filter(([name]) => !known.has(name));
    const columnMap = Object.fromEntries([
      ...kept,
      ...Object.entries(draft).filter(([, column]) => column !== ""),
    ]) as Record<string, BoardColumn>;
    const next = await ask(() =>
      store.hostRequest(hostId, "boardsync.setMap", { projectId, columnMap }),
    );
    if (next) show(next);
  };
  const setPush = async (push: boolean) => {
    const next = await ask(() =>
      store.hostRequest(hostId, "boardsync.setPush", { projectId, push, confirm: push }),
    );
    if (next) {
      show(next);
      setAskPush(false);
    }
  };
  const unlink = async () => {
    const done = await ask(() => store.hostRequest(hostId, "boardsync.unlink", { projectId }));
    if (done !== null || !error) {
      setAskPush(false);
      await load();
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RefreshCw aria-hidden="true" />
        {t("boardSyncUi.button")}
      </Button>
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("boardSyncUi.title")}</DialogTitle>
              <DialogDescription>{t("boardSyncUi.description")}</DialogDescription>
            </DialogHeader>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            {status && !status.linked && (
              <section className="find-block">
                <p className="text-sm">{t("boardSyncUi.notLinked")}</p>
                {boards.length === 0 && (
                  <p className="text-muted-foreground text-sm">{t("boardSyncUi.noBoards")}</p>
                )}
                <ul aria-label={t("boardSyncUi.boards")} className="check-list">
                  {boards.map((candidate) => (
                    <li key={candidate.id}>
                      <label className="check-line">
                        <input
                          type="radio"
                          name="board-sync-board"
                          className="hit-control"
                          checked={picked === candidate.id}
                          onChange={() => setPicked(candidate.id)}
                        />
                        <span className="text-sm">
                          {candidate.title} ({candidate.owner})
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <ActionButton
                  size="sm"
                  disabled={!picked}
                  disabledReason={t("boardSyncUi.boards")}
                  onClick={link}
                >
                  {t("boardSyncUi.link")}
                </ActionButton>
              </section>
            )}
            {status?.linked && (
              <>
                <section className="find-block">
                  <p className="font-medium text-sm">
                    {t("boardSyncUi.linked", { title: status.boardTitle ?? "" })}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {status.lastSyncedAt
                      ? t("boardSyncUi.lastSynced", {
                          when: formatDateTime(status.lastSyncedAt, t.lang),
                        })
                      : t("boardSyncUi.never")}
                  </p>
                  {status.pausedUntil && (
                    <p className="text-xs">
                      {t("boardSyncUi.paused", {
                        when: formatDateTime(status.pausedUntil, t.lang),
                      })}
                    </p>
                  )}
                  {status.lastError && (
                    <p className="text-xs">
                      {t("boardSyncUi.lastError", { error: status.lastError })}
                    </p>
                  )}
                  {status.truncated && <InlineNotice>{t("boardSyncUi.truncated")}</InlineNotice>}
                  <div className="flex gap-2">
                    <ActionButton size="sm" variant="outline" onClick={syncNow}>
                      {t("boardSyncUi.syncNow")}
                    </ActionButton>
                    <ActionButton size="sm" variant="ghost" onClick={unlink}>
                      {t("boardSyncUi.unlink")}
                    </ActionButton>
                  </div>
                </section>
                <section aria-label={t("boardSyncUi.mapTitle")} className="find-block">
                  <p className="font-medium text-sm">{t("boardSyncUi.mapTitle")}</p>
                  <p className="text-muted-foreground text-xs">{t("boardSyncUi.mapHint")}</p>
                  {(status.statusOptions ?? []).map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="w-32 text-sm">{name}</span>
                      <NativeSelect
                        aria-label={name}
                        value={draft[name] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
                      >
                        <option value="">{t("boardSyncUi.notMapped")}</option>
                        {COLUMNS.map((column) => (
                          <option key={column} value={column}>
                            {t(`kanban.columns.${column}` as Key)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  ))}
                  <div>
                    <ActionButton size="sm" variant="outline" onClick={saveMap}>
                      {t("boardSyncUi.saveMap")}
                    </ActionButton>
                  </div>
                </section>
                <section className="find-block">
                  <label className="check-line">
                    <input
                      type="checkbox"
                      className="hit-control"
                      checked={status.push === true}
                      onChange={(e) => (e.target.checked ? setAskPush(true) : void setPush(false))}
                    />
                    <span className="text-sm">{t("boardSyncUi.push")}</span>
                  </label>
                  <p className="text-muted-foreground text-xs">{t("boardSyncUi.pushHint")}</p>
                  {askPush && !status.push && (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm">{t("boardSyncUi.pushConfirm")}</p>
                      <div className="flex gap-2">
                        <ActionButton size="sm" onClick={() => setPush(true)}>
                          {t("boardSyncUi.pushConfirmButton")}
                        </ActionButton>
                        <Button size="sm" variant="ghost" onClick={() => setAskPush(false)}>
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** One line of a card's sync log, in the app's language. */
export function logLine(entry: BoardSyncLogEntry, t: T): string {
  const at = (iso: string | null) => (iso ? formatDateTime(iso, t.lang) : "");
  const vars = {
    lost: entry.lostValue ?? "",
    lostAt: at(entry.lostAt),
    kept: entry.keptValue ?? "",
    keptAt: at(entry.keptAt),
    detail: entry.detail ?? "",
  };
  switch (entry.kind) {
    case "conflict":
      return entry.winner === "local"
        ? t("boardSyncUi.logConflictLocal", vars)
        : t("boardSyncUi.logConflictExternal", vars);
    case "move_skipped":
      return t("boardSyncUi.logMoveSkipped", vars);
    case "push_failed":
      return t("boardSyncUi.logPushFailed", vars);
    case "push_gave_up":
      return t("boardSyncUi.logPushGaveUp", vars);
    case "title_changed":
      return t("boardSyncUi.logTitleChanged", vars);
    default:
      return entry.kind;
  }
}

/** The card's sync log: what a conflict gave up, a move that was not made, a push that failed. */
export function CardSyncLog(props: { store: AppStore; hostId: string; cardId: string }) {
  const { store, hostId, cardId } = props;
  const t = useT();
  const [entries, setEntries] = useState<BoardSyncLogEntry[] | null>(null);
  useEffect(() => {
    void store.hostRequest(hostId, "boardsync.log", { cardId }).then((result) => {
      if (result.ok) setEntries(result.data.entries);
    });
  }, [store, hostId, cardId]);
  if (entries === null) return null;
  return (
    <section aria-label={t("boardSyncUi.log")} className="flex flex-col gap-1">
      <p className="font-medium text-sm">{t("boardSyncUi.log")}</p>
      {entries.length === 0 && (
        <p className="text-muted-foreground text-xs">{t("boardSyncUi.logEmpty")}</p>
      )}
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li
            key={`${entry.at}-${entry.kind}-${entry.detail ?? ""}-${entry.keptValue ?? ""}`}
            className="text-xs"
          >
            {logLine(entry, t)}
          </li>
        ))}
      </ul>
    </section>
  );
}
