import type { PrComment } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { isExternalAuthor } from "../lib/review.ts";

/**
 * The review comments of a card's PR (GitHub or Azure DevOps), read by the host: file and line,
 * author (marked when from outside the team), resolved or not. The open ones come selected;
 * "Enviar ao agente" hands the chosen ones to the card's session. Nothing is posted back.
 */
export function PrComments(props: {
  store: AppStore;
  hostId: string;
  cardId: string;
  /** Changes whenever the card did (its PR is polled): the comments are read again. */
  moment: string;
}) {
  const t = useT();
  const { store, hostId, cardId } = props;
  const [comments, setComments] = useState<PrComment[] | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `moment` is the trigger
  useEffect(() => {
    void store.hostCommand(hostId, "pr.comments", { cardId }).then((result) => {
      setComments(result?.comments ?? []);
    });
  }, [store, hostId, cardId, props.moment]);

  if (comments === null) return null;
  // Until the user picks by hand, the open comments are the chosen ones.
  const chosen = picked ?? new Set(comments.filter((c) => !c.resolved).map((c) => c.id));
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  };
  const send = async () => {
    const ids = comments.filter((c) => chosen.has(c.id)).map((c) => c.id);
    const result = await store.hostCommand(hostId, "pr.comments.send", { cardId, ids });
    if (result) store.success(t("cardReview.sentToAgent", { n: result.sent }));
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-sm">{t("cardReview.prComments")}</h3>
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("cardReview.prEmpty")}</p>
      ) : (
        <>
          <ul aria-label={t("cardReview.prComments")} className="flex flex-col gap-2">
            {comments.map((comment) => (
              <li key={comment.id} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  aria-label={t("cardReview.select", { author: comment.author })}
                  checked={chosen.has(comment.id)}
                  onChange={() => toggle(comment.id)}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">
                      {comment.path
                        ? `${comment.path}${comment.line ? `:${comment.line}` : ""}`
                        : t("cardReview.review")}
                    </span>
                    <span className="font-medium">{comment.author}</span>
                    {comment.authorIdentity && (
                      <span className="text-muted-foreground text-xs">{`(${comment.authorIdentity})`}</span>
                    )}
                    {comment.resolved && (
                      <Badge variant="outline">{t("cardReview.resolved")}</Badge>
                    )}
                    {isExternalAuthor(comment) && (
                      <Badge
                        variant="outline"
                        title={t("cardReview.externalHint")}
                        className="text-status-needs-you"
                      >
                        {t("cardReview.external")}
                      </Badge>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{comment.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <Button disabled={chosen.size === 0} onClick={() => void send()}>
              {t("cardReview.sendToAgent", { n: chosen.size })}
            </Button>
            <span className="text-muted-foreground text-xs">{t("cardReview.prNote")}</span>
          </div>
        </>
      )}
    </section>
  );
}
