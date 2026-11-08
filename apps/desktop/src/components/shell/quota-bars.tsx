import type { QuotaState } from "@flightdeck/protocol";
import { Inline, Stack } from "@/components/layout/stack";
import { Meter } from "@/components/status/meter";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { quotaBars } from "@/lib/quota";

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
  return (
    <>
      {quotaBars(quota, store.now(), (iso) => store.formatTime(iso), t).map((bar) => (
        <Stack key={bar.window} gap={1}>
          <Inline gap={2}>
            <span className="text-sm">{bar.label}</span>
            {bar.hasReading && <span className="font-medium text-sm">{`${bar.percent}%`}</span>}
          </Inline>
          {bar.hasReading ? (
            <>
              <Meter
                label={t("quota.meter", { window: bar.label, host: host.name })}
                value={bar.value}
                max={1}
                hot={bar.hot}
                className="w-full"
              />
              {bar.reset && <span className="text-muted-foreground text-xs">{bar.reset}</span>}
            </>
          ) : (
            <span className="text-muted-foreground text-xs">{t("quota.noReading")}</span>
          )}
        </Stack>
      ))}
    </>
  );
}
