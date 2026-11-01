import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
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
import type { AppStore } from "../lib/app-store.ts";

type Phase =
  | { name: "opening" }
  /** The file could not be opened as text: the host says why. */
  | { name: "refused"; message: string }
  | { name: "ready"; hash: string; conflict: boolean };

/** A plain text editor (CodeMirror 6) for one file of a target; it saves only if the file is as it was read. */
export function FileEditor(props: {
  store: AppStore;
  hostId: string;
  target: string;
  path: string;
  onSaved(): void;
  onClose(): void;
}) {
  const t = useT();
  const { store, hostId, target, path } = props;
  const [phase, setPhase] = useState<Phase>({ name: "opening" });
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** The text the editor opens with: what `file.read` gave before it was mounted. */
  const initial = useRef("");

  const read = useCallback(async () => {
    const result = await store.hostRequest(hostId, "file.read", { target, path });
    if (!result.ok) {
      setPhase({ name: "refused", message: refusalText(result.code, result.message, t) });
      return null;
    }
    return result.data;
  }, [store, hostId, target, path, t]);

  /** Puts the disk's text in the editor and remembers its hash. */
  const load = useCallback(async () => {
    const file = await read();
    if (!file) return;
    const editor = view.current;
    editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: file.text } });
    setPhase({ name: "ready", hash: file.hash, conflict: false });
    return file;
  }, [read]);

  useEffect(() => {
    let alive = true;
    void read().then((file) => {
      if (!alive || !file) return;
      // Set before the phase: the effect that mounts the editor reads it.
      initial.current = file.text;
      setPhase({ name: "ready", hash: file.hash, conflict: false });
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
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [ready]);

  const write = async (expectedHash: string) => {
    const editor = view.current;
    if (!editor) return;
    const result = await store.hostRequest(hostId, "file.write", {
      target,
      path,
      text: editor.state.doc.toString(),
      expectedHash,
    });
    if (result.ok) {
      setPhase({ name: "ready", hash: result.data.hash, conflict: false });
      store.success(t("changes.saved", { path }));
      props.onSaved();
    } else if (result.code === "file_conflict") {
      setPhase((current) => (current.name === "ready" ? { ...current, conflict: true } : current));
    } else {
      setPhase({ name: "refused", message: refusalText(result.code, result.message, t) });
    }
  };

  /** "Sobrescrever": my text over what changed, with the hash of what is there now. */
  const overwrite = async () => {
    const file = await read();
    if (file) await write(file.hash);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent aria-describedby={undefined} showCloseButton={false} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {t("changes.editorTitle", { path })}
          </DialogTitle>
        </DialogHeader>
        {phase.name === "opening" && (
          <p className="text-muted-foreground text-sm">{t("changes.editorOpening")}</p>
        )}
        {phase.name === "refused" && <InlineNotice>{phase.message}</InlineNotice>}
        {phase.name === "ready" && (
          <>
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
          <Button variant="outline" onClick={props.onClose}>
            {t("changes.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
