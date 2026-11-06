import { SecretScanner, scrubHome } from "@flightdeck/protocol";
import { ActionButton } from "@/components/feedback/action-button";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";

/** How many of the host's last lines are copied. */
const LINES = 100;

/**
 * "Copy the host's last log lines" on the host page: the daemon's own log, bounded and redacted
 * by the host, for pasting in a message. Only for an online host that announces `logs`.
 */
export function HostLogs(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  if (host.status !== "online" || !hasFeature(host.hostInfo?.features, "logs", false)) return null;
  const copy = async () => {
    const tail = await store.hostCommand(host.id, "logs.tail", { lines: LINES });
    if (!tail) return;
    if (tail.lines.length === 0) {
      store.success(t("diagnostics.hostEmpty"));
      return;
    }
    // The host redacts, and so does the app: what reaches the clipboard is never taken on trust.
    const clean = scrubHome(
      new SecretScanner(() => store.scanValues()).redact(tail.lines.join("\n"), false),
    );
    await store.copyText(clean);
    store.success(t("diagnostics.hostCopied", { n: tail.lines.length }));
  };
  return (
    <div className="flex flex-col gap-1">
      <ActionButton variant="outline" className="self-start" onClick={copy}>
        {t("diagnostics.hostCopy")}
      </ActionButton>
      {host.hostInfo?.logPath && (
        <p className="text-muted-foreground text-xs">
          {t("diagnostics.hostHint", { path: host.hostInfo.logPath })}
        </p>
      )}
    </div>
  );
}
