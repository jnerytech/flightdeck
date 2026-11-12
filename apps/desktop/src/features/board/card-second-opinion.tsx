import type { Card, CardReviewResult, ChangesResult } from "@flightdeck/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { T } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { cardStartBlock } from "@/lib/card-start-block";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { FindingSeverity } from "../review/index.ts";

type Outcome = { kind: "result"; result: CardReviewResult } | { kind: "refused"; text: string };

/** Why the button is off, or null: a run is going, or there is nothing to read. */
function whyOff(card: Card, changes: ChangesResult, t: T): string | null {
  const block = cardStartBlock(card);
  if (block === "queued") return t("secondOpinion.queued");
  if (block !== null) return t("secondOpinion.running");
  return changes.files.length === 0 ? t("secondOpinion.noChanges") : null;
}

/**
 * A second-opinion review of the card's diff before Open PR (#1446): asked for, never automatic.
 * The host answers when the review ends; its findings are reviewer drafts in the list below, and the
 * ones that fell on no changed line are listed here as plain text. The host's refusals say why.
 */
export function CardSecondOpinion(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    changes: ChangesResult;
    /** The reviewer drafts are on the host now: the Changes panel reads its comments again. */
    onReviewed(): void | Promise<void>;
    /** Puts the focus on the first reviewer draft, which sits after the whole diff (#1496). */
    onGoToDrafts?: () => void;
  }>,
) {
  const t = useT();
  const { store, hostId, card, changes } = props;
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const askButton = useRef<HTMLButtonElement>(null);
  const asking = useRef(false);
  const section = useRef<HTMLElement>(null);
  /**
   * Answers received: the button was off while the host read, so the browser dropped its focus and it
   * goes back once the button is on (#1495). Focus the person moved somewhere else (a comment they
   * began) stays where it is.
   */
  const [answered, setAnswered] = useState(0);
  useEffect(() => {
    if (answered === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body || section.current?.contains(active)) {
      askButton.current?.focus();
    }
  }, [answered]);
  const off = whyOff(card, changes, t);

  const ask = async () => {
    // A ref too: two clicks in the same event see the first one before React renders it.
    if (busy || asking.current) return;
    asking.current = true;
    setBusy(true);
    setOutcome(null);
    let next: Outcome;
    try {
      const answer = await store.hostRequest(hostId, "card.review", {
        cardId: card.id,
        language: t.lang,
      });
      next = answer.ok
        ? { kind: "result", result: answer.data }
        : { kind: "refused", text: refusalText(answer.code, answer.message, t, answer) };
    } catch {
      // The connection dropped before the host answered: the review may or may not have run.
      next = { kind: "refused", text: t("secondOpinion.unreachable") };
    }
    // The result and the button come back together: no moment with neither the result nor the wait.
    setOutcome(next);
    asking.current = false;
    setBusy(false);
    setAnswered((count) => count + 1);
    if (next.kind === "result" && next.result.anchored > 0) {
      try {
        await props.onReviewed();
      } catch {
        // The review itself succeeded and its result is shown. Only this read failed (a dropped
        // connection): the drafts appear on the panel's next read, a change on disk or Refresh.
      }
    }
  };

  return (
    <section ref={section} aria-label={t("secondOpinion.title")}>
      <Stack gap={2}>
        <h3 className="font-medium text-sm">{t("secondOpinion.title")}</h3>
        <p className="text-muted-foreground text-sm">{t("secondOpinion.intro")}</p>
        <div>
          <ActionButton
            ref={askButton}
            variant="outline"
            size="sm"
            disabled={off !== null || busy}
            pending={busy}
            aria-describedby={off ? reasonId : undefined}
            // The wait is this component's own (busy), so the button is on again with the answer.
            onClick={() => void ask()}
          >
            {t("secondOpinion.ask")}
          </ActionButton>
        </div>
        {off && (
          <p id={reasonId} className="text-muted-foreground text-xs">
            {off}
          </p>
        )}
        {busy && (
          <output className="text-muted-foreground text-sm">{t("secondOpinion.reading")}</output>
        )}
        {outcome?.kind === "refused" && <InlineNotice tone="error">{outcome.text}</InlineNotice>}
        <div // NOSONAR: always on the page, so a screen reader announces what is put in it; holds a list
          role="status"
          className="flex flex-col gap-2"
        >
          {outcome?.kind === "result" && (
            <ReviewOutcome
              result={outcome.result}
              {...(props.onGoToDrafts ? { onGoToDrafts: props.onGoToDrafts } : {})}
            />
          )}
        </div>
      </Stack>
    </section>
  );
}

/** How many findings became drafts in the list below, or null when none did. */
function draftsNote(anchored: number, t: T): string | null {
  if (anchored === 0) return null;
  return anchored === 1 ? t("secondOpinion.draftsOne") : t("secondOpinion.drafts", { n: anchored });
}

/** What the review said: its summary and notes, then the findings that are on no changed line. */
function ReviewOutcome(props: Readonly<{ result: CardReviewResult; onGoToDrafts?: () => void }>) {
  const t = useT();
  const { result } = props;
  const notes = [
    result.cached ? t("secondOpinion.cached") : null,
    result.moved ? t("secondOpinion.moved") : null,
    result.state === "failed" ? t("secondOpinion.failed") : null,
  ].filter((note): note is string => note !== null);
  const drafts = draftsNote(result.anchored, t);
  return (
    <>
      {result.summary && <p className="text-sm">{result.summary}</p>}
      {notes.map((note) => (
        <p key={note} className="text-muted-foreground text-xs">
          {note}
        </p>
      ))}
      {drafts && (
        <Inline gap={2}>
          <p className="text-muted-foreground text-xs">{drafts}</p>
          {props.onGoToDrafts && (
            <Button variant="outline" size="sm" onClick={props.onGoToDrafts}>
              {t("secondOpinion.goToDrafts")}
            </Button>
          )}
        </Inline>
      )}
      {result.loose.length > 0 && (
        <div>
          <h4 className="font-medium text-xs">
            {t("secondOpinion.loose", { n: result.loose.length })}
          </h4>
          <ul className="flex list-none flex-col gap-2">
            {result.loose.map((finding, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: the reviewer may repeat a finding, and the list never reorders
                key={`${index}:${finding.path}:${finding.line}`}
                className="flex flex-col gap-1 rounded-md border p-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-xs">
                    {t("secondOpinion.place", { path: finding.path, line: finding.line })}
                  </span>
                  <FindingSeverity severity={finding.severity} />
                </span>
                <span className="whitespace-pre-wrap break-words">{finding.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
