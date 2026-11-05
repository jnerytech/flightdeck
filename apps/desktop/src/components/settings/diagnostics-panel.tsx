import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import { diagnosticsText } from "../../lib/app-log.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { APP_VERSION } from "../../lib/version.ts";

/** The last lines "Copy diagnostics" carries. */
const LINES = 50;

/**
 * Settings > Diagnostics: open the folder of the app's log, and copy what a person pastes in a
 * message when something broke (versions, hosts, the last redacted log lines). Hidden where the
 * app has no file system (a browser, the demo).
 */
export function DiagnosticsPanel(props: { store: AppStore }) {
  const { store } = props;
  const t = useT();
  const logs = store.platformLogs();
  if (!logs) return null;
  const copy = async () => {
    const fromFile = await logs.tail(LINES).catch(() => []);
    const lines = fromFile.length > 0 ? fromFile : store.appLog.recent(LINES);
    const text = diagnosticsText({
      appVersion: APP_VERSION,
      os: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
      hosts: store.getState().hosts.map((host) => ({
        name: host.name,
        status: host.status,
        version: host.hostInfo?.daemonVersion ?? null,
        features: host.hostInfo?.features ?? [],
      })),
      lines,
    });
    await store.copyText(text);
    store.success(t("diagnostics.copied"));
  };
  return (
    <Panel title={t("diagnostics.title")} label={t("diagnostics.title")}>
      <p className="text-muted-foreground text-xs">{t("diagnostics.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <ActionButton variant="outline" onClick={() => logs.openFolder()}>
          {t("diagnostics.openLogs")}
        </ActionButton>
        <ActionButton variant="outline" onClick={copy}>
          {t("diagnostics.copy")}
        </ActionButton>
      </div>
    </Panel>
  );
}
