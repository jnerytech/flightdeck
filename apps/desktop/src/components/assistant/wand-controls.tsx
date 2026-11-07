import { WandSparkles } from "lucide-react";
import { useContext, useMemo } from "react";
import { Spinner } from "@/components/feedback/busy";
import { IconActionButton } from "@/components/feedback/icon-action-button";
import { Inline, Stack } from "@/components/layout/stack";
import { ShortArea } from "@/components/session/parts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { T } from "@/i18n/index";
import { isMac } from "@/lib/shortcuts";
import { wordDiff } from "@/lib/word-diff";
import { refusalText } from "./refusal-text.ts";
import type { Wand } from "./use-wand.ts";

/** The wand's button for a toolbar (issue #158). */
export function WandButton(props: { wand: Wand; t: T }) {
  const { wand, t } = props;
  // A short window (720x480) keeps its message box as narrow as it was: the conversation keeps its room (#232).
  // Ctrl+I still reaches the wand there.
  const short = useContext(ShortArea);
  if (short) return null;
  const mac = isMac(typeof navigator === "undefined" ? undefined : navigator);
  let label = wand.writes ? t("assistantWand.write") : t("assistantWand.improve");
  if (wand.needsText) label = t("assistantWand.writeFirst");
  if (wand.otherRunning) label = t("assistantWand.busy");
  return (
    <IconActionButton
      type="button"
      label={label}
      disabled={wand.needsText || wand.otherRunning || wand.state.kind === "running"}
      aria-keyshortcuts={mac ? "Meta+I" : "Control+I"}
      onClick={wand.start}
    >
      <WandSparkles aria-hidden="true" />
    </IconActionButton>
  );
}

/** What changed in a text of several lines: what stayed muted, what went struck, what came in marked. */
function Changes(props: { before: string; after: string; t: T }) {
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

/** The wand's progress, failure and preview, above the field (issue #158). */
export function WandPanel(props: { wand: Wand; t: T }) {
  const { wand, t } = props;
  const { state } = wand;
  if (state.kind === "running") {
    return (
      <div role="status">
        <Inline>
          <Spinner />
          <span className="text-sm">{t("assistantWand.running")}</span>
          <Button type="button" variant="outline" size="sm" onClick={wand.cancel}>
            {t("common.cancel")}
          </Button>
        </Inline>
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <div role="alert">
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
  if (state.kind === "undo") {
    return (
      <div role="status">
        <Inline>
          <span className="text-sm">{t("assistantWand.replaced")}</span>
          <Button type="button" variant="outline" size="sm" onClick={wand.undo}>
            {t("assistantWand.undo")}
          </Button>
        </Inline>
      </div>
    );
  }
  if (state.kind !== "preview") return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc closes the non-modal preview from any control in it
    <div
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
          <Button type="button" size="sm" autoFocus onClick={wand.accept}>
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
