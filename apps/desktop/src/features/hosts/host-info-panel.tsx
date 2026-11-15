import { useT } from "@/i18n/context";
import { useHostLatency } from "@/lib/use-store";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Panel } from "@/shared/layout/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { APP_VERSION } from "../../lib/version.ts";
import { hostUptime } from "./domain/host-offline.ts";
import { useNow } from "./use-now.ts";

/** What the host reports about itself: system, versions, Claude Code, sessions, uptime and latency. */
export function HostInfoPanel(
  props: Readonly<{ store: AppStore; host: HostView; offline: boolean }>,
) {
  const t = useT();
  const { store, host, offline } = props;
  const info = host.hostInfo;
  const now = useNow();
  return (
    <Panel title={t("hostPage.info")} label={t("hostPage.info")}>
      {info ? (
        <ul className="flex flex-col gap-1 text-sm">
          <li>{`${info.os} · ${info.arch}`}</li>
          <li>{t("hostPage.daemon", { version: info.daemonVersion })}</li>
          <li>{t("hostPage.app", { version: APP_VERSION })}</li>
          {info.daemonVersion !== APP_VERSION && (
            <li className="text-status-needs-you">{t("hostPage.differs")}</li>
          )}
          <li>
            {t("hostPage.claude", {
              version: info.claudeVersion ?? t("hostPage.unknown"),
            })}
          </li>
          <li>{t("hostPage.active", { n: info.activeSessions })}</li>
          <li>
            {t("hostPage.uptime", {
              n: hostUptime(info.uptimeSec, host.infoAt, now),
            })}
          </li>
          <HostLatency store={store} hostId={host.id} />
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          {offline ? t("hostOffline.title") : t("hostPage.unavailable")}
        </p>
      )}
    </Panel>
  );
}

/** The heartbeat latency line: the only part of the page that renders on a ping. */
function HostLatency(props: Readonly<{ store: AppStore; hostId: string }>) {
  const t = useT();
  const latency = useHostLatency(props.store, props.hostId);
  return <li>{t("hostPage.latency", { value: latency === null ? "—" : `${latency} ms` })}</li>;
}

/** A host whose daemon speaks another protocol: one sentence, the daemon's own words under Details. */
export function HostIncompatibleNotice(props: Readonly<{ host: HostView }>) {
  const t = useT();
  const { host } = props;
  return (
    <InlineNotice>
      <span className="flex flex-col gap-1">
        {/* Issue #181: one sentence of the catalog; the daemon's own words stay under Details. */}
        <span>{t("errors.protocol_incompatible")}</span>
        {host.incompatibility && (
          <details>
            <summary>{t("toast.details")}</summary>
            {host.incompatibility}
          </details>
        )}
        <span>
          {t("hostPage.incompatibleFix", { version: APP_VERSION })}{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">
            flightdeckd update --from {t("daemonUpdate.binary")}
          </code>
        </span>
      </span>
    </InlineNotice>
  );
}
