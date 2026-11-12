import { useEffect } from "react";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { ActionButton } from "@/shared/feedback/index.ts";

/**
 * Issue #1404: the host's switch for pausing new card runs before a restart or an update. While
 * paused it counts the sessions still running, and says when nothing runs. Hidden on a daemon that
 * predates it.
 */
export function HostPausePanel(props: Readonly<{ store: AppStore; host: HostView }>) {
  const { store, host } = props;
  const t = useT();
  const pause = host.hostInfo?.pause;
  // The count of running sessions changes as they start and end: read the host again then.
  const activity = host.sessions.map((s) => `${s.id}:${s.status}`).join(",");
  const paused = pause?.paused === true;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `activity` is the trigger
  useEffect(() => {
    // The count only shows while paused: no round trip otherwise.
    if (paused) void store.reloadHostInfo(host.id);
  }, [store, host.id, activity, paused]);
  if (pause === undefined) return null;
  const set = async (paused: boolean) => {
    await store.hostCommand(host.id, "host.pause", { paused });
    await store.reloadHostInfo(host.id);
  };
  let state = t("hostPage.pauseOff");
  if (pause.paused) {
    state =
      pause.running > 0
        ? t("hostPage.pauseOnRunning", { n: String(pause.running) })
        : t("hostPage.pauseOnIdle");
  }
  return (
    <Panel title={t("hostPage.pauseTitle")} slot="host-section-pause">
      <p className="text-muted-foreground text-xs">{t("hostPage.pauseHint")}</p>
      <p className="text-sm">{state}</p>
      <div>
        <ActionButton variant="outline" onClick={() => set(!pause.paused)}>
          {t(pause.paused ? "hostPage.pauseTurnOff" : "hostPage.pauseTurnOn")}
        </ActionButton>
      </div>
    </Panel>
  );
}
