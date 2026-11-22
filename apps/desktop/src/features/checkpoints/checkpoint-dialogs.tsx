import type { RewindPreview } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
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
import { ErrorState, LoadingState } from "@/shared/layout/index.ts";
import { refusalText } from "../../i18n/errors.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { HostResult } from "../../lib/kernel.ts";
import { TerminalButton } from "../terminal/ui.ts";

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
  props: Readonly<{ store: AppStore; preview: RewindPreview; empty?: string }>,
) {
  const { t } = props.store.i18n;
  const { preview } = props;
  if (preview.files.length === 0) {
    return <p className="text-sm">{props.empty ?? t("timeline.nothing")}</p>;
  }
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
export function RewindDialog(props: Target & { turn: Turn; onClose(): void; onDone(): void }) {
  const { store, hostId, claudeSessionId, turn } = props;
  const { t } = store.i18n;
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  // The preview was refused: the dialog stays open and says why, instead of closing with a banner.
  const [previewRefused, setPreviewRefused] = useState<Refused | null>(null);
  // Why the host refused the rewind: the dialog stays open and says it, so nothing is lost silently.
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    void store
      .hostRequest(hostId, "rewind.preview", { claudeSessionId, turn: turn.n })
      .then((result) => (result.ok ? setPreview(result.data) : setPreviewRefused(result)));
  }, [store, hostId, claudeSessionId, turn.n]);

  const apply = async () => {
    setRefusal(null);
    const result = await store.hostRequest(hostId, "rewind.apply", {
      claudeSessionId,
      turn: turn.n,
      confirm: true,
    });
    if (!result.ok) {
      setRefusal(result.message);
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
        {preview ? (
          <PreviewFiles store={store} preview={preview} />
        ) : (
          previewRefused === null && <LoadingState label={t("timeline.previewing")} />
        )}
        {previewRefused !== null && (
          <InlineNotice tone="error">
            {t("timeline.previewFailed", {
              reason: refusalText(previewRefused.code, previewRefused.message, t, previewRefused),
            })}
          </InlineNotice>
        )}
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
export function UndoDialog(props: Target & { onClose(): void; onDone(): void }) {
  const { store, hostId, claudeSessionId } = props;
  const { t } = store.i18n;
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  // Why the host refused the undo: the dialog stays open and says it.
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    void store.hostRequest(hostId, "rewind.undoPreview", { claudeSessionId }).then((result) => {
      if (result.ok) setPreview(result.data);
      else setPreviewFailed(true);
    });
  }, [store, hostId, claudeSessionId]);

  const undo = async () => {
    setRefusal(null);
    const result = await store.hostRequest(hostId, "rewind.undo", {
      claudeSessionId,
      confirm: true,
    });
    if (!result.ok) {
      setRefusal(result.message);
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
        {preview ? (
          <PreviewFiles store={store} preview={preview} empty={t("timeline.undoNothing")} />
        ) : (
          !previewFailed && <LoadingState label={t("timeline.previewing")} />
        )}
        {previewFailed && (
          <InlineNotice tone="error">{t("timeline.undoPreviewFailed")}</InlineNotice>
        )}
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
  const [open, setOpen] = useState<"flightdeck" | "terminal">("flightdeck");
  const [withFiles, setWithFiles] = useState(false);
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  // The preview was refused: its place says why and Try again asks the host once more.
  const [previewRefused, setPreviewRefused] = useState<Refused | null>(null);
  // The fork was refused: the dialog stays open and says why.
  const [forkRefused, setForkRefused] = useState<Refused | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [forked, setForked] = useState<{ claudeSessionId: string; command: string } | null>(null);

  const loadPreview = useCallback(() => {
    setPreviewRefused(null);
    void store
      .hostRequest(hostId, "rewind.preview", { claudeSessionId, turn: turn.n })
      .then((result) => {
        setPreview(result.ok ? result.data : null);
        setPreviewRefused(result.ok ? null : result);
      });
  }, [store, hostId, claudeSessionId, turn.n]);

  useEffect(() => {
    if (withFiles) loadPreview();
  }, [withFiles, loadPreview]);

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
                onChange={(e) => setWithFiles(e.target.checked)}
              />
              {t("timeline.forkFiles")}
            </label>
            {props.busy && <p className="text-muted-foreground text-xs">{t("timeline.busy")}</p>}
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
                {preview && <PreviewFiles store={store} preview={preview} />}
                {!preview && previewRefused !== null && (
                  <ErrorState
                    message={t("timeline.previewFailed", { reason: refusedText(previewRefused) })}
                    retryLabel={t("timeline.retry")}
                    onRetry={loadPreview}
                  />
                )}
                {!preview && previewRefused === null && (
                  <LoadingState label={t("timeline.previewing")} />
                )}
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
