import { Inline, Stack } from "@/components/layout/stack";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { hasFeature } from "@/lib/version";

/** The guards the select offers; 0 would stop every new card, so it is not one. A value the config holds outside these is added. */
const CHOICES = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

const OFF = "off";

/**
 * The host's guard "new cards wait from N%" (issue #1218): a select with the percentages and Never.
 * It only decides whether a new card starts; sessions already running are never stopped. On a host
 * that cannot change it from the app, it says where the guard stands, as text.
 */
export function QuotaGuard(
  props: Readonly<{ store: AppStore; host: HostView; pauseAt: number | null }>,
) {
  const { store, host, pauseAt } = props;
  const t = useT();
  if (!hasFeature(host.hostInfo?.features, "quotaPause", false)) {
    return (
      <p className="text-muted-foreground text-xs">
        {pauseAt === null
          ? t("quota.guard.readOnlyOff")
          : t("quota.guard.readOnly", { pct: Math.round(pauseAt * 100) })}
      </p>
    );
  }
  const choices =
    pauseAt === null || CHOICES.includes(pauseAt)
      ? CHOICES
      : [...CHOICES, pauseAt].sort((a, b) => a - b);
  return (
    <Stack gap={1}>
      <Inline gap={2}>
        <label htmlFor={`quota-guard-${host.id}`} className="text-sm">
          {t("quota.guard.label")}
        </label>
        <select
          id={`quota-guard-${host.id}`}
          aria-label={t("quota.guard.label")}
          value={pauseAt === null ? OFF : String(pauseAt)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          onChange={(event) =>
            void store.setQuotaPause(
              host.id,
              event.target.value === OFF ? null : Number(event.target.value),
            )
          }
        >
          {choices.map((value) => (
            <option key={value} value={String(value)}>
              {`${Math.round(value * 100)}%`}
            </option>
          ))}
          <option value={OFF}>{t("quota.guard.off")}</option>
        </select>
      </Inline>
      <p className="text-muted-foreground text-xs">{t("quota.guard.hint")}</p>
    </Stack>
  );
}
