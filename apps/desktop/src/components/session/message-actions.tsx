import { Check, Copy, GitFork, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { IconActionButton } from "@/components/feedback/icon-action-button";
import { formatAgo } from "@/i18n/format";
import type { T } from "../../i18n/index.ts";

/** How often the age under a message is worked out again. */
const TICK_MS = 30_000;

/** "há 3 min", kept current while the message is on screen. */
function Age(props: { at: string; t: T }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={props.at}>{formatAgo(Math.max(0, now - Date.parse(props.at)), props.t)}</time>
  );
}

/**
 * Under an assistant message: Copy, Fork from here (the latest message only: the fork carries the
 * whole conversation so far), Pin, and how long ago it was written. Hidden until the message is
 * hovered or something in the row has focus, but always in the keyboard's reach.
 */
export function MessageActions(props: {
  text: string;
  at: string | undefined;
  t: T;
  copyText: ((text: string) => Promise<boolean>) | undefined;
  fork: (() => void) | undefined;
  pin: { pinned: boolean; toggle(): void } | undefined;
}) {
  const { t } = props;
  const [copied, setCopied] = useState(false);
  return (
    <fieldset aria-label={t("session.messageActions")} className="message-actions">
      {props.copyText && (
        <IconActionButton
          label={t("session.copyMessage")}
          variant="ghost"
          onClick={async () => {
            setCopied(await (props.copyText as (text: string) => Promise<boolean>)(props.text));
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </IconActionButton>
      )}
      {props.fork && (
        <IconActionButton label={t("session.forkHere")} variant="ghost" onClick={props.fork}>
          <GitFork aria-hidden="true" />
        </IconActionButton>
      )}
      {props.pin && (
        <IconActionButton
          label={t("session.pinSession")}
          variant="ghost"
          aria-pressed={props.pin.pinned}
          onClick={props.pin.toggle}
        >
          <Pin aria-hidden="true" />
        </IconActionButton>
      )}
      {props.at && <Age at={props.at} t={t} />}
      <output className="sr-only">{copied ? t("session.copiedMessage") : ""}</output>
    </fieldset>
  );
}
