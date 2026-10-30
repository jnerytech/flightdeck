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
        {t("daemonUpdate.failed", { reason: progress.failed }) + " "}
        <code className="rounded bg-muted px-1 font-mono text-xs">
          flightdeckd update --from {t("daemonUpdate.binary")}
        </code>
      </InlineNotice>
    );
  }
  if (progress)
    return <p className="text-muted-foreground text-sm">{t("daemonUpdate.updating")}</p>;
  if (!offer?.available || !offer.version) return null;
  const version = offer.version;
  return (
    <>
      <Button variant="outline" className="self-start" onClick={() => setConfirming(true)}>
        {t("daemonUpdate.button", { version })}
      </Button>
      {confirming && (
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
