import type { DepResult, DepsResult } from "@flightdeck/protocol";
import { Check, Copy, Minus, TriangleAlert, X } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { type DepLook, depLook, depsSummary, fixFor } from "../../lib/deps-summary.ts";

const ICONS = { check: Check, warning: TriangleAlert, cross: X, dash: Minus } as const;
// Whole class names, so Tailwind finds them.
const TONES: Record<DepLook["tone"], string> = {
  ok: "text-status-ok",
  warn: "text-status-needs-you",
  error: "text-status-error",
  off: "text-status-ended",
};

/**
 * The host's dependencies, required and optional, each with what stops working without it and how
 * to fix it. Every row and the headline carry an icon and a word besides the color.
 */
export function HostDeps(props: {
  store: AppStore;
  deps: DepsResult | null;
  /** The host's operating system, as `host.info` says it. */
  os: string;
  onCheck(): Promise<void>;
}) {
  const { t } = props.store.i18n;
  const items = props.deps?.items ?? [];
  const summary = depsSummary(items);
  const headline = {
    ok: props.deps ? t("hostDeps.allSet") : t("hostDeps.checking"),
    optional: t("hostDeps.optionalMissing", { n: summary.n }),
    required: t("hostDeps.requiredMissing", { n: summary.n }),
  }[summary.kind];
  const headlineLook: DepLook =
    summary.kind === "ok"
      ? props.deps
        ? { icon: "check", tone: "ok" }
        : { icon: "dash", tone: "off" }
      : summary.kind === "optional"
        ? { icon: "warning", tone: "warn" }
        : { icon: "cross", tone: "error" };
  const HeadIcon = ICONS[headlineLook.icon];
  const row = (item: DepResult) => {
    const look = depLook(item);
    const Icon = ICONS[look.icon];
    const name = t(`hostDeps.names.${item.id}` as Key);
    const fix = item.state === "ok" || item.state === "na" ? null : fixFor(item, props.os);
    const found = [
      item.version ? t("hostDeps.version", { version: item.version }) : null,
      item.minVersion ? t("hostDeps.minVersion", { version: item.minVersion }) : null,
      item.path ?? null,
    ].filter(Boolean);
    return (
      <li key={item.id} aria-label={name} className="dep-row">
        <span className="dep-line">
          <Icon
            data-slot="dep-icon"
            data-icon={look.icon}
            aria-hidden="true"
            className={TONES[look.tone]}
          />
          <strong>{name}</strong>
          <span className={TONES[look.tone]}>{t(`hostDeps.state.${item.state}` as Key)}</span>
        </span>
        {found.length > 0 && <span className="dep-found">{found.join(" · ")}</span>}
        {item.state !== "ok" && item.state !== "na" && item.breaks.length > 0 && (
          <span className="text-sm">
            {t("hostDeps.without", {
              features: item.breaks
                .map((feature) => t(`hostDeps.breaks.${feature}` as Key))
                .join(", "),
            })}
          </span>
        )}
        {fix && (
          <span className="dep-fix">
            <code className="font-mono text-xs">{fix}</code>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t("hostDeps.copy", { name })}
              onClick={() => void props.store.copyText(fix)}
            >
              <Copy aria-hidden="true" />
            </Button>
          </span>
        )}
      </li>
    );
  };
  const group = (which: DepResult["group"]) => {
    const list = items.filter((item) => item.group === which);
    if (list.length === 0) return null;
    return (
      <Stack gap={2}>
        <h4 className="font-medium text-muted-foreground text-xs">
          {t(`hostDeps.groups.${which}` as Key)}
        </h4>
        <ul aria-label={t(`hostDeps.groups.${which}` as Key)} className="dep-list">
          {list.map(row)}
        </ul>
      </Stack>
    );
  };
  return (
    <Panel title={t("hostDeps.title")} label={t("hostDeps.title")}>
      <p role="status" className="dep-line">
        <HeadIcon data-slot="dep-icon" aria-hidden="true" className={TONES[headlineLook.tone]} />
        <strong>{headline}</strong>
      </p>
      {group("required")}
      {group("optional")}
      <div>
        <ActionButton variant="outline" size="sm" onClick={props.onCheck}>
          {t("hostDeps.check")}
        </ActionButton>
      </div>
    </Panel>
  );
}
