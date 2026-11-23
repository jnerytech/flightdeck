import type { RewindPreview } from "@flightdeck/protocol";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Turn } from "@/features/sessions/index.ts";
import {
  ActionButton,
  AppDialogContent,
  ConfirmDialog,
  InlineNotice,
} from "@/shared/feedback/index.ts";
import { ErrorState, Inline, LoadingState, Stack } from "@/shared/layout/index.ts";
import { refusalText } from "../../i18n/errors.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { HostResult } from "../../lib/kernel.ts";
import { TerminalButton } from "../terminal/ui.ts";
import { TurnContext } from "./turn-prompt.tsx";

export interface Target {
  store: AppStore;
  hostId: string;
  claudeSessionId: string;
  cwd: string;
}

/** A request the host refused, with the code, message and reason it gave. */
export type Refused = Exclude<HostResult<unknown>, { ok: true }>;

/** What rewinding does to each file, from the files' point of view. */
function PreviewFiles(
  props: Readonly<{ store: AppStore; preview: RewindPreview; label: string; empty?: string }>,
) {
  const { t } = props.store.i18n;
  const { preview } = props;
  if (preview.files.length === 0) {
    return <p className="text-sm">{props.empty ?? t("timeline.nothing")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">{t(`timeline.via.${preview.via}`)}</p>
      {/* A long list scrolls inside its box: it takes the focus, so the keys can scroll it (#4374). */}
      <Stack
        as="ul"
        gap={1}
        scrolls
        label={props.label}
        className="max-h-60 overflow-y-auto text-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        {preview.files.map((file) => (
          <li key={file.path} className="flex flex-wrap items-center gap-2">
            <code className="break-all">{file.path}</code>
            <span className="text-muted-foreground text-xs">
              {t(`timeline.effect.${file.change as "modified" | "created" | "deleted"}`)}
            </span>
          </li>
        ))}
      </Stack>
      <p className="text-muted-foreground text-xs tabular-nums">
        {t("timeline.lines", { added: preview.insertions, removed: preview.deletions })}
      </p>
    </div>
  );
}

/**
 * A preview read from the host: refused with the answer kept, so the dialog says why, and read again
 * on demand. `enabled` holds the read back (the Fork dialog reads only once its files box is ticked).
 */
function usePreview(read: () => Promise<HostResult<RewindPreview>>, enabled = true) {
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const load = useCallback(() => {
    setRefused(null);
    void read().then((result) => {
      setPreview(result.ok ? result.data : null);
      setRefused(result.ok ? null : result);
    });
  }, [read]);
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);
  return { preview, refused, load };
}

/** The preview's place in a dialog: the files, the reason it was refused with Try again, or the wait. */
function PreviewState(
  props: Readonly<{
    store: AppStore;
    preview: RewindPreview | null;
    refused: Refused | null;
    onRetry(): void;
    /** The refusal's sentence: it holds `{reason}`. */
    failed: "timeline.previewFailed" | "timeline.undoPreviewFailed";
    /** The name of the list of files, for the dialog it is in. */
    filesLabel: "timeline.filesRewind" | "timeline.filesUndo" | "timeline.filesFork";
    empty?: string;
  }>,
) {
  const { t } = props.store.i18n;
  if (props.preview) {
    return (
      <PreviewFiles
        store={props.store}
        preview={props.preview}
        label={t(props.filesLabel)}
        empty={props.empty}
      />
    );
  }
  if (props.refused === null) return <LoadingState label={t("timeline.previewing")} />;
  const { refused } = props;
  return (
    <ErrorState
      message={t(props.failed, { reason: refusalText(refused.code, refused.message, t, refused) })}
      retryLabel={t("timeline.retry")}
      onRetry={props.onRetry}
    />
  );
}

