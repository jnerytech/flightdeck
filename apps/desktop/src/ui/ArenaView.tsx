import type { Arena, ArenaVariant, CardDiff } from "@flightdeck/protocol";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { usd } from "../lib/costs.ts";
import { DiffView } from "./DiffView.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

/** A variant that has not stopped working cannot be chosen yet. */
const WORKING = new Set(["starting", "running", "awaiting_permission"]);

/** Still starting, queued or working: the comparison is not final. */
export const variantBusy = (variant: ArenaVariant) =>
  variant.queued ||
  (variant.sessionStatus !== null && WORKING.has(variant.sessionStatus)) ||
  (variant.worktreePath === null && variant.notice === null);

const duration = (ms: number | null) => {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
};

/** The arena's variants side by side: state, duration, cost, files, checks and their diffs. */
export function ArenaView(props: {
  arena: Arena;
  loadDiff(variantId: string): Promise<CardDiff | null>;
  onChoose(variant: ArenaVariant): void;
}) {
  const t = useT();
  return (
    <section
      aria-label={t("arenaUi.comparison")}
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {props.arena.variants.map((variant) => (
        <VariantColumn key={variant.id} variant={variant} {...props} />
      ))}
    </section>
  );
}

function VariantColumn(props: {
  variant: ArenaVariant;
  loadDiff(variantId: string): Promise<CardDiff | null>;
  onChoose(variant: ArenaVariant): void;
}) {
  const t = useT();
  const { variant } = props;
  const [diff, setDiff] = useState<CardDiff | null>(null);
  const [shown, setShown] = useState(false);
  // Nothing to see or to choose until the variant has its worktree and has stopped working.
  const ready = variant.worktreePath !== null;
  const toggleDiff = () => {
    setShown(!shown);
    if (!shown) void props.loadDiff(variant.id).then(setDiff);
  };
  return (
    <section
      aria-label={t("arenaUi.variantName", { name: variant.label })}
      className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{t("arenaUi.variantName", { name: variant.label })}</h3>
        {variant.queued && <Badge variant="outline">{t("arenaUi.queued")}</Badge>}
        {variant.sessionStatus && <StatusBadge status={variant.sessionStatus} />}
      </div>
      <p className="text-muted-foreground text-xs">
        {variant.model ?? t("arenaUi.modelDefault")}
        {variant.effort && ` · ${t("arenaUi.effortValue", { effort: variant.effort })}`}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t("arenaUi.duration")}</dt>
        <dd className="tabular-nums">{duration(variant.durationMs)}</dd>
        <dt className="text-muted-foreground">{t("arenaUi.cost")}</dt>
        <dd className="tabular-nums">
          <output aria-label={t("arenaUi.costOf")}>
            {variant.costUsd === null ? "—" : usd(variant.costUsd)}
          </output>
        </dd>
        <dt className="text-muted-foreground">{t("arenaUi.files")}</dt>
        <dd>
          {variant.files.length === 0 ? (
            <span>{t("arenaUi.noFiles")}</span>
          ) : (
            <span className="tabular-nums">
              {variant.files.length} · +{variant.files.reduce((sum, f) => sum + f.additions, 0)} −
              {variant.files.reduce((sum, f) => sum + f.deletions, 0)}
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">{t("arenaUi.checks")}</dt>
        <dd>
          {variant.checks.length === 0 ? (
            <span>{t("arenaUi.noChecks")}</span>
          ) : (
            <ul>
              {variant.checks.map((check) => (
                <li key={check.stepId}>
                  {check.stepId}: {check.status}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      {variant.notice && <p className="text-status-needs-you text-xs">{variant.notice}</p>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!ready} onClick={toggleDiff}>
          {t(shown ? "arenaUi.hideDiff" : "arenaUi.showDiff")}
        </Button>
        <Button
          size="sm"
          disabled={variantBusy(variant)}
          onClick={() => props.onChoose(variant)}
          aria-label={t("arenaUi.choose", { name: variant.label })}
        >
          {t("arenaUi.choose", { name: variant.label })}
        </Button>
      </div>
      {shown && diff && (
        <DiffView
          files={diff.files}
          mode="unified"
          selection={null}
          onPick={() => {}}
          composer={null}
        />
      )}
    </section>
  );
}
