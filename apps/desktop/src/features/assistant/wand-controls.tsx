import { WandSparkles } from "lucide-react";
import { type ReactNode, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { T } from "@/i18n/index";
import { IconActionButton, Spinner } from "@/shared/feedback/index.ts";
import { Inline, ShortArea, Stack } from "@/shared/layout/index.ts";
import { isMac } from "../shortcuts/index.ts";
import { refusalText } from "./domain/refusal-text.ts";
import { UNDO_WINDOW_MS } from "./domain/wand-state.ts";
import { wordDiff } from "./domain/word-diff.ts";
import type { Wand } from "./use-wand.ts";

/** The wand's button for a toolbar (issue #158). */
export function WandButton(props: Readonly<{ wand: Wand; t: T }>) {
  const { wand, t } = props;
  // A short window (720x480) keeps its message box as narrow as it was: the conversation keeps its room (#232).
  // Ctrl+I still reaches the wand there.
  const short = useContext(ShortArea);
  if (short) return null;
  const mac = isMac(typeof navigator === "undefined" ? undefined : navigator);
  let label = wand.writes ? t("assistantWand.write") : t("assistantWand.improve");
  if (wand.needsText) label = t("assistantWand.writeFirst");
  if (wand.otherRunning) label = t("assistantWand.busy");
  // Off for a reason the person can fix: aria-disabled, not disabled, so Tab reaches the button and
  // its tooltip and accessible name give the reason (#4167). While this wand runs, Cancel has the focus.
  const off = wand.needsText || wand.otherRunning;
  return (
    <IconActionButton
      type="button"
      label={label}
      disabled={wand.state.kind === "running"}
      aria-disabled={off || undefined}
      className={off ? "opacity-50" : undefined}
      aria-keyshortcuts={mac ? "Meta+I" : "Control+I"}
      onClick={wand.start}
    >
      <WandSparkles aria-hidden="true" />
    </IconActionButton>
  );
}

/** What changed in a text of several lines: what stayed muted, what went struck, what came in marked. */
function Changes(props: Readonly<{ before: string; after: string; t: T }>) {
  const { before, after, t } = props;
  const parts = useMemo(() => {
    let at = 0;
    return wordDiff(before, after).map((part) => {
      const key = at;
      at += part.text.length;
      return { ...part, key };
    });
  }, [before, after]);
  return (
    <fieldset
      aria-label={t("assistantWand.changes")}
      className="min-w-0 whitespace-pre-wrap text-sm"
    >
      {parts.map((part) => {
        if (part.kind === "add") return <ins key={part.key}>{part.text}</ins>;
        if (part.kind === "del") return <del key={part.key}>{part.text}</del>;
        return (
          <span key={part.key} className="text-muted-foreground">
            {part.text}
          </span>
        );
      })}
    </fieldset>
  );
}

/**
 * The element of a view the wand shows for a while. When the view goes away (a click, Escape, the
 * Undo timer) with the focus inside it, the focus goes back to the field instead of falling to the page.
 */
function useReturnFocus<E extends HTMLElement>(focusField: () => void) {
  const ref = useRef<E>(null);
  const back = useRef(focusField);
  back.current = focusField;
  // A layout effect: its cleanup runs before the view's elements leave the page, while the focus is still on one.
  useLayoutEffect(
    () => () => {
      if (ref.current?.contains(document.activeElement)) back.current();
    },
    [],
  );
  return ref;
}

type PanelProps = Readonly<{ wand: Wand; t: T; focusField: () => void }>;

function Running({ wand, t, focusField }: PanelProps) {
  const ref = useReturnFocus<HTMLOutputElement>(focusField);
  const cancel = useRef<HTMLButtonElement>(null);
  // The AI button had the focus and is off now: Cancel takes it. A person typing in the field (Ctrl+I, or
  // Retry, whose button handed the focus to the field) keeps it there, so the next key never cancels (#4166).
  useLayoutEffect(() => {
    const at = document.activeElement;
    if (!(at instanceof HTMLTextAreaElement || at instanceof HTMLInputElement))
      cancel.current?.focus();
  }, []);
  return (
    <output ref={ref} className="block">
      <Inline>
        <Spinner />
        <span className="text-sm">{t("assistantWand.running")}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          ref={cancel}
          onClick={wand.cancel}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            wand.cancel();
          }}
        >
          {t("common.cancel")}
        </Button>
      </Inline>
    </output>
  );
}