/** "Voltar arquivos até aqui": the preview, then the confirmation. */
export function RewindDialog(
  props: Omit<Target, "cwd"> & { turn: Turn; onClose(): void; onDone(): void },
) {
  const { store, hostId, claudeSessionId, turn } = props;
  const { t } = store.i18n;
  // A refused preview keeps the dialog open and says why, instead of closing with a banner.
  const { preview, refused, load } = usePreview(
    useCallback(
      () => store.hostRequest(hostId, "rewind.preview", { claudeSessionId, turn: turn.n }),
      [store, hostId, claudeSessionId, turn.n],
    ),
  );
  // Why the host refused the rewind: the dialog stays open and says it, so nothing is lost silently.
  const [refusal, setRefusal] = useState<string | null>(null);

  const apply = async () => {
    setRefusal(null);
    const result = await store.hostRequest(hostId, "rewind.apply", {
      claudeSessionId,
      turn: turn.n,
      confirm: true,
    });
    if (!result.ok) {
      setRefusal(refusalText(result.code, result.message, t, result));
      return;
    }
    props.onDone();
    props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("timeline.rewindTitle", { n: turn.ordinal })}</DialogTitle>
          <DialogDescription>{t("timeline.rewindNote")}</DialogDescription>
        </DialogHeader>
        <TurnContext store={store} turn={turn} />
        <PreviewState
          store={store}
          preview={preview}
          refused={refused}
          onRetry={load}
          failed="timeline.previewFailed"
          filesLabel="timeline.filesRewind"
        />
        {refusal !== null && (
          <InlineNotice tone="error">{t("timeline.applyFailed", { reason: refusal })}</InlineNotice>
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

/**
 * "Desfazer volta": what the undo would put back, read from the host when the dialog opens (the
 * files may have changed since the sheet did), and the confirmation that overwrites them (#4036).
 */
export function UndoDialog(props: Omit<Target, "cwd"> & { onClose(): void; onDone(): void }) {
  const { store, hostId, claudeSessionId } = props;
  const { t } = store.i18n;
  const { preview, refused, load } = usePreview(
    useCallback(
      () => store.hostRequest(hostId, "rewind.undoPreview", { claudeSessionId }),
      [store, hostId, claudeSessionId],
    ),
  );
  // Why the host refused the undo: the dialog stays open and says it.
  const [refusal, setRefusal] = useState<string | null>(null);

  const undo = async () => {
    setRefusal(null);
    const result = await store.hostRequest(hostId, "rewind.undo", {
      claudeSessionId,
      confirm: true,
    });
    if (!result.ok) {
      setRefusal(refusalText(result.code, result.message, t, result));
      return;
    }
    props.onDone();
    props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("timeline.undoTitle")}</DialogTitle>
          <DialogDescription>{t("timeline.undoNote")}</DialogDescription>
        </DialogHeader>
        <PreviewState
          store={store}
          preview={preview}
          refused={refused}
          onRetry={load}
          failed="timeline.undoPreviewFailed"
          filesLabel="timeline.filesUndo"
          empty={t("timeline.undoNothing")}
        />
        {refusal !== null && (
          <InlineNotice tone="error">{t("timeline.undoFailed", { reason: refusal })}</InlineNotice>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <ActionButton
            variant="destructive"
            disabled={preview === null || preview.files.length === 0}
            onClick={() => undo()}
          >
            {t("timeline.undoConfirm")}
          </ActionButton>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}

/** "Bifurcar daqui": where to open the new conversation, and whether the files go back too. */
export function ForkDialog(
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
  const busyId = useId();
  const [open, setOpen] = useState<"flightdeck" | "terminal">("flightdeck");
  const [withFiles, setWithFiles] = useState(false);
  // A refused preview says why in its place, and Try again asks the host once more.
  const {
    preview,
    refused: previewRefused,
    load: loadPreview,
  } = usePreview(
    useCallback(
      () => store.hostRequest(hostId, "rewind.preview", { claudeSessionId, turn: turn.n }),
      [store, hostId, claudeSessionId, turn.n],
    ),
    withFiles,
  );
  // The fork was refused: the dialog stays open and says why.
  const [forkRefused, setForkRefused] = useState<Refused | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [forked, setForked] = useState<{ claudeSessionId: string; command: string } | null>(null);
  const copy = useRef<HTMLButtonElement>(null);
  const resultId = useId();
  // The result replaces the Fork button the focus was on: it moves to the first useful control (#4375).
  useEffect(() => {
    if (forked) copy.current?.focus();
  }, [forked]);

  const refusedText = (refused: Refused) => refusalText(refused.code, refused.message, t, refused);
  // A fork refused for its folder keeps the way out the banner's toast offers (#3550).
  const cwdParam = forkRefused?.params?.cwd;
  const folderToAllow =
    forkRefused?.reason === "cwd_outside_roots" && typeof cwdParam === "string" ? cwdParam : null;

  const fork = async () => {
    setForkRefused(null);
    const answer = await store.hostRequest(hostId, "session.fork", {
      claudeSessionId,
      cwd,
      open,
      ...(turn.uuid ? { upToMessageId: turn.uuid } : {}),
      ...(withFiles ? { rewindTurn: turn.n } : {}),
    });
    if (!answer.ok) {
      setForkRefused(answer);
      return;
    }
    const result = answer.data;
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
        <TurnContext store={store} turn={turn} />
        {forked ? (
          <div className="flex flex-col gap-2 text-sm">
            <output id={resultId} className="block">
              <Stack gap={2}>
                <p>{t("timeline.forkCommand")}</p>
                <code className="break-all rounded-md bg-muted p-2">{forked.command}</code>
              </Stack>
            </output>
            <Inline>
              <Button
                ref={copy}
                aria-describedby={resultId}
                variant="outline"
                onClick={() => void store.system.copyText(forked.command)}
              >
                {t("timeline.forkCopy")}
              </Button>
              <TerminalButton
                store={store}
                hostId={hostId}
                target={{ cwd, claudeSessionId: forked.claudeSessionId }}
              />
            </Inline>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 font-medium">{t("timeline.forkWhere")}</legend>
              {(["flightdeck", "terminal"] as const).map((where) => (
                <label key={where} className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="hit-control"
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
                className="hit-control"
                checked={withFiles}
                disabled={props.busy}
                aria-describedby={props.busy ? busyId : undefined}
                onChange={(e) => setWithFiles(e.target.checked)}
              />
              {t("timeline.forkFiles")}
            </label>
            {props.busy && (
              <p id={busyId} className="text-muted-foreground text-xs">
                {t("timeline.busy")}
              </p>
            )}
            {forkRefused !== null && (
              <InlineNotice tone="error">
                <span>{t("timeline.forkFailed", { reason: refusedText(forkRefused) })}</span>
                {folderToAllow !== null && (
                  <>
                    {" "}
                    <Button variant="outline" size="sm" onClick={() => setAllowing(true)}>
                      {t("toast.allowRoot")}
                    </Button>
                  </>
                )}
              </InlineNotice>
            )}
            {withFiles && (
              <>
                <p className="text-muted-foreground text-xs">{t("timeline.forkFilesNote")}</p>
                <PreviewState
                  store={store}
                  preview={preview}
                  refused={previewRefused}
                  onRetry={loadPreview}
                  failed="timeline.previewFailed"
                  filesLabel="timeline.filesFork"
                />
              </>
            )}
          </div>
        )}
        {allowing && folderToAllow !== null && (
          <ConfirmDialog
            message={t("toast.allowRootMessage", {
              host: store.getState().hosts.find((h) => h.id === hostId)?.name ?? "",
              folder: folderToAllow,
            })}
            confirmLabel={t("toast.allowRoot")}
            onCancel={() => setAllowing(false)}
            onConfirm={() => {
              setAllowing(false);
              void store.roster.allowRoot(hostId, folderToAllow, () => void fork());
            }}
          />
        )}
        <DialogFooter>
          {forked ? (
            <Button onClick={props.onClose}>{t("common.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={props.onClose}>
                {t("common.cancel")}
              </Button>
              <ActionButton
                disabled={withFiles && preview === null}
                disabledReason={t("timeline.forkNeedsPreview")}
                onClick={() => fork()}
              >
                {t("timeline.forkConfirm")}
              </ActionButton>
            </>
          )}
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
