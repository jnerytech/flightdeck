import type { QuotaState } from "@flightdeck/protocol";
import { useNow } from "@/features/hosts/index.ts";
import { quotaBars } from "@/features/quota/index.ts";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { Inline, Stack } from "@/shared/layout/index.ts";
import { Meter } from "@/shared/status/index.ts";

/** The plan windows of one host as bars: how much is used and when each resets. */
export function QuotaBarList(
  props: Readonly<{
    store: AppStore;
    host: { name: string };
    quota: QuotaState | undefined;
  }>,
) {
  const { store, host, quota } = props;
  const t = useT();
  // The age of a reading moves every minute, with no new reading (#4303).
  useNow(60_000);
  return (
    <>
      {quotaBars(quota, store.now(), (iso) => store.formatTime(iso), t).map((bar) => (
        <Stack key={bar.window} gap={1}>
          <Inline gap={2}>
            <span className="text-sm">{bar.label}</span>
            {bar.hasReading && bar.percentKnown && (
              <span className="font-medium text-sm">{`${bar.percent}%`}</span>
            )}
          </Inline>
          {bar.hasReading ? (
            <>
              <Meter
                label={t("quota.meter", { window: bar.label, host: host.name })}
                value={bar.value}
                max={1}
                valueText={`${bar.percent}%`}
                hot={bar.hot || bar.out !== null}
                className="w-full"
              />
              <Inline gap={3} className="text-muted-foreground text-xs">
                {bar.reset && <span>{bar.reset}</span>}
                <span>{bar.age}</span>
              </Inline>
              {bar.out && (
                <span className="text-status-needs-you text-xs">
                  {t(`quota.out.${bar.out}`, { window: bar.label })}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground text-xs">{t("quota.noReading")}</span>
          )}
        </Stack>
      ))}
    </>
  );
}
