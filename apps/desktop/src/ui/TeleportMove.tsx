/**
 * Issue #100, slice 3b: the move dialog for one session, wired to the app: the hosts it can go to
 * (online, with teleport, not its own), the repository typed on the target (the folder picker comes
 * when the preview is polished), the store's relay, and the session opened where it landed.
 */
import { memo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "../i18n/context.tsx";
import type { AppStore } from "../lib/app-store.ts";
import { useStoreSlice } from "../lib/use-store.ts";
import { hasFeature } from "../lib/version.ts";
import { failureText, TeleportDialog } from "./TeleportDialog.tsx";

const TELEPORT_KEYS = ["hosts"] as const;

export const TeleportMove = memo(function TeleportMove(
  props: Readonly<{ store: AppStore; hostId: string; sessionId: string; onClose(): void }>,
) {
  const { store } = props;
  const t = useT();
  const state = useStoreSlice(store, TELEPORT_KEYS);
  /** The dialog closed (the person closed it while the target finished): the move tells by toast. */
  const closed = useRef(false);
  const targets = state.hosts
    .filter(
      (h) =>
        h.id !== props.hostId &&
        h.status === "online" &&
        hasFeature(h.hostInfo?.features, "teleport", false),
    )
    .map((h) => ({ id: h.id, name: h.name }));
  return (
    <TeleportDialog
      targets={targets}
      repoField={(_hostId, value, onChange) => (
        <Input
          aria-label={t("teleportUi.repo")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      run={(args) =>
        store.moveSession(props.hostId, props.sessionId, args).then(
          (outcome) => {
            if (closed.current && outcome.kind === "moved") {
              const host = state.hosts.find((h) => h.id === args.target)?.name ?? "";
              store.success(t("teleportUi.movedToast", { host }), {
                label: t("teleportUi.open"),
                run: () => store.openMovedSession(args.target, outcome.sessionId),
              });
            }
            return outcome;
          },
          (error: unknown) => {
            if (closed.current) store.reportError(failureText(error, t));
            throw error;
          },
        )
      }
      onOpen={store.openMovedSession}
      onClose={() => {
        closed.current = true;
        props.onClose();
      }}
    />
  );
});
