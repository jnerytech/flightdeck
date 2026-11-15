import type { SshHostKeyCheck, SshImportEntry, SshTarget } from "@flightdeck/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { hasFeature } from "../../lib/version.ts";
import { savePayload } from "./index.ts";

/** A connection waiting for the server key to be confirmed, or blocked by a changed one. */
interface KeyCheck {
  /** The host that runs the ssh. */
  runner: string;
  /** The destino as it is kept there. */
  target: SshTarget;
  /** What its key check found. */
  check: SshHostKeyCheck;
}

/**
 * What the connections page does with the destinos of the host that keeps them: list, connect
 * (through the via host and its key check), duplicate, remove and import (#1589). `wanted` is the
 * id of a destino to connect to once the list is in (the palette's choice).
 */
export function useSshActions(props: {
  store: AppStore;
  hosts: readonly HostView[];
  hostId: string | undefined;
  go(route: Route): void;
  wanted?: string;
}) {
  const t = useT();
  const { store, hosts, hostId, go } = props;
  const [targets, setTargets] = useState<SshTarget[]>([]);
  const [importing, setImporting] = useState<SshImportEntry[] | null>(null);
  const [importMessage, setImportMessage] = useState<string[]>([]);
  const [removing, setRemoving] = useState<SshTarget | null>(null);
  const [keyCheck, setKeyCheck] = useState<KeyCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!hostId) return;
    const result = await store.hostCommand(hostId, "ssh.list", {});
    if (result) setTargets(result.targets);
  }, [store, hostId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const open = async (runner: string, target: SshTarget) => {
    // A vault key goes to the host that runs ssh now, in the connect command and nowhere else.
    let privateKey: string | undefined;
    if (target.auth === "vault-key" && target.secretRef) {
      const got = await store.vaultSecretFor(runner, target.secretRef, "ssh");
      if (!got.ok) return setError(t(`vault.refused.${got.code}`));
      privateKey = got.value;
    }
    const terminalId = await store.ssh.connect(runner, target, privateKey);
    if (terminalId) go({ name: "terminal", host: runner, terminalId });
  };

  /** The host that runs the ssh: the destino's via host, or the one that keeps the destinos. */
  const connect = async (target: SshTarget) => {
    if (!hostId) return;
    setError(null);
    const runner = target.viaHost ?? hostId;
    let kept = target;
    if (runner !== hostId) {
      const via = hosts.find((h) => h.id === runner);
      if (via?.status !== "online") {
        return setError(t("connections.viaOffline", { host: via?.name ?? runner }));
      }
      if (!hasFeature(via.hostInfo?.features, "ssh", false)) {
        return setError(t("connections.viaNoSsh", { host: via.name }));
      }
      // The via host builds the ssh command from its own destinos: it gets a copy.
      const copy = await store.ssh.copyTo(runner, target, targets);
      if (!copy) return;
      kept = copy;
    }
    const check = await store.hostCommand(runner, "ssh.hostkey.check", { targetId: kept.id });
    if (!check) return;
    if (check.status === "pinned") await open(runner, kept);
    else setKeyCheck({ runner, target: kept, check });
  };

  const confirmKey = async () => {
    if (!keyCheck) return;
    const { runner, target, check } = keyCheck;
    setKeyCheck(null);
    const confirmed = await store.hostCommand(runner, "ssh.hostkey.confirm", {
      targetId: target.id,
      fingerprint: check.fingerprint,
    });
    if (!confirmed) return;
    if (runner === hostId) await reload();
    await open(runner, target);
  };

  const duplicate = async (target: SshTarget) => {
    if (!hostId) return;
    const copy = await store.hostCommand(
      hostId,
      "ssh.save",
      savePayload(target, t("connections.copySuffix", { name: target.name })),
    );
    if (copy) await reload();
  };

  const remove = async (target: SshTarget) => {
    setRemoving(null);
    if (!hostId) return;
    const removed = await store.hostCommand(hostId, "ssh.remove", { id: target.id, confirm: true });
    if (removed !== null) await reload();
  };

  const startImport = async () => {
    if (!hostId) return;
    setImportMessage([]);
    const preview = await store.hostCommand(hostId, "ssh.import.preview", {});
    if (preview) setImporting(preview.entries);
  };

  const applyImport = async (aliases: string[]) => {
    if (!hostId) return;
    setImporting(null);
    const result = await store.hostCommand(hostId, "ssh.import.apply", { aliases });
    if (!result) return;
    setImportMessage([
      t("connections.import.created", { n: result.created.length }),
      ...result.skipped.map((skip) =>
        t("connections.import.skipped", {
          alias: skip.alias,
          reason: refusalText("", skip.reason, t, { reason: skip.why, params: skip.params }),
        }),
      ),
    ]);
    await reload();
  };

  const asked = useRef<string | null>(null);
  // `connect` is rebuilt on each render; the destino is what starts it, once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const target = targets.find((candidate) => candidate.id === props.wanted);
    if (!target || asked.current === target.id) return;
    asked.current = target.id;
    void connect(target);
  }, [targets, props.wanted]);

  return {
    targets,
    error,
    importing,
    setImporting,
    importMessage,
    removing,
    setRemoving,
    keyCheck,
    setKeyCheck,
    reload,
    connect,
    confirmKey,
    duplicate,
    remove,
    startImport,
    applyImport,
  };
}
