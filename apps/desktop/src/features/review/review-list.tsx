import type { ReviewComment } from "@flightdeck/protocol";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import { Inline } from "@/shared/layout/index.ts";
import { FindingSeverity } from "./finding-severity.tsx";

/** The review's comments: drafts to edit or remove, then the ones already sent as history. */
export function ReviewList(
  props: Readonly<{
    comments: ReviewComment[];
    onUpdate(id: string, body: string): void;
    onRemove(id: string): void;
    onSend(): void;
    /** Puts the review in the message box instead of sending it; absent where there is none. */
    onCompose?: () => void;
  }>,
) {
  const t = useT();
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const drafts = props.comments.filter((c) => c.state === "draft").length;
  return (
    <section className="flex flex-col gap-2">
      <ul aria-label={t("changes.list")} className="flex flex-col gap-2">
        {props.comments.map((comment) => {
          const where =
            comment.lineStart === comment.lineEnd
              ? t("changes.lines", { line: comment.lineStart })
              : t("changes.linesRange", { from: comment.lineStart, to: comment.lineEnd });
          return (
            <li
              key={comment.id}
              // A reviewer comment is where Go to the drafts puts the focus (#1496). The outline is
              // on :focus, not :focus-visible: after a mouse click on that button, Chrome would not
              // mark the draft it went to.
              {...(comment.author === "reviewer"
                ? { "data-reviewer": comment.state, tabIndex: -1 }
                : {})}
              className="flex flex-col gap-1 rounded-md border p-3 text-sm focus:outline-2 focus:outline-ring"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{`${comment.path} · ${where}`}</span>
                <Badge variant="outline">
                  {t(comment.state === "draft" ? "changes.draft" : "changes.sent")}
                </Badge>
                {comment.author === "reviewer" && (
                  <Badge variant="outline">{t("secondOpinion.reviewer")}</Badge>
                )}
                {comment.severity && <FindingSeverity severity={comment.severity} />}
                {comment.outdated && (
                  <Badge variant="outline" className="text-status-needs-you">
                    {t("changes.outdated")}
                  </Badge>
                )}
              </div>
              {comment.quote.trim() === "" ? (
                // A blank line quoted as code is an empty grey bar that reads as a failed load (#1497).
                <p className="text-muted-foreground text-xs italic">
                  {t(
                    comment.lineStart === comment.lineEnd
                      ? "changes.blankLine"
                      : "changes.blankLines",
                  )}
                </p>
              ) : (
                <pre className="overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
                  {comment.quote}
                </pre>
              )}
              {editing?.id === comment.id ? (
                <div className="flex items-start gap-2">
                  <Textarea
                    aria-label={t("changes.commentText")}
                    value={editing.body}
                    className="min-h-16 flex-1"
                    onChange={(e) => setEditing({ id: comment.id, body: e.target.value })}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      props.onUpdate(comment.id, editing.body);
                      setEditing(null);
                    }}
                  >
                    {t("changes.saveComment")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{comment.body}</p>
              )}
              {comment.state === "draft" && editing?.id !== comment.id && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("changes.editComment", { path: comment.path, where })}
                    onClick={() => setEditing({ id: comment.id, body: comment.body })}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  {comment.author === "reviewer" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("secondOpinion.dismissFinding", { path: comment.path, where })}
                      onClick={() => props.onRemove(comment.id)}
                    >
                      {t("secondOpinion.dismiss")}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("changes.removeComment", { path: comment.path, where })}
                      onClick={() => props.onRemove(comment.id)}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {drafts > 0 && (
        <Inline gap={2}>
          <Button onClick={props.onSend}>{t("changes.send", { n: drafts })}</Button>
          {props.onCompose && (
            <Button variant="outline" onClick={props.onCompose}>
              {t("changes.compose", { n: drafts })}
            </Button>
          )}
        </Inline>
      )}
    </section>
  );
}
