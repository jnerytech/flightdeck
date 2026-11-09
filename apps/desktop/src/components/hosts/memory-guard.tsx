import { useId } from "react";
import { NativeSelect } from "@/components/layout/form";
import { Inline, Stack } from "@/components/layout/stack";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { hasFeature } from "@/lib/version";

/** The shares the select offers; a value the config holds outside these is added. */
const CHOICES = [0.7, 0.8, 0.85, 0.9, 0.95];

const OFF = "off";

/**
 * The host's memory hold for new cards (issue #1343): from this share of used memory on, a new card
 * waits and starts once memory frees up. Sessions already running are never stopped. Only on a
 * host that offers the setting; an older one shows nothing.
 */
export function MemoryGuard(
  props: Readonly<{
    store: AppStore;
    host: HostView;
    pauseAt: number | null;
    onChange: (pauseAt: number | null) => void;
  }>,
) {
  const { store, host, pauseAt, onChange } = props;
  const t = useT();
  const id = useId();
  if (!hasFeature(host.hostInfo?.features, "memoryPause", false)) return null;
  const choices =
    pauseAt === null || CHOICES.includes(pauseAt)
      ? CHOICES
      : [...CHOICES, pauseAt].sort((a, b) => a - b);
  const set = async (next: number | null) => {
    // A refusal goes to the banner and leaves the hold as it was.
    const answer = await store.hostCommand(host.id, "resources.setPauseAt", { pauseAt: next });
    if (answer) onChange(answer.pauseAt);
  };
  return (
    <Stack gap={1}>
      <Inline gap={2}>
        <label htmlFor={id} className="text-sm">
          {t("resources.guard.label")}
        </label>
        <NativeSelect
          id={id}
          inline
          aria-label={t("resources.guard.labelFor", { host: host.name })}
          value={pauseAt === null ? OFF : String(pauseAt)}
          onChange={(event) =>
            void set(event.target.value === OFF ? null : Number(event.target.value))
          }
        >
          {choices.map((value) => (
            <option key={value} value={String(value)}>
              {`${Math.round(value * 100)}%`}
            </option>
          ))}
          <option value={OFF}>{t("resources.guard.off")}</option>
        </NativeSelect>
      </Inline>
      <p className="text-muted-foreground text-xs">{t("resources.guard.hint")}</p>
    </Stack>
  );
}