function Failed({ wand, t, focusField }: PanelProps) {
  const ref = useReturnFocus<HTMLDivElement>(focusField);
  const { state } = wand;
  if (state.kind !== "failed") return null;
  return (
    <div ref={ref} role="alert">
      <Inline>
        <span className="text-sm">
          {refusalText(t, {
            reason: state.reason,
            ...(state.params ? { params: state.params } : {}),
          })}
        </span>
        {wand.others.map(({ provider, hostName }) => (
          <Button
            type="button"
            key={provider.provider === "host" ? provider.hostId : provider.provider}
            variant="outline"
            size="sm"
            onClick={() => wand.tryWith(provider)}
          >
            {t("assistantWand.tryWith", {
              provider: hostName ?? t(`assistantSettings.${provider.provider}`),
            })}
          </Button>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={wand.discard}>
          {t("assistantWand.dismiss")}
        </Button>
      </Inline>
    </div>
  );
}

function Undoable({ wand, t, focusField }: PanelProps) {
  const ref = useReturnFocus<HTMLOutputElement>(focusField);
  return (
    <output ref={ref} className="block">
      <Inline>
        <span className="text-sm">{t("assistantWand.replaced")}</span>
        <Button type="button" variant="outline" size="sm" onClick={wand.undo}>
          {t("assistantWand.undo")}
        </Button>
        <span className="text-muted-foreground text-xs">
          {t("assistantWand.undoFor", { seconds: UNDO_WINDOW_MS / 1000 })}
        </span>
      </Inline>
    </output>
  );
}

function Preview({ wand, t, focusField }: PanelProps) {
  const ref = useReturnFocus<HTMLDivElement>(focusField);
  const { state } = wand;
  if (state.kind !== "preview") return null;
  return (
    <div // NOSONAR: a non-modal preview; <dialog> would bring the browser's own box and focus rules, and Esc is the keyboard way out
      ref={ref}
      role="dialog"
      aria-label={t("assistantWand.preview")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        wand.discard();
      }}
    >
      <Stack gap={2}>
        {!state.editing && (state.original.includes("\n") || state.proposal.includes("\n")) ? (
          <Changes before={state.original} after={state.proposal} t={t} />
        ) : (
          <>
            <Stack gap={1}>
              <span className="text-muted-foreground text-xs">{t("assistantWand.before")}</span>
              <p className="whitespace-pre-wrap text-muted-foreground text-sm">{state.original}</p>
            </Stack>
            <Stack gap={1}>
              <span className="text-muted-foreground text-xs">{t("assistantWand.after")}</span>
              {state.editing ? (
                <Textarea
                  aria-label={t("assistantWand.after")}
                  autoFocus
                  value={state.proposal}
                  onChange={(event) => wand.setProposal(event.target.value)}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm">{state.proposal}</p>
              )}
            </Stack>
          </>
        )}
        <Notices notices={state.notices} t={t} />
        {state.stale && <p className="text-sm">{t("assistantWand.stale")}</p>}
        <Inline>
          <Button type="button" size="sm" onClick={wand.accept}>
            {state.stale ? t("assistantWand.acceptAnyway") : t("assistantWand.accept")}
          </Button>
          {!state.editing && (
            <Button type="button" variant="outline" size="sm" onClick={wand.edit}>
              {t("assistantWand.edit")}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={wand.retry}>
            {t("assistantWand.retry")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={wand.discard}>
            {t("assistantWand.discard")}
          </Button>
        </Inline>
      </Stack>
    </div>
  );
}

/**
 * The wand's progress, failure and preview, above the field (issue #158). It never takes the focus
 * from the field while the person types there: a suggestion is announced, and Accept is reached by
 * Tab. What was focused in a view that goes away hands the focus to the field, or to the control
 * of the next view that asks for it (Cancel when the AI button had the focus, the After text when editing) (#4166).
 */
export function WandPanel(props: PanelProps) {
  const { state } = props.wand;
  let view: ReactNode = null;
  if (state.kind === "running") view = <Running {...props} />;
  else if (state.kind === "failed") view = <Failed {...props} />;
  else if (state.kind === "undo") view = <Undoable {...props} />;
  else if (state.kind === "preview") view = <Preview {...props} />;
  return (
    <>
      {/* Fixed to the window, not absolute: an absolute line sits where it falls in a long page and makes the page scroll (#4166). */}
      <div aria-live="polite" className="sr-only" style={{ position: "fixed" }}>
        {state.kind === "preview" ? props.t("assistantWand.ready") : ""}
      </div>
      {view}
    </>
  );
}

/** What the notices mean, in the codes the answer can carry; one the app does not know is left out. */
const NOTICE_CODES = [
  "diff_truncated",
  "lines_redacted",
  "subject_too_long",
  "subject_trailing_period",
  "subject_not_conventional",
  "body_needs_blank_line",
] as const;

/** Beside a suggestion: what was cut, left out or broken, so the person decides knowing it. */
function Notices(props: Readonly<{ notices: string[]; t: T }>) {
  const shown = NOTICE_CODES.filter((code) => props.notices.includes(code));
  if (shown.length === 0) return null;
  return (
    <ul aria-label={props.t("assistantWand.notes")} className="list-disc ps-5 text-sm">
      {shown.map((code) => (
        <li key={code}>{props.t(`assistantWand.notice.${code}`)}</li>
      ))}
    </ul>
  );
}
