import type { ReviewComment } from "@flightdeck/protocol";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";

/** The review's comments: drafts to edit or remove, then the ones already sent as history. */
export function ReviewList(props: {
  comments: ReviewComment[];
  onUpdate(id: string, body: string): void;
  onRemove(id: string): void;
  onSend(): void;
}) {
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
            <li key={comment.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{`${comment.path} · ${where}`}</span>
                <Badge variant="outline">
                  {t(comment.state === "draft" ? "changes.draft" : "changes.sent")}
                </Badge>
                {comment.outdated && (
                  <Badge variant="outline" className="text-status-needs-you">
                    {t("changes.outdated")}
                  </Badge>
                )}
              </div>
              <pre className="overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
                {comment.quote}
              </pre>
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
                <p className="whitespace-pre-wrap">{comment.body}</p>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("changes.removeComment", { path: comment.path, where })}
                    onClick={() => props.onRemove(comment.id)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {drafts > 0 && (
        <div>
          <Button onClick={props.onSend}>{t("changes.send", { n: drafts })}</Button>
        </div>
      )}
    </section>
  );
}
