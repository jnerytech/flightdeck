import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "../../lib/app-store.ts";

/** The delays the select offers, in minutes; 0 is off. A delay the config holds outside these is added. */
const CHOICES = [0, 15, 30, 60, 240];

/**
 * How long an idle session waits before the host puts it to sleep: off, or 15 minutes to 4 hours.
 * Hidden on a daemon that does not have the switch.
 */
export function SleepSetting(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const current = host.hostInfo?.sleepAfterMinutes;
  if (current === undefined) return null;
  const choices = CHOICES.includes(current) ? CHOICES : [...CHOICES, current].sort((a, b) => a - b);
  const label = (minutes: number) =>
    minutes === 0
      ? t("sleep.off")
      : minutes === 60
        ? t("sleep.hour")
        : minutes % 60 === 0 && minutes > 60
          ? t("sleep.hours", { n: minutes / 60 })
          : t("sleep.minutes", { n: minutes });
  return (
    <Panel title={t("sleep.title")}>
      <p className="text-muted-foreground text-xs">{t("sleep.hint")}</p>
      <label className="flex items-center gap-2 text-sm">
        {t("sleep.label")}
        <select
          aria-label={t("sleep.label")}
          value={current}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          onChange={async (e) => {
            await store.hostCommand(host.id, "host.sleep", { minutes: Number(e.target.value) });
            await store.reloadHostInfo(host.id);
          }}
        >
          {choices.map((minutes) => (
            <option key={minutes} value={minutes}>
              {label(minutes)}
            </option>
          ))}
        </select>
      </label>
    </Panel>
  );
}
