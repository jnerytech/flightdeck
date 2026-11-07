/**
 * Issue #100, slice 3b: the move dialog for one session, wired to the app: the hosts it can go to
 * (online, with teleport, not its own), the repository on the target (typed, or picked from the
 * folders that host allows), the store's relay, and the session opened where it landed.
 */
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "../i18n/context.tsx";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { useStoreSlice } from "../lib/use-store.ts";
import { hasFeature } from "../lib/version.ts";
import { FolderPicker } from "./FolderPicker.tsx";
import { TeleportDialog } from "./TeleportDialog.tsx";

const TELEPORT_KEYS = ["hosts"] as const;

/** The repository on the target: a typed path, and Browse where that host can list its folders. */
function RepoField(
  props: Readonly<{
    store: AppStore;
    host: HostView | undefined;
    value: string;
    onChange(path: string): void;
  }>,
) {
  const t = useT();
  const [browsing, setBrowsing] = useState(false);
  const { host } = props;
  return (
    <>
      <Input
        aria-label={t("teleportUi.repo")}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {host && hasFeature(host.hostInfo?.features, "fs.dirs", false) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setBrowsing(true)}
        >
          {t("folderPicker.browse")}
        </Button>
      )}
      {browsing && host && (
        <FolderPicker
          store={props.store}
          host={host}
          onPick={(path) => {
            setBrowsing(false);
            props.onChange(path);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}

export const TeleportMove = memo(function TeleportMove(
  props: Readonly<{ store: AppStore; hostId: string; sessionId: string; onClose(): void }>,
) {
  const { store } = props;
  const state = useStoreSlice(store, TELEPORT_KEYS);
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
      repoField={(hostId, value, onChange) => (
        <RepoField
          store={store}
          host={state.hosts.find((h) => h.id === hostId)}
          value={value}
          onChange={onChange}
        />
      )}
      run={(args) => store.moveSession(props.hostId, props.sessionId, args)}
      onOpen={store.openMovedSession}
      onClose={props.onClose}
    />
  );
});
