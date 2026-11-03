import { useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Button } from "@/components/ui/button";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * Phase 9: updating the host's daemon from the app. Behind a confirmation; "atualizando…" until
 * the host comes back on the new version, or why it did not, with the manual command.
 */
export function DaemonUpdate(props: { store: AppStore; host: HostView }) {
  const t = props.store.i18n.t;
  const { store, host } = props;
  const [confirming, setConfirming] = useState(false);
  const offer = host.hostInfo?.update;
  const progress = host.daemonUpdate;
  if (progress?.failed) {
    return (
      <InlineNotice>
        {`${t("daemonUpdate.failed", { reason: progress.failed })} `}
        <code className="rounded bg-muted px-1 font-mono text-xs">
          flightdeckd update --from {t("daemonUpdate.binary")}
        </code>
      </InlineNotice>
    );
  }
  if (progress)
    return <p className="text-muted-foreground text-sm">{t("daemonUpdate.updating")}</p>;
  const check = host.updateCheck;
  const version = offer?.available ? offer.version : null;
  return (
    <>
      {version && (
        <Button variant="outline" className="self-start" onClick={() => setConfirming(true)}>
          {t("daemonUpdate.button", { version })}
        </Button>
      )}
      {offer && (
        <div className="row-wrap">
          <Button
            variant="outline"
            size="sm"
            disabled={check?.busy === true}
            onClick={() => void store.checkDaemonUpdate(host.id)}
          >
            {check?.busy ? t("daemonUpdate.checking") : t("daemonUpdate.check")}
          </Button>
          <span
            className="text-muted-foreground text-sm"
            title={store.formatDateTime(offer.checkedAt)}
          >
            {t("daemonUpdate.lastCheck", { when: store.formatWhen(offer.checkedAt) })}
          </span>
          {offer.error && (
            <span className="text-sm text-status-needs-you">
              {t("daemonUpdate.lastError", { error: offer.error })}
            </span>
          )}
          {!offer.available && !offer.error && offer.version && (
            <span className="text-muted-foreground text-sm">
              {t("daemonUpdate.upToDate", { version: offer.version })}
            </span>
          )}
          {check?.failed && (
            <span role="alert" className="text-sm text-status-needs-you">
              {t("daemonUpdate.checkFailed", { reason: check.failed })}
            </span>
          )}
        </div>
      )}
      {version && confirming && (
        <ConfirmDialog
          message={t("daemonUpdate.message", { host: host.name, version })}
          confirmLabel={t("daemonUpdate.confirm")}
          onConfirm={() => {
            setConfirming(false);
            void store.updateDaemon(host.id);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
