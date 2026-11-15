import type { RewindPreview } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Turn } from "@/features/sessions/index.ts";
import { ActionButton, AppDialogContent } from "@/shared/feedback/index.ts";
import { LoadingState } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { TerminalButton } from "../terminal/ui.ts";

export interface Target {
  store: AppStore;
  hostId: string;
  claudeSessionId: string;
  cwd: string;
}

/** What rewinding does to each file, from the files' point of view. */
function PreviewFiles(props: Readonly<{ store: AppStore; preview: RewindPreview }>) {
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
export function RewindDialog(props: Target & { turn: Turn; onClose(): void; onDone(): void }) {
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
