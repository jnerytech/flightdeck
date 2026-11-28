import type { RewindPreview, SnapshotFiles, SnapshotInfo } from "@flightdeck/protocol";
import { GitBranch, History, Undo2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { type Turn, turnsOf } from "@/features/sessions/index.ts";
import { ActionButton, IconActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { EmptyState, ErrorState, Inline, LoadingState } from "@/shared/layout/index.ts";
import { refusalText } from "../../i18n/errors.ts";
import { formatDateTime } from "../../i18n/format.ts";
import type { AppStore } from "../../lib/app-store.ts";
import {
  ForkDialog,
  type Refused,
  RewindDialog,
  type Target,
  UndoDialog,
} from "./checkpoint-dialogs.tsx";
import { TurnPrompt } from "./turn-prompt.tsx";

/** One turn: its prompt, time and files, and the two actions. */
function TurnRow(
  props: Readonly<{
    store: AppStore;
    turn: Turn;
    busy: boolean;
    /** The id of the panel's busy notice, which says why the rewind is off. */
    busyId: string;
    files: SnapshotFiles | undefined;
    /** The last read of this turn's files was refused. */
    filesFailed: boolean;
    onToggle(): Promise<void>;
    onRewind(): void;
    onFork(): void;
  }>,
) {
  const { store, turn } = props;
  const { t } = store.i18n;
  const noUuidId = useId();
  const filesId = useId();
  const summary = {
    changed: t("timeline.changed"),
    unchanged: t("timeline.unchanged"),
    running: t("timeline.running"),
    unknown: t("timeline.unknown"),
  }[turn.files];
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t("timeline.turn", { n: turn.ordinal })}</Badge>
        <time className="text-muted-foreground text-xs" dateTime={turn.createdAt}>
          {formatDateTime(turn.createdAt, store.i18n.lang)}
        </time>
        <Badge variant={turn.files === "changed" ? "secondary" : "outline"}>{summary}</Badge>
      </div>
      <TurnPrompt store={store} prompt={turn.prompt} />
      {turn.files === "changed" && (
        <div className="flex flex-col gap-1">
          <ActionButton
            variant="ghost"
            size="sm"
            className="self-start"
            aria-expanded={Boolean(props.files)}
            aria-controls={props.files ? filesId : undefined}
            onClick={props.onToggle}
          >
            {props.files
              ? t("timeline.hideFiles", { n: turn.ordinal })
              : t("timeline.showFiles", { n: turn.ordinal })}
          </ActionButton>
          {props.filesFailed && (
            <InlineNotice tone="error">
              <span>{t("timeline.filesFailed", { n: turn.ordinal })}</span>{" "}
              <ActionButton variant="outline" size="sm" onClick={props.onToggle}>
                {t("timeline.retry")}
              </ActionButton>
            </InlineNotice>
          )}
          {props.files && (
            <ul
              id={filesId}
              aria-label={t("timeline.filesOf", { n: turn.ordinal })}
              className="flex flex-col gap-1"
            >
              {props.files.files.map((file) => (
                <li key={file.path} className="flex flex-wrap items-center gap-2">
                  <code className="break-all">{file.path}</code>
                  <span className="text-muted-foreground text-xs">
                    {t(`timeline.change.${file.change as "modified" | "created" | "deleted"}`)}
                  </span>
                </li>
              ))}
              <li className="text-muted-foreground text-xs tabular-nums">
                {t("timeline.lines", {
                  added: props.files.insertions,
                  removed: props.files.deletions,
                })}
              </li>
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={props.busy}
          aria-describedby={props.busy ? props.busyId : undefined}
          aria-label={t("timeline.rewindTurn", { n: turn.ordinal })}
          onClick={props.onRewind}
        >
          <Undo2 aria-hidden="true" />
          {t("timeline.rewind")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={turn.uuid === null}
          aria-describedby={turn.uuid === null ? noUuidId : undefined}
          aria-label={t("timeline.forkTurn", { n: turn.ordinal })}
          onClick={props.onFork}
        >
          <GitBranch aria-hidden="true" />
          {t("timeline.fork")}
        </Button>
      </div>
      {turn.uuid === null && (
        <p id={noUuidId} className="text-muted-foreground text-xs">
          {t("timeline.noUuid")}
        </p>
      )}
    </li>
  );
}

/** The turns of a session and what can be done from each one. */
function TimelinePanel(props: Target & { busy: boolean; onOpenSession(sessionId: string): void }) {
  const { store, hostId, claudeSessionId } = props;
  const { t } = store.i18n;
  const busyId = useId();
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  // The last load was refused: the sheet says why and offers a new try, instead of loading for ever
  // (or, after a rewind, of showing the list from before as if it were current).
  const [failure, setFailure] = useState<Refused | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<Record<number, SnapshotFiles>>({});
  // The turns whose files the host refused to read: the row says so and offers a new try.
  const [filesFailed, setFilesFailed] = useState<Record<number, true>>({});
  const [rewinding, setRewinding] = useState<Turn | null>(null);
  const [forking, setForking] = useState<Turn | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Each result is a new notice, not the old text kept: a live region speaks what is put in it, so
  // two rewinds to the same turn say the same words twice (#4530).
  const [noticeId, setNoticeId] = useState(0);
  const say = (words: string) => {
    setNotice(words);
    setNoticeId((id) => id + 1);
  };
  // What the host would restore by an undo, from its own safety snapshot: the Undo is offered only
  // while it lists files, so it also survives the sheet closing and a fork that rewound (#4036).
  const [undoPreview, setUndoPreview] = useState<RewindPreview | null>(null);
  const [undoing, setUndoing] = useState(false);
  const undoable = (undoPreview?.files.length ?? 0) > 0;
  const scroll = useRef<HTMLDivElement>(null);
  const loaded = snapshots !== null;

  const loads = useRef(0);
  // The control a person pressed is gone once the load ends: the focus goes on to the list or to Try again.
  const refocus = useRef(false);
  const errorBox = useRef<HTMLDivElement>(null);

  // A refusal comes back to the panel, which tells it once: through `hostCommand` it would also go to the banner.
  const load = useCallback(async () => {
    const id = ++loads.current;
    setFailure(null);
    setLoading(true);
    const result = await store.hostRequest(hostId, "snapshots.list", { claudeSessionId });
    // An answer to an older load must not overwrite a newer one (a rewind or an undo reloads).
    if (id !== loads.current) return;
    if (!result.ok) {
      setFailure(result);
      setLoading(false);
      return;
    }
    setSnapshots(result.data.snapshots);
    setLoading(false);
    // A refusal (an older host, a session with no rewind) is no error: there is just no Undo.
    const preview = await store.hostRequest(hostId, "rewind.undoPreview", { claudeSessionId });
    if (id === loads.current) setUndoPreview(preview.ok ? preview.data : null);
  }, [store, hostId, claudeSessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading || !refocus.current) return;
    refocus.current = false;
    (failure ? errorBox.current?.querySelector("button") : scroll.current)?.focus();
  }, [loading, failure]);

  const retry = () => {
    refocus.current = true;
    void load();
  };

  // The list opens at the newest turn, which is the one a person came to act on (#4037).
  useEffect(() => {
    if (loaded && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [loaded]);

  const toggle = async (turn: Turn) => {
    if (files[turn.n]) {
      setFiles(({ [turn.n]: _closed, ...rest }) => rest);
      return;
    }
    // The row says a refusal itself: through `hostCommand` it would also go to the banner (#4529).
    const result = await store.hostRequest(hostId, "snapshots.files", {
      claudeSessionId,
      n: turn.n,
    });
    if (result.ok) {
      setFiles((all) => ({ ...all, [turn.n]: result.data }));
      setFilesFailed(({ [turn.n]: _read, ...rest }) => rest);
    } else setFilesFailed((all) => ({ ...all, [turn.n]: true }));
  };

  const rewound = (turn: Turn) => {
    say(t("timeline.rewound", { n: turn.ordinal }));
    void load();
  };

  const undone = () => {
    say(t("timeline.undone"));
    setUndoPreview(null);
    refocus.current = true;
    void load();
  };

  const banner = notice ?? (undoable ? t("timeline.rewoundEarlier") : null);

  if (snapshots === null && failure === null) return <LoadingState label={t("timeline.loading")} />;
  const turns = turnsOf(snapshots ?? []);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      {banner && (
        <InlineNotice key={noticeId} tone="info">
          <span>{banner}</span>{" "}
          {undoable && (
            <Button
              variant="outline"
              size="sm"
              disabled={props.busy}
              aria-describedby={props.busy ? busyId : undefined}
              onClick={() => setUndoing(true)}
            >
              {t("timeline.undo")}
            </Button>
          )}
        </InlineNotice>
      )}
      {props.busy && <InlineNotice id={busyId}>{t("timeline.busy")}</InlineNotice>}
      {failure !== null && (
        <div ref={errorBox}>
          <ErrorState
            message={t("timeline.loadFailed", {
              reason: refusalText(failure.code, failure.message, t, failure),
            })}
            retryLabel={t("timeline.retry")}
            onRetry={retry}
          />
        </div>
      )}
      {snapshots !== null && failure === null && turns.length === 0 && (
        <EmptyState icon={History} title={t("timeline.empty")} />
      )}
      <div
        ref={scroll}
        tabIndex={-1}
        data-slot="timeline-scroll"
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ul aria-label={t("timeline.list")} className="flex flex-col gap-2">
          {turns.map((turn) => (
            <TurnRow
              key={turn.n}
              store={store}
              turn={turn}
              busy={props.busy}
              busyId={busyId}
              files={files[turn.n]}
              filesFailed={filesFailed[turn.n] === true}
              onToggle={() => toggle(turn)}
              onRewind={() => setRewinding(turn)}
              onFork={() => setForking(turn)}
            />
          ))}
        </ul>
      </div>
      {rewinding && (
        <RewindDialog
          {...props}
          turn={rewinding}
          onClose={() => setRewinding(null)}
          onDone={() => rewound(rewinding)}
        />
      )}
      {undoing && <UndoDialog {...props} onClose={() => setUndoing(false)} onDone={undone} />}
      {forking && (
        <ForkDialog
          {...props}
          turn={forking}
          onClose={() => setForking(null)}
          onRewound={() => rewound(forking)}
        />
      )}
    </div>
  );
}

/**
 * "Linha do tempo" (phase 12): the session's turns in a side sheet, with "Voltar arquivos até
 * aqui" and "Bifurcar daqui" on each. `busy`: the session is in a turn, so files cannot go back.
 */
export function CheckpointsButton(props: Target & { busy: boolean }) {
  const { store } = props;
  const { t } = store.i18n;
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconActionButton label={t("timeline.open")} onClick={() => setOpen(true)}>
        <History aria-hidden="true" />
      </IconActionButton>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent showCloseButton={false} className="sm:max-w-lg">
          <SheetHeader>
            <Inline className="justify-between">
              <SheetTitle className="text-lg">{t("timeline.title")}</SheetTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                {t("common.close")}
              </Button>
            </Inline>
            <SheetDescription>{t("timeline.description")}</SheetDescription>
          </SheetHeader>
          <TimelinePanel
            {...props}
            onOpenSession={(id) => {
              setOpen(false);
              store.router.push({ name: "session", host: props.hostId, id });
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
