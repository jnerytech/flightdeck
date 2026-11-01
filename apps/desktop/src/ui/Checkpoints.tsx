import type { RewindPreview, SnapshotFiles, SnapshotInfo } from "@flightdeck/protocol";
import { GitBranch, History, Undo2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";
import { formatDateTime } from "../i18n/format.ts";
import type { AppStore } from "../lib/app-store.ts";
import { type Turn, turnsOf } from "../lib/turns.ts";
import { TerminalButton } from "./TerminalButton.tsx";

interface Target {
  store: AppStore;
  hostId: string;
  claudeSessionId: string;
  cwd: string;
}

/** What rewinding does to each file, from the files' point of view. */
function PreviewFiles(props: { store: AppStore; preview: RewindPreview }) {
  const { t } = props.store.i18n;
  const { preview } = props;
  if (preview.files.length === 0) return <p className="text-sm">{t("timeline.nothing")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">{t(`timeline.via.${preview.via}`)}</p>
      <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-sm">
        {preview.files.map((file) => (
          <li key={file.path} className="flex flex-wrap items-center gap-2">
            <code className="break-all">{file.path}</code>
            <span className="text-muted-foreground text-xs">
              {t(`timeline.effect.${file.change as "modified" | "created" | "deleted"}`)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs tabular-nums">
        {t("timeline.lines", { added: preview.insertions, removed: preview.deletions })}
      </p>
    </div>
  );
}

/** "Voltar arquivos até aqui": the preview, then the confirmation. */
function RewindDialog(props: Target & { turn: Turn; onClose(): void; onDone(): void }) {
  const { store, hostId, claudeSessionId, turn } = props;
  const { t } = store.i18n;
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  // The parent makes a new onClose on every render: the preview must not reload for that.
  const close = useRef(props.onClose);
  close.current = props.onClose;

  useEffect(() => {
    void store
      .hostCommand(hostId, "rewind.preview", { claudeSessionId, turn: turn.n })
      .then((result) => (result ? setPreview(result) : close.current()));
  }, [store, hostId, claudeSessionId, turn.n]);

  const apply = async () => {
    const result = await store.hostCommand(hostId, "rewind.apply", {
      claudeSessionId,
      turn: turn.n,
      confirm: true,
    });
    if (result) props.onDone();
    props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("timeline.rewindTitle", { n: turn.ordinal })}</DialogTitle>
          <DialogDescription>{t("timeline.rewindNote")}</DialogDescription>
        </DialogHeader>
        {preview ? (
          <PreviewFiles store={store} preview={preview} />
        ) : (
          <LoadingState label={t("timeline.previewing")} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <ActionButton
            variant="destructive"
            disabled={preview === null || preview.files.length === 0}
            {...(preview ? { disabledReason: t("timeline.nothingToRewind") } : {})}
            onClick={() => apply()}
          >
            {t("timeline.rewindConfirm")}
          </ActionButton>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}

/** "Bifurcar daqui": where to open the new conversation, and whether the files go back too. */
function ForkDialog(
  props: Target & {
    turn: Turn;
    busy: boolean;
    onClose(): void;
    onOpenSession(sessionId: string): void;
    onRewound(): void;
  },
) {
  const { store, hostId, claudeSessionId, turn, cwd } = props;
  const { t } = store.i18n;
  const [open, setOpen] = useState<"flightdeck" | "terminal">("flightdeck");
  const [withFiles, setWithFiles] = useState(false);
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  const [forked, setForked] = useState<{ claudeSessionId: string; command: string } | null>(null);

  useEffect(() => {
    if (!withFiles) return;
    void store
      .hostCommand(hostId, "rewind.preview", { claudeSessionId, turn: turn.n })
      .then((result) => setPreview(result));
  }, [store, hostId, claudeSessionId, turn.n, withFiles]);

  const fork = async () => {
    const result = await store.hostCommand(hostId, "session.fork", {
      claudeSessionId,
      cwd,
      open,
      ...(turn.uuid ? { upToMessageId: turn.uuid } : {}),
      ...(withFiles ? { rewindTurn: turn.n } : {}),
    });
    if (!result) return;
    if (withFiles) props.onRewound();
    if (result.sessionId) {
      props.onOpenSession(result.sessionId);
      props.onClose();
    } else {
      setForked({ claudeSessionId: result.claudeSessionId, command: result.command ?? "" });
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("timeline.forkTitle", { n: turn.ordinal })}</DialogTitle>
          <DialogDescription>{t("timeline.forkDescription")}</DialogDescription>
        </DialogHeader>
        {forked ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>{t("timeline.forkCommand")}</p>
            <code className="break-all rounded-md bg-muted p-2">{forked.command}</code>
            <div>
              <TerminalButton
                store={store}
                hostId={hostId}
                target={{ cwd, claudeSessionId: forked.claudeSessionId }}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 font-medium">{t("timeline.forkWhere")}</legend>
              {(["flightdeck", "terminal"] as const).map((where) => (
                <label key={where} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="fork-open"
                    checked={open === where}
                    onChange={() => setOpen(where)}
                  />
                  {t(where === "flightdeck" ? "timeline.forkFlightdeck" : "timeline.forkTerminal")}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={withFiles}
                disabled={props.busy}
                onChange={(e) => setWithFiles(e.target.checked)}
              />
              {t("timeline.forkFiles")}
            </label>
            {props.busy && <p className="text-muted-foreground text-xs">{t("timeline.busy")}</p>}
            {withFiles && (
              <>
                <p className="text-muted-foreground text-xs">{t("timeline.forkFilesNote")}</p>
                {preview ? (
                  <PreviewFiles store={store} preview={preview} />
                ) : (
                  <LoadingState label={t("timeline.previewing")} />
                )}
              </>
            )}
          </div>
        )}
        <DialogFooter>
          {forked ? (
            <Button onClick={props.onClose}>{t("common.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={props.onClose}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void fork()}>{t("timeline.forkConfirm")}</Button>
            </>
          )}
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}

/** One turn: its prompt, time and files, and the two actions. */
function TurnRow(props: {
  store: AppStore;
  turn: Turn;
  busy: boolean;
  /** The id of the panel's busy notice, which says why the rewind is off. */
  busyId: string;
  files: SnapshotFiles | undefined;
  onToggle(): void;
  onRewind(): void;
  onFork(): void;
}) {
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
      <p className="line-clamp-3 whitespace-pre-wrap break-words">{turn.prompt ?? ""}</p>
      {turn.files === "changed" && (
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="self-start" onClick={props.onToggle}>
            {props.files
              ? t("timeline.hideFiles", { n: turn.ordinal })
              : t("timeline.showFiles", { n: turn.ordinal })}
          </Button>
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
  const [files, setFiles] = useState<Record<number, SnapshotFiles>>({});
  const [rewinding, setRewinding] = useState<Turn | null>(null);
  const [forking, setForking] = useState<Turn | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoable, setUndoable] = useState(false);

  const load = useCallback(async () => {
    const result = await store.hostCommand(hostId, "snapshots.list", { claudeSessionId });
    if (result) setSnapshots(result.snapshots);
  }, [store, hostId, claudeSessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (turn: Turn) => {
    if (files[turn.n]) {
      setFiles(({ [turn.n]: _closed, ...rest }) => rest);
      return;
    }
    const result = await store.hostCommand(hostId, "snapshots.files", {
      claudeSessionId,
      n: turn.n,
    });
    if (result) setFiles((all) => ({ ...all, [turn.n]: result }));
  };

  const rewound = (turn: Turn) => {
    setNotice(t("timeline.rewound", { n: turn.ordinal }));
    setUndoable(true);
    void load();
  };

  const undo = async () => {
    const result = await store.hostCommand(hostId, "rewind.undo", {
      claudeSessionId,
      confirm: true,
    });
    if (result) {
      setNotice(t("timeline.undone"));
      setUndoable(false);
      void load();
    }
  };

  if (snapshots === null) return <LoadingState label={t("timeline.loading")} />;
  const turns = turnsOf(snapshots);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
      {notice && (
        <InlineNotice tone="info">
          <span>{notice}</span>{" "}
          {undoable && (
            <Button variant="outline" size="sm" onClick={() => void undo()}>
              {t("timeline.undo")}
            </Button>
          )}
        </InlineNotice>
      )}
      {props.busy && <InlineNotice id={busyId}>{t("timeline.busy")}</InlineNotice>}
      {turns.length === 0 && <EmptyState icon={History} title={t("timeline.empty")} />}
      <ul aria-label={t("timeline.list")} className="flex flex-col gap-2">
        {turns.map((turn) => (
          <TurnRow
            key={turn.n}
            store={store}
            turn={turn}
            busy={props.busy}
            busyId={busyId}
            files={files[turn.n]}
            onToggle={() => void toggle(turn)}
            onRewind={() => setRewinding(turn)}
            onFork={() => setForking(turn)}
          />
        ))}
      </ul>
      {rewinding && (
        <RewindDialog
          {...props}
          turn={rewinding}
          onClose={() => setRewinding(null)}
          onDone={() => rewound(rewinding)}
        />
      )}
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
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History aria-hidden="true" />
        {t("timeline.open")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent showCloseButton={false} className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("timeline.title")}</SheetTitle>
            <SheetDescription>{t("timeline.description")}</SheetDescription>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setOpen(false)}
            >
              {t("common.close")}
            </Button>
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
