import { Timer } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AppStore } from "../../lib/app-store.ts";
import { cacheTimer, spokenParts } from "../../lib/cache-timer.ts";

const NEVER = () => () => {};

/**
 * The prompt cache countdown of an idle session: `m:ss` while the cache is warm, in the warning
 * tone for its last minute, then only the icon (cold). It draws nothing when the setting is off,
 * and listens to the shared clock only while it draws.
 */
export function CacheTimer(props: {
  store: AppStore;
  since: string | null | undefined;
  /** The icon alone, for where there is no room for the digits: the tooltip says the time. */
  compact?: boolean;
}) {
  const { store } = props;
  const { t } = store.i18n;
  const settings = store.cacheTimer;
  const enabled = useSyncExternalStore(settings.subscribe, () => settings.enabled);
  const ttl = useSyncExternalStore(settings.subscribe, () => settings.ttl);
  const known = enabled && !Number.isNaN(Date.parse(props.since ?? ""));
  // The second only: the text changes once a second, and a snapshot must hold still between them.
  const now = useSyncExternalStore(known ? store.clock.subscribe : NEVER, () =>
    Math.floor(store.clock.now() / 1000),
  );
  const view = known ? cacheTimer(props.since, now * 1000, ttl) : null;
  if (!view) return null;
  const cold = view.phase === "cold";
  const { minutes, seconds } = spokenParts(view.remainingMs);
  const spoken = [
    minutes > 0
      ? t(minutes === 1 ? "cacheTimer.minutesOne" : "cacheTimer.minutes", { n: minutes })
      : "",
    seconds > 0
      ? t(seconds === 1 ? "cacheTimer.secondsOne" : "cacheTimer.seconds", { n: seconds })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={cold ? t("cacheTimer.cold") : t("cacheTimer.expires", { time: spoken })}
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] tabular-nums",
              view.phase === "warning" ? "text-status-needs-you" : "text-muted-foreground",
            )}
          >
            <Timer aria-hidden="true" className="size-2.5" />
            {!cold && <span className="inline-block min-w-[4ch] text-left">{view.text}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {cold ? t("cacheTimer.coldTip") : t("cacheTimer.expires", { time: view.text })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
