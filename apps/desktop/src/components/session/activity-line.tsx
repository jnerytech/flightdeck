import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/i18n/format";
import type { T } from "../../i18n/index.ts";
import type { Activity } from "../../lib/session-activity.ts";

/** The words for what the session is doing, from the dictionary. */
export function activityText(activity: Activity, t: T): string {
  switch (activity.kind) {
    case "tool":
      return t(`activity.${activity.group}`, { tool: activity.tool });
    default:
      return t(`activity.${activity.kind}`);
  }
}

/** Above the message box while a turn runs: a small spinner, what is happening and for how long. */
export function ActivityLine(props: Readonly<{ activity: Activity; t: T }>) {
  const started = useRef(Date.now());
  const [now, setNow] = useState(started.current);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div data-testid="activity" className="activity-line" aria-hidden="true">
      <Loader2 aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
      <span>{activityText(props.activity, props.t)}</span>
      <span className="tabular-nums">{formatDuration(now - started.current, props.t)}</span>
    </div>
  );
}
