import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "../lib/app-store.ts";

/** The file on its way, refused with the text to show, or its text. */
type Phase =
  | { name: "opening" }
  | { name: "refused"; message: string }
  | { name: "ready"; text: string };

/**
 * One file of the repository, read only, with its lines numbered (issue #506). It reads through
 * `file.read`, so the host's refusals (over 1 MB, not text, a credential) show as their text.
 */
export function FileViewer(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    target: string;
    path: string;
    onClose(): void;
  }>,
) {
  const t = useT();
  const { store, hostId, target, path } = props;
  const [phase, setPhase] = useState<Phase>({ name: "opening" });
  const parent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setPhase({ name: "opening" });
    void store.hostRequest(hostId, "file.read", { target, path }).then((result) => {
      if (!alive) return;
      setPhase(
        result.ok
          ? { name: "ready", text: result.data.text }
          : { name: "refused", message: refusalText(result.code, result.message, t, result) },
      );
    });
    return () => {
      alive = false;
    };
  }, [store, hostId, target, path, t]);

  const text = phase.name === "ready" ? phase.text : null;
  useEffect(() => {
    if (text === null || !parent.current) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
        ],
      }),
    });
    return () => view.destroy();
  }, [text]);

  return (
    <section aria-label={t("files.viewer", { path })}>
      <Stack gap={2}>
        <Inline gap={2}>
          <span className="font-mono text-sm">{path}</span>
          <Button type="button" variant="outline" size="sm" onClick={props.onClose}>
            {t("files.close")}
          </Button>
        </Inline>
        {phase.name === "opening" && (
          <p className="text-muted-foreground text-sm">{t("files.opening")}</p>
        )}
        {phase.name === "refused" && <InlineNotice>{phase.message}</InlineNotice>}
        {phase.name === "ready" && <div ref={parent} className="rounded-md border text-sm" />}
      </Stack>
    </section>
  );
}
