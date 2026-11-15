import { Button } from "@/components/ui/button";
import type { T } from "../../i18n/index.ts";
import type { QueuedMessage } from "./use-composer-queue.ts";

/** The messages waiting for the turn to end, each with its edit and remove buttons. */
export function ComposerQueue(
  props: Readonly<{
    t: T;
    queued: QueuedMessage[];
    onEdit(item: QueuedMessage, at: number): void;
    onRemove(at: number): void;
  }>,
) {
  const { t, queued } = props;
  if (queued.length === 0) return null;
  return (
    <ul aria-label={t("session.queue")} className="composer-images">
      {queued.map((item, at) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: the queue is only ever edited by position
          key={at} // NOSONAR: the queue is only ever edited by position
          className="composer-queued"
        >
          <span className="min-w-0 flex-1 truncate text-sm">{item.text}</span>
          {item.images.length > 0 && (
            <span className="text-muted-foreground text-xs">
              {t("session.imagesSent", { count: String(item.images.length) })}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("session.queueEdit", { text: item.text })}
            onClick={() => props.onEdit(item, at)}
          >
            {t("session.edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("session.queueRemove", { text: item.text })}
            onClick={() => props.onRemove(at)}
          >
            {t("session.remove")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
