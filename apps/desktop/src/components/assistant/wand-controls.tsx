import { WandSparkles } from "lucide-react";
import { Spinner } from "@/components/feedback/busy";
import { IconActionButton } from "@/components/feedback/icon-action-button";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import type { T } from "@/i18n/index";
import { isMac } from "@/lib/shortcuts";
import { refusalText } from "./refusal-text.ts";
import type { Wand } from "./use-wand.ts";

/** The wand's button for a toolbar (issue #158). */
export function WandButton(props: { wand: Wand; t: T }) {
  const { wand, t } = props;
  const mac = isMac(typeof navigator === "undefined" ? undefined : navigator);
  let label = wand.writes ? t("assistantWand.write") : t("assistantWand.improve");
  if (wand.needsText) label = t("assistantWand.writeFirst");
  if (wand.otherRunning) label = t("assistantWand.busy");
  return (
    <IconActionButton
      label={label}
      disabled={wand.needsText || wand.otherRunning || wand.state.kind === "running"}
      aria-keyshortcuts={mac ? "Meta+I" : "Control+I"}
      onClick={wand.start}
    >
      <WandSparkles aria-hidden="true" />
    </IconActionButton>
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
          <Button variant="outline" size="sm" onClick={wand.cancel}>
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
          <Button variant="outline" size="sm" onClick={wand.discard}>
            {t("assistantWand.dismiss")}
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
        <Stack gap={1}>
          <span className="text-muted-foreground text-xs">{t("assistantWand.before")}</span>
          <p className="whitespace-pre-wrap text-muted-foreground text-sm">{state.original}</p>
        </Stack>
        <Stack gap={1}>
          <span className="text-muted-foreground text-xs">{t("assistantWand.after")}</span>
          <p className="whitespace-pre-wrap text-sm">{state.proposal}</p>
        </Stack>
        {state.stale && <p className="text-sm">{t("assistantWand.stale")}</p>}
        <Inline>
          <Button size="sm" autoFocus onClick={wand.accept}>
            {state.stale ? t("assistantWand.acceptAnyway") : t("assistantWand.accept")}
          </Button>
          <Button variant="outline" size="sm" onClick={wand.discard}>
            {t("assistantWand.discard")}
          </Button>
        </Inline>
      </Stack>
    </div>
  );
}
