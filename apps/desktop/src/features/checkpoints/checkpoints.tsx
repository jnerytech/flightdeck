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
import { EmptyState, ErrorState, Inline, LoadingState, Stack } from "@/shared/layout/index.ts";
import { formatDateTime } from "../../i18n/format.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { ForkDialog, RewindDialog, type Target, UndoDialog } from "./checkpoint-dialogs.tsx";

/** More than this many lines or characters and the prompt is clamped, with a button to read it whole (#4038). */
// Keep PROMPT_LINES equal to the `line-clamp-3` class below: a Tailwind class cannot be built from it.
const PROMPT_LINES = 3;
const PROMPT_CHARS = 240;

/** The turn's prompt: clamped when long, with Show more and Show less; a turn without one says so. */
function TurnPrompt(props: Readonly<{ store: AppStore; prompt: string | null }>) {
  const { t } = props.store.i18n;
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = props.prompt?.trim() ?? "";
  if (text === "") return <p className="text-muted-foreground">{t("timeline.noPrompt")}</p>;
  // Decided by the text, not by the layout: the same on every screen width.
  const long = text.split("\n").length > PROMPT_LINES || text.length > PROMPT_CHARS;
  return (
    <Stack gap={1} className="items-start">
      <p
        id={id}
        className={`whitespace-pre-wrap break-words ${long && !open ? "line-clamp-3" : ""}`.trim()}
      >
        {text}
      </p>
      {long && (
        <Button
          variant="link"
          size="sm"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? t("timeline.showLess") : t("timeline.showMore")}
        </Button>
      )}
    </Stack>
  );
}

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
          <ActionButton variant="ghost" size="sm" className="self-start" onClick={props.onToggle}>
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
            <ul className="flex flex-col gap-1">
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
  // The first load was refused: the sheet says so and offers a new try, instead of loading for ever.
  const [failed, setFailed] = useState(false);
  const [files, setFiles] = useState<Record<number, SnapshotFiles>>({});
  // The turns whose files the host refused to read: the row says so and offers a new try.
  const [filesFailed, setFilesFailed] = useState<Record<number, true>>({});
  const [rewinding, setRewinding] = useState<Turn | null>(null);
  const [forking, setForking] = useState<Turn | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // What the host would restore by an undo, from its own safety snapshot: the Undo is offered only
  // while it lists files, so it also survives the sheet closing and a fork that rewound (#4036).
  const [undoPreview, setUndoPreview] = useState<RewindPreview | null>(null);
  const [undoing, setUndoing] = useState(false);
  const undoable = (undoPreview?.files.length ?? 0) > 0;
  const scroll = useRef<HTMLDivElement>(null);
  const loaded = snapshots !== null;

  const load = useCallback(async () => {
    setFailed(false);
    const result = await store.hostCommand(hostId, "snapshots.list", { claudeSessionId });
    if (!result) {
      setFailed(true);
      return;
    }
    setSnapshots(result.snapshots);
    // Only a session with a safety snapshot has a rewind to undo. A refusal (an older host, no
    // rewind) is no error: there is just no Undo.
    if (!result.snapshots.some((s) => s.kind === "safety")) {
      setUndoPreview(null);
      return;
    }
    const preview = await store.hostRequest(hostId, "rewind.undoPreview", { claudeSessionId });
    setUndoPreview(preview.ok ? preview.data : null);
  }, [store, hostId, claudeSessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The list opens at the newest turn, which is the one a person came to act on (#4037).
  useEffect(() => {
    if (loaded && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [loaded]);

  const toggle = async (turn: Turn) => {
    if (files[turn.n]) {
      setFiles(({ [turn.n]: _closed, ...rest }) => rest);
      return;
    }
    const result = await store.hostCommand(hostId, "snapshots.files", {
      claudeSessionId,
      n: turn.n,
    });
    if (result) {
      setFiles((all) => ({ ...all, [turn.n]: result }));
      setFilesFailed(({ [turn.n]: _read, ...rest }) => rest);
    } else setFilesFailed((all) => ({ ...all, [turn.n]: true }));
  };

  const rewound = (turn: Turn) => {
    setNotice(t("timeline.rewound", { n: turn.ordinal }));
    void load();
  };

  const undone = () => {
    setNotice(t("timeline.undone"));
    setUndoPreview(null);
    void load();
  };

  if (snapshots === null && !failed) return <LoadingState label={t("timeline.loading")} />;
  const turns = turnsOf(snapshots ?? []);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      {(notice ?? (undoable ? t("timeline.rewoundEarlier") : null)) && (
        <InlineNotice tone="info">
          <span>{notice ?? t("timeline.rewoundEarlier")}</span>{" "}
          {undoable && (
            <Button variant="outline" size="sm" onClick={() => setUndoing(true)}>
              {t("timeline.undo")}
            </Button>
          )}
        </InlineNotice>
      )}
      {props.busy && <InlineNotice id={busyId}>{t("timeline.busy")}</InlineNotice>}
      {snapshots === null && (
        <ErrorState
          message={t("timeline.loadFailed")}
          retryLabel={t("timeline.retry")}
          onRetry={() => void load()}
        />
      )}
      {snapshots !== null && turns.length === 0 && (
        <EmptyState icon={History} title={t("timeline.empty")} />
      )}
      <div ref={scroll} data-slot="timeline-scroll" className="min-h-0 flex-1 overflow-y-auto">
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
