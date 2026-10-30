import { useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * Phase 9: updating the host's daemon from the app. Behind a confirmation; "atualizando…" until
 * the host comes back on the new version, or why it did not, with the manual command.
 */
export function DaemonUpdate(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const [confirming, setConfirming] = useState(false);
  const offer = host.hostInfo?.update;
  const progress = host.daemonUpdate;
  if (progress?.failed) {
    return (
      <InlineNotice>
        {`A atualização do daemon não terminou: ${progress.failed}. No host, com o binário novo: `}
        <code className="rounded bg-muted px-1 font-mono text-xs">
          flightdeckd update --from &lt;binário novo&gt;
        </code>
      </InlineNotice>
    );
  }
  if (progress) return <p className="text-muted-foreground text-sm">atualizando…</p>;
  if (!offer?.available || !offer.version) return null;
  const version = offer.version;
  return (
    <>
      <button type="button" onClick={() => setConfirming(true)}>
        {`Atualizar daemon para ${version}`}
      </button>
      {confirming && (
        <ConfirmDialog
          message={`Atualizar o daemon de ${host.name} para ${version}? Ele reinicia, e o app reconecta sozinho.`}
          confirmLabel="Atualizar daemon"
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
