import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, lineNumbers } from "@codemirror/view";
import type { DiffFile } from "@flightdeck/protocol";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "../lib/app-store.ts";
import { languageFor, loadLanguage } from "../lib/file-language.ts";
import { useFollow } from "../lib/use-follow.ts";
import { DiffView } from "./DiffView.tsx";

/** Token colors from the theme's tokens, so both themes keep their contrast. */
const TOKENS = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--client-indigo)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--client-emerald)" },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: "var(--client-amber)" },
  { tag: [tags.comment, tags.meta], color: "var(--muted-foreground)", fontStyle: "italic" },
  {
    tag: [tags.typeName, tags.className, tags.definition(tags.variableName)],
    color: "var(--client-sky)",
  },
  { tag: [tags.tagName, tags.attributeName, tags.propertyName], color: "var(--client-violet)" },
  { tag: tags.invalid, color: "var(--destructive)" },
]);

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
    /** The file's changes against HEAD, live from the Changes tab's diff; absent when unchanged. */
    diff?: DiffFile;
    /** The file's whole path on the host, once known: a host of this computer opens it here. */
    full?: string | null;
    /** Opens at this line (1-based) and column, selected and in view: a `path:line` from a terminal (#506). */
    line?: number;
    col?: number;
    onClose(): void;
  }>,
) {
  const t = useT();
  const { store, hostId, target, path } = props;
  const [phase, setPhase] = useState<Phase>({ name: "opening" });
  const parent = useRef<HTMLDivElement>(null);
  const [showDiff, setShowDiff] = useState(false);
  // The newest hunk stays in view while the session edits, until the person scrolls up (#315).
  const follow = useFollow(props.diff?.hunks.length ?? 0);
  const diff = showDiff ? props.diff : undefined;
  // Only where the host's files are this computer's own (the store checks the path again).
  // and only for a file the host could read.
  const full =
    phase.name === "ready" && props.full && store.canOpenPaths(hostId) ? props.full : null;

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

  const text = phase.name === "ready" && !diff ? phase.text : null;
  const { line, col } = props;
  useEffect(() => {
    if (text === null || !parent.current) return;
    const language = new Compartment();
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          language.of([]),
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          ...(line ? [highlightActiveLine()] : []),
        ],
      }),
    });
    if (line) {
      const doc = view.state.doc;
      const at = doc.line(Math.min(Math.max(line, 1), doc.lines));
      const anchor = at.from + Math.min(Math.max((col ?? 1) - 1, 0), at.length);
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: "center" }),
      });
    }
    // The language's parser loads on demand; the text shows plain until it arrives.
    let alive = true;
    const key = languageFor(path);
    if (key) {
      void loadLanguage(key).then((parser) => {
        if (!alive || !parser) return;
        view.dispatch({
          effects: language.reconfigure([
            StreamLanguage.define(parser),
            syntaxHighlighting(TOKENS),
          ]),
        });
      });
    }
    return () => {
      alive = false;
      view.destroy();
    };
  }, [text, path, line, col]);

  return (
    <section aria-label={t("files.viewer", { path })}>
      <Stack gap={2}>
        <Inline gap={2}>
          <span className="font-mono text-sm">{path}</span>
          {props.diff && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={showDiff}
              onClick={() => setShowDiff(!showDiff)}
            >
              {showDiff ? t("files.showFile") : t("files.showChanges")}
            </Button>
          )}
          {full && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void store.openPath(hostId, full)}
              >
                {t("files.openOutside")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void store.revealPath(hostId, full)}
              >
                {t("files.reveal")}
              </Button>
            </>
          )}
          <Button type="button" variant="outline" size="sm" onClick={props.onClose}>
            {t("files.close")}
          </Button>
        </Inline>
        {diff && (
          <div data-follow="" ref={follow.box} onScroll={follow.onScroll} className="diff-follow">
            <DiffView files={[diff]} mode="unified" selection={null} composer={null} />
          </div>
        )}
        {diff && follow.missed > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={follow.jump}>
            {t(follow.missed === 1 ? "files.jumpLatestOne" : "files.jumpLatestMany", {
              n: follow.missed,
            })}
          </Button>
        )}
        {phase.name === "opening" && (
          <p className="text-muted-foreground text-sm">{t("files.opening")}</p>
        )}
        {phase.name === "refused" && <InlineNotice>{phase.message}</InlineNotice>}
        {phase.name === "ready" && !diff && (
          <div ref={parent} className="rounded-md border text-sm" />
        )}
      </Stack>
    </section>
  );
}
