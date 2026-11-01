import type { ChangesResult, DiffFile, ReviewComment } from "@flightdeck/protocol";
import { Pencil, RotateCcw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "../lib/app-store.ts";
import { type Selection, select } from "../lib/review.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DiffView } from "./DiffView.tsx";
import { FileEditor } from "./FileEditor.tsx";
import { FileSessions } from "./FileSessions.tsx";
import { ReviewList } from "./ReviewList.tsx";

/** What the host offers to take back a revert: the file and when the offer ends. */
interface Undo {
  path: string;
  until: number;
}

/**
 * The Mudanças tab of a session or a card (phase 11): the files that changed with their diff,
 * comments on its lines kept as drafts until the review goes to the agent, revert with undo, a
 * plain editor and the sessions that wrote each file. It follows the disk through the host's
 * watcher.
 */
export function ChangesPanel(props: {
  store: AppStore;
  hostId: string;
  /** The review target: "session:" plus the Claude Code id, or "card:" plus the card id. */
  target: string;
  /** Something above the files (a card's position against its base, its PR); gets the answer. */
  extra?: (changes: ChangesResult, refresh: () => Promise<void>) => ReactNode;
}) {
  const t = useT();
  const { store, hostId, target } = props;
  const [changes, setChanges] = useState<ChangesResult | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [body, setBody] = useState("");
  const [reverting, setReverting] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    const result = await store.hostCommand(hostId, "review.list", { target });
    if (result) setComments(result.comments);
  }, [store, hostId, target]);

  const refresh = useCallback(async () => {
    const result = await store.hostRequest(hostId, "changes.get", { target });
    if (result.ok) {
      setChanges(result.data);
      setUnavailable(null);
    } else {
      setUnavailable(refusalText(result.code, result.message, t));
    }
    await loadComments();
  }, [store, hostId, target, loadComments, t]);

  // The first read, then every change the host sees on disk.
  useEffect(() => {
    void refresh();
    return store.watchChanges(hostId, target, (update) => {
      setChanges(update);
      setUnavailable(null);
      void loadComments();
    });
  }, [store, hostId, target, refresh, loadComments]);

  // The offer to undo a revert ends 30 s after it, by the store's clock.
  const until = undo?.until ?? null;
  useEffect(() => {
    if (until === null) return;
    return store.later(() => setUndo(null), Math.max(0, until - store.now()));
  }, [store, until]);

  const onPick = (path: string, side: ReviewComment["side"], line: number, extend: boolean) => {
    setSelection((current) => select(current, path, side, line, extend));
  };

  const addComment = async () => {
    if (!selection || !body.trim()) return;
    const added = await store.hostCommand(hostId, "review.add", {
      target,
      path: selection.path,
      side: selection.side,
      lineStart: selection.start,
      lineEnd: selection.end,
      body: body.trim(),
    });
    if (!added) return;
    setSelection(null);
    setBody("");
    await loadComments();
  };

  const send = async () => {
    const sent = await store.hostCommand(hostId, "review.send", { target });
    if (!sent) return;
    store.success(t(`changes.sentVia.${sent.via}`));
    if (sent.via === "copy") await store.copyText(sent.text);
    await loadComments();
  };

  const revert = async (path: string) => {
    setReverting(null);
    const done = await store.hostCommand(hostId, "changes.revert", { target, path, confirm: true });
    if (!done) return;
    setUndo({ path, until: Date.parse(done.undoUntil) });
    await refresh();
  };

  const undoRevert = async (path: string) => {
    const done = await store.hostCommand(hostId, "changes.undoRevert", {
      target,
      path,
      confirm: true,
    });
    setUndo(null);
    if (!done) return;
    store.success(t("changes.undone", { path }));
    await refresh();
  };

  const where = selection
    ? [
        selection.start === selection.end
          ? t("changes.composerLine", { path: selection.path, line: selection.start })
          : t("changes.composerLines", {
              path: selection.path,
              from: selection.start,
              to: selection.end,
            }),
        selection.side === "old" ? t("changes.composerBefore") : "",
      ]
        .join(" ")
        .trim()
    : "";

  const composer = selection && (
    <form aria-label={t("changes.composer")} className="flex flex-col gap-2 rounded-md border p-3">
      <p className="font-mono text-xs">{where}</p>
      <Textarea
        aria-label={t("changes.commentLabel")}
        value={body}
        className="min-h-16"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={() => void addComment()}>
          {t("changes.addComment")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setSelection(null)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );

  const fileRow = (file: DiffFile, root: string) => (
    <li key={`${file.path}:${file.uncommitted}`} className="flex items-center gap-2">
      <span className="font-mono text-xs">{file.path}</span>
      <span className="text-muted-foreground text-xs tabular-nums">{`+${file.additions} −${file.deletions}`}</span>
      <Badge variant="outline">{t(`changes.status.${file.status}`)}</Badge>
      {file.binary && <Badge variant="outline">{t("changes.binary")}</Badge>}
      {file.uncommitted && (
        <Badge variant="outline" className="text-status-needs-you">
          {t("diff.uncommitted")}
        </Badge>
      )}
      <span className="ml-auto flex">
        {!file.binary && file.status !== "deleted" && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("changes.edit", { path: file.path })}
            onClick={() => setEditing(file.path)}
          >
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("changes.revert", { path: file.path })}
          onClick={() => setReverting(file.path)}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
        </Button>
        <FileSessions store={store} hostId={hostId} root={root} path={file.path} />
      </span>
    </li>
  );

  if (unavailable !== null && changes === null) {
    return (
      <section aria-label={t("changes.region")}>
        <InlineNotice tone="info">{t("changes.unavailable", { reason: unavailable })}</InlineNotice>
      </section>
    );
  }
  if (changes === null) {
    return <p className="text-muted-foreground text-sm">{t("changes.loading")}</p>;
  }
  return (
    <section aria-label={t("changes.region")} className="flex flex-col gap-4">
      {props.extra?.(changes, refresh)}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          {t("changes.refresh")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={mode === "unified"}
          className="aria-pressed:bg-accent"
          onClick={() => setMode("unified")}
        >
          {t("diff.unified")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={mode === "split"}
          className="aria-pressed:bg-accent"
          onClick={() => setMode("split")}
        >
          {t("diff.split")}
        </Button>
      </div>
      {undo && (
        <div role="status" className="flex items-center gap-2 text-sm">
          <span>{t("changes.reverted", { path: undo.path })}</span>
          <Button variant="outline" size="sm" onClick={() => void undoRevert(undo.path)}>
            {t("changes.undo")}
          </Button>
        </div>
      )}
      {changes.files.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("changes.empty")}</p>
      ) : (
        <>
          <ul aria-label={t("diff.changedFiles")} className="flex flex-col gap-1 text-sm">
            {changes.files.map((file) => fileRow(file, changes.root))}
          </ul>
          <DiffView
            files={changes.files}
            mode={mode}
            selection={selection}
            onPick={onPick}
            composer={composer}
          />
        </>
      )}
      {comments.length > 0 && (
        <ReviewList
          comments={comments}
          onUpdate={(id, text) =>
            void store.hostCommand(hostId, "review.update", { id, body: text }).then(loadComments)
          }
          onRemove={(id) =>
            void store.hostCommand(hostId, "review.remove", { id }).then(loadComments)
          }
          onSend={() => void send()}
        />
      )}
      {reverting && (
        <ConfirmDialog
          message={`${t("changes.revertTitle", { path: reverting })} ${
            changes.base
              ? t("changes.revertMessageBase", { base: changes.base })
              : t("changes.revertMessageHead")
          }`}
          confirmLabel={t("changes.revertConfirm")}
          destructive
          onConfirm={() => void revert(reverting)}
          onCancel={() => setReverting(null)}
        />
      )}
      {editing && (
        <FileEditor
          store={store}
          hostId={hostId}
          target={target}
          path={editing}
          onSaved={() => void refresh()}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
