import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { LoadingState } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

type Phase =
  | { name: "opening" }
  /** The file could not be opened as text: the host says why. */
  | { name: "refused"; message: string }
  /** `error`: the host refused a save or a re-read of the open file; the text in the editor stays. */
  | { name: "ready"; hash: string; conflict: boolean; error: string | null };

/** A plain text editor (CodeMirror 6) for one file of a target; it saves only if the file is as it was read. */
export function FileEditor(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    target: string;
    path: string;
    onSaved(): void;
    onClose(): void;
  }>,
) {
  const t = useT();
  const { store, hostId, target, path } = props;
  const [phase, setPhase] = useState<Phase>({ name: "opening" });
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** The text the editor opens with, and then the last one read or saved: what "unsaved" is measured from. */
  const initial = useRef("");
  /** The name of the editing surface, read when the editor is mounted (a language change must not rebuild it). */
  const label = useRef("");
  label.current = t("changes.editorField", { path });
  const [discarding, setDiscarding] = useState(false);
  /** A close with edits that were not saved asks first; with none (or no editor yet) it closes at once. */
  const requestClose = () => {
    if (view.current && view.current.state.doc.toString() !== initial.current) setDiscarding(true);
    else props.onClose();
  };

  /** The file as the host has it, or the reason it refused: each caller decides what a refusal does. */
  const read = useCallback(async () => {
    const result = await store.hostRequest(hostId, "file.read", { target, path });
    return result.ok
      ? { file: result.data, message: null }
      : { file: null, message: refusalText(result.code, result.message, t, result) };
  }, [store, hostId, target, path, t]);

  /** A refusal once the file is open: shown above the editor, which keeps what was typed. */
  const fail = useCallback(
    (message: string) =>
      setPhase((current) => (current.name === "ready" ? { ...current, error: message } : current)),
    [],
  );

  /** Puts the disk's text in the editor and remembers its hash. */
  const load = useCallback(async () => {
    const { file, message } = await read();
    if (!file) return fail(message);
    const editor = view.current;
    editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: file.text } });
    // The editor's own text, not the file's: CodeMirror turns CRLF into line breaks it keeps as "\n".
    initial.current = editor?.state.doc.toString() ?? file.text;
    setPhase({ name: "ready", hash: file.hash, conflict: false, error: null });
  }, [read, fail]);

  useEffect(() => {
    let alive = true;
    void read().then(({ file, message }) => {
      if (!alive) return;
      if (!file) {
        setPhase({ name: "refused", message });
        return;
      }
      // Set before the phase: the effect that mounts the editor reads it.
      initial.current = file.text;
      setPhase({ name: "ready", hash: file.hash, conflict: false, error: null });
    });
    return () => {
      alive = false;
    };
  }, [read]);

  const ready = phase.name === "ready";
  useEffect(() => {
    if (!ready || !parent.current) return;
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label.current }),
        ],
      }),
    });
    view.current = editor;
    initial.current = editor.state.doc.toString();
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [ready]);

  const write = async (expectedHash: string) => {
    const editor = view.current;
    if (!editor) return;
    const text = editor.state.doc.toString();
    const result = await store.hostRequest(hostId, "file.write", {
      target,
      path,
      text,
      expectedHash,
    });
    if (result.ok) {
      initial.current = text;
      setPhase({ name: "ready", hash: result.data.hash, conflict: false, error: null });
      store.success(t("changes.saved", { path }));
      props.onSaved();
    } else if (result.code === "file_conflict") {
      setPhase((current) =>
        current.name === "ready" ? { ...current, conflict: true, error: null } : current,
      );
    } else {
      fail(refusalText(result.code, result.message, t, result));
    }
  };

  /** "Sobrescrever": my text over what changed, with the hash of what is there now. */
  const overwrite = async () => {
    const { file, message } = await read();
    if (file) await write(file.hash);
    else fail(message);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent aria-describedby={undefined} showCloseButton={false} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {t("changes.editorTitle", { path })}
          </DialogTitle>
        </DialogHeader>
        {phase.name === "opening" && <LoadingState label={t("changes.editorOpening")} />}
        {phase.name === "refused" && <InlineNotice tone="error">{phase.message}</InlineNotice>}
        {phase.name === "ready" && (
          <>
            {phase.error && <InlineNotice tone="error">{phase.error}</InlineNotice>}
            {phase.conflict && (
              <div className="flex flex-col gap-2">
                <InlineNotice>{t("changes.conflict")}</InlineNotice>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void load()}>
                    {t("changes.reload")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void overwrite()}>
                    {t("changes.overwrite")}
                  </Button>
                </div>
              </div>
            )}
            <div
              ref={parent}
              className="max-h-[60vh] min-h-40 overflow-auto rounded-md border font-mono text-xs"
            />
          </>
        )}
        <DialogFooter>
          {phase.name === "ready" && (
            <Button onClick={() => void write(phase.hash)}>{t("changes.save")}</Button>
          )}
          <Button variant="outline" onClick={requestClose}>
            {t("changes.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
      {discarding && (
        <ConfirmDialog
          message={t("changes.discardMessage", { path })}
          confirmLabel={t("changes.discardConfirm")}
          destructive
          // Keep editing: the focus goes back into the text.
          onRestoreFocus={() => view.current?.focus()}
          onConfirm={() => {
            setDiscarding(false);
            props.onClose();
          }}
          onCancel={() => setDiscarding(false)}
        />
      )}
    </Dialog>
  );
}
