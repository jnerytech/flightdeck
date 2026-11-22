/**
 * Issue #100, slice 3b: the move dialog for one session, wired to the app: the hosts it can go to
 * (online, with teleport, not its own), the repository on the target (typed, or picked from the
 * folders that host allows), the store's relay, and the session opened where it landed.
 */
import type { Project } from "@flightdeck/protocol";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/shared/layout/index.ts";
import { useT } from "../../i18n/context.tsx";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { useStoreSlice } from "../../lib/use-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { FolderPicker } from "../hosts/ui.ts";
import { isPlainRemote, plainText } from "./teleport.ts";
import { failureText, TeleportDialog } from "./teleport-dialog.tsx";

const TELEPORT_KEYS = ["hosts"] as const;

/** The repository on the target: a typed path, the projects that host knows, and Browse where it can list its folders. */
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
  const { host, store } = props;
  const hostId = host?.id;
  // Keyed by host: the render right after a new target is picked never shows the previous host's projects.
  const [loaded, setLoaded] = useState<{ hostId: string; projects: Project[] } | null>(null);
  const known = loaded && loaded.hostId === hostId ? loaded.projects : [];
  useEffect(() => {
    if (!hostId) return;
    let current = true;
    void store.projectList.load(hostId).then((projects) => {
      if (current) setLoaded({ hostId, projects: projects ?? [] });
    });
    return () => {
      current = false;
    };
  }, [store, hostId]);
  return (
    <>
      {known.length > 0 && (
        <NativeSelect
          aria-label={t("teleportUi.known")}
          value={known.some((p) => p.path === props.value) ? props.value : ""}
          onChange={(e) => e.target.value && props.onChange(e.target.value)}
        >
          <option value="">{t("teleportUi.pickKnown")}</option>
          {known.map((project) => (
            <option key={project.id} value={project.path}>
              {`${project.name} — ${project.path}`}
            </option>
          ))}
        </NativeSelect>
      )}
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

/** The repository field of the dialog, for the host the person picked as the target. */
const repoFieldFor =
  (store: AppStore, hosts: HostView[]) =>
  (hostId: string, value: string, onChange: (path: string) => void) => (
    <RepoField
      store={store}
      host={hosts.find((h) => h.id === hostId)}
      value={value}
      onChange={onChange}
    />
  );

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
      repoField={repoFieldFor(store, state.hosts)}
      run={(args) =>
        store.mover.move(props.hostId, props.sessionId, args).then(
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
      plain={(target) =>
        state.hosts
          .filter((h) => (h.id === props.hostId || h.id === target) && isPlainRemote(h.url))
          .map((h) => plainText(h.name, 64))
      }
      onOpen={store.openMovedSession}
      onClose={() => {
        closed.current = true;
        props.onClose();
      }}
    />
  );
});
