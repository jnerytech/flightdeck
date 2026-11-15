import type { CostsFilter, UsageOrigin } from "@flightdeck/protocol";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScopeMenu } from "@/features/shell/ui.ts";
import { useT } from "@/i18n/context";
import { NativeSelect, Toolbar } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import { PERIODS, type Period } from "./domain/costs.ts";

const ORIGINS: UsageOrigin[] = ["terminal", "app", "card", "workflow", "subagent"];

type ScopeProps = ComponentProps<typeof ScopeMenu>;

/** The costs screen's filters: scope, period, date range, model and origin. */
export function CostsFilters(
  props: Readonly<{
    store: ScopeProps["store"];
    hosts: ScopeProps["hosts"];
    projects: readonly { key: string; label: string }[];
    scope: ScopeProps["scope"];
    onPickScope: ScopeProps["onPick"];
    period: Period;
    onPeriod(period: Period): void;
    range: { from: string; to: string };
    onRange(range: { from: string; to: string }): void;
    filters: Omit<CostsFilter, "from" | "to" | "projectKey">;
    onFilter(name: "model" | "origin", value: string): void;
    /** The models the whole period used: the model filter offers these. */
    models: readonly string[];
  }>,
) {
  const t = useT();
  const { period, range, filters } = props;
  return (
    <Toolbar label={t("costsUi.filters")}>
      {(props.hosts.length > 1 || props.projects.length > 0) && (
        <ScopeMenu
          store={props.store}
          hosts={props.hosts}
          projects={props.projects}
          scope={props.scope}
          onPick={props.onPickScope}
        />
      )}
      {PERIODS.map((p) => (
        <Button
          key={p}
          variant="outline"
          size="sm"
          aria-pressed={period === p}
          className="aria-pressed:bg-accent"
          onClick={() => props.onPeriod(p)}
        >
          {t(`periods.${p}` as Key)}
        </Button>
      ))}
      {period === "range" && (
        <>
          <Input
            type="date"
            aria-label={t("costsUi.from")}
            className="h-8 w-36 text-xs"
            value={range.from}
            onChange={(e) => props.onRange({ ...range, from: e.target.value })}
          />
          <Input
            type="date"
            aria-label={t("costsUi.to")}
            className="h-8 w-36 text-xs"
            value={range.to}
            onChange={(e) => props.onRange({ ...range, to: e.target.value })}
          />
        </>
      )}
      <NativeSelect
        inline
        compact
        aria-label={t("costsUi.model")}
        value={filters.model ?? ""}
        onChange={(e) => props.onFilter("model", e.target.value)}
      >
        <option value="">{t("costsUi.allModels")}</option>
        {props.models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        inline
        compact
        aria-label={t("costsUi.origin")}
        value={filters.origin ?? ""}
        onChange={(e) => props.onFilter("origin", e.target.value)}
      >
        <option value="">{t("costsUi.allOrigins")}</option>
        {ORIGINS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </NativeSelect>
    </Toolbar>
  );
}
