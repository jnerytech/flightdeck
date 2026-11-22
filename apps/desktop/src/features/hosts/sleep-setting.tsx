import { useId } from "react";
import { useT } from "@/i18n/context";
import { NativeSelect, Panel } from "@/shared/layout/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";

/** The delays the select offers, in minutes; 0 is off. A delay the config holds outside these is added. */
const CHOICES = [0, 15, 30, 60, 240];

/**
 * How long an idle session waits before the host puts it to sleep: off, or 15 minutes to 4 hours.
 * Hidden on a daemon that does not have the switch.
 */
export function SleepSetting(props: Readonly<{ store: AppStore; host: HostView }>) {
  const { store, host } = props;
  const t = useT();
  const id = useId();
  const current = host.hostInfo?.sleepAfterMinutes;
  if (current === undefined) return null;
  const choices = CHOICES.includes(current) ? CHOICES : [...CHOICES, current].sort((a, b) => a - b);
  const label = (minutes: number) => {
    if (minutes === 0) return t("sleep.off");
    if (minutes === 60) return t("sleep.hour");
    if (minutes % 60 === 0 && minutes > 60) return t("sleep.hours", { n: minutes / 60 });
    return t("sleep.minutes", { n: minutes });
  };
  return (
    <Panel title={t("sleep.title")}>
      <p className="text-muted-foreground text-xs">{t("sleep.hint")}</p>
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        {t("sleep.label")}
        <NativeSelect
          id={id}
          inline
          aria-label={t("sleep.label")}
          value={current}
          onChange={async (e) => {
            // A refusal goes to the banner: nothing is read back and the select keeps the host's value.
            const answer = await store.hostCommand(host.id, "host.sleep", {
              minutes: Number(e.target.value),
            });
            if (!answer) return;
            store.success(t("sleep.saved", { host: host.name }));
            await store.reloadHostInfo(host.id);
          }}
        >
          {choices.map((minutes) => (
            <option key={minutes} value={minutes}>
              {label(minutes)}
            </option>
          ))}
        </NativeSelect>
      </label>
    </Panel>
  );
}
