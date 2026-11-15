import { CircleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { QuotaGlance } from "@/features/quota/index.ts";
import type { Key, T } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { IconTip } from "@/shared/feedback/index.ts";
import { Meter } from "@/shared/status/index.ts";
import { QuotaDetail } from "./quota-detail.tsx";

/**
 * The plan quota at a glance (issue #118): the window under most pressure across the online hosts,
 * as a small meter, its percent and the time left. Its name says the state in words, the host and
 * when it resets; near or at the limit a mark shows too. Pressing it opens that host.
 */
export function QuotaGlanceButton(
  props: Readonly<{
    t: T;
    glance: QuotaGlance | null;
    hostName: string;
    onOpen(hostId: string): void;
    /** What pressing it opens (issue #1218): without it, the button opens the host. */
    detail?: (close: () => void) => ReactNode;
  }>,
) {
  const { t, glance } = props;
  const [open, setOpen] = useState(false);
  if (!glance) return null;
  const window = t(`account.windows.${glance.window}` as Key);
  const vars = {
    state: t(`shell.quotaLevels.${glance.level}` as Key),
    window,
    percent: String(glance.percent),
    host: props.hostName,
    remaining: glance.remaining,
  };
  const name = glance.remaining ? t("shell.quotaLabel", vars) : t("shell.quotaLabelNoReset", vars);
  const button = (
    <button
      type="button"
      aria-label={name}
      data-level={glance.level}
      className="status-item status-quota"
      {...(props.detail ? {} : { onClick: () => props.onOpen(glance.hostId) })}
    >
      {glance.level !== "ok" && <CircleAlert aria-hidden="true" data-mark="" />}
      <span className="status-quota-window">{window}</span>
      <Meter
        label={window}
        value={Math.min(glance.percent, 100)}
        max={100}
        hot={glance.level === "reached"}
        className="status-meter"
      />
      <span>{glance.percent}%</span>
      {glance.remaining && <span className="status-quota-reset">{glance.remaining}</span>}
    </button>
  );
  if (!props.detail) return <IconTip label={name}>{button}</IconTip>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <IconTip label={name}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </IconTip>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={8}
        aria-label={t("quota.popover.label")}
        className="max-h-[70vh] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto"
      >
        {props.detail(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/** The quota's windows and guard, shown in the popover that the quota item opens. */
export const quotaDetailFor = (store: AppStore) => (close: () => void) => (
  <QuotaDetail store={store} onClose={close} />
);
