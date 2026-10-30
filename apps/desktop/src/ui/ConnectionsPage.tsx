import type { SshHostKeyCheck, SshImportEntry, SshTarget } from "@flightdeck/protocol";
import { Network } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImportPanel } from "@/components/connections/import-panel";
import { TargetForm } from "@/components/connections/target-form";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import { savePayload } from "../lib/ssh.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const SELECT = "h-9 rounded-md border bg-transparent px-2";
/** The "via" filter's value for a destino that this host opens itself. */
const LOCAL = "-";

const matches = (target: SshTarget, needle: string) =>
  [target.name, target.host, target.user].some((field) =>
    field.toLowerCase().includes(needle.toLowerCase()),
  );

/** Phase 15: the ssh destinos kept by the first online host that announces `ssh`. */
export function ConnectionsPage(props: {
  store: AppStore;
  state: AppState;
  go(route: Route): void;
  /** The id of a destino to connect to once the list is in (the palette's choice). */
  connect?: string | undefined;
}) {
  const t = useT();
  const { store, state } = props;
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "ssh", false),
  );
  const [targets, setTargets] = useState<SshTarget[]>([]);
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [via, setVia] = useState("");
  /** A connection waiting for the server key to be confirmed, or blocked by a changed one. */
  const [editing, setEditing] = useState<SshTarget | "new" | null>(null);
  const [importing, setImporting] = useState<SshImportEntry[] | null>(null);
  const [importMessage, setImportMessage] = useState<string[]>([]);
  const [removing, setRemoving] = useState<SshTarget | null>(null);
  /** The host that runs the ssh, the destino as it is kept there and what its key check found. */
  const [keyCheck, setKeyCheck] = useState<{
    runner: string;
    target: SshTarget;
    check: SshHostKeyCheck;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hostId = host?.id;
  const reload = useCallback(async () => {
    if (!hostId) return;
    const result = await store.hostCommand(hostId, "ssh.list", {});
    if (result) setTargets(result.targets);
  }, [store, hostId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const open = async (runner: string, target: SshTarget) => {
    const terminalId = await store.sshConnect(runner, target);
    if (terminalId) props.go({ name: "terminal", host: runner, terminalId });
  };

  /** The host that runs the ssh: the destino's via host, or the one that keeps the destinos. */
  const connect = async (target: SshTarget) => {
    if (!hostId) return;
    setError(null);
    const runner = target.viaHost ?? hostId;
    let kept = target;
    if (runner !== hostId) {
      const via = state.hosts.find((h) => h.id === runner);
      if (!via || via.status !== "online") {
        return setError(t("connections.viaOffline", { host: via?.name ?? runner }));
      }
      if (!hasFeature(via.hostInfo?.features, "ssh", false)) {
        return setError(t("connections.viaNoSsh", { host: via.name }));
      }
      // The via host builds the ssh command from its own destinos: it gets a copy.
      const copy = await store.sshCopyTo(runner, target, targets);
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
      ...result.skipped.map((skip) => t("connections.import.skipped", skip)),
    ]);
    await reload();
  };

  const asked = useRef<string | null>(null);
  // `connect` is rebuilt on each render; the destino is what starts it, once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const wanted = targets.find((target) => target.id === props.connect);
    if (!wanted || asked.current === wanted.id) return;
    asked.current = wanted.id;
    void connect(wanted);
  }, [targets, props.connect]);

  const tags = [...new Set(targets.flatMap((target) => target.tags))].sort();
  const vias = [...new Set(targets.flatMap((target) => (target.viaHost ? [target.viaHost] : [])))];
  const viaName = (id: string) => state.hosts.find((h) => h.id === id)?.name ?? id;
  const shown = targets.filter(
    (target) =>
      matches(target, search) &&
      (tag === "" || target.tags.includes(tag)) &&
      (via === "" || (via === LOCAL ? target.viaHost === null : target.viaHost === via)),
  );

  return (
    <Page
      title={t("connections.title")}
      subtitle={t("connections.subtitle", { host: host?.name ?? "" })}
      actions={
        hostId &&
        editing === null && (
          <>
            <Button variant="outline" onClick={() => void startImport()}>
              {t("connections.importAction")}
            </Button>
            <Button onClick={() => setEditing("new")}>{t("connections.newTarget")}</Button>
          </>
        )
      }
    >
      {error && (
        <p role="alert" className="mb-4 text-destructive text-sm">
          {error}
        </p>
      )}
      {importing && (
        <ImportPanel
          entries={importing}
          onApply={(aliases) => void applyImport(aliases)}
          onClose={() => setImporting(null)}
        />
      )}
      {importMessage.length > 0 && (
        <div role="status" className="mb-4 text-sm">
          {importMessage.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {hostId && editing !== null && (
        <TargetForm
          key={editing === "new" ? "new" : editing.id}
          store={store}
          state={state}
          hostId={hostId}
          target={editing === "new" ? null : editing}
          others={targets.filter((other) => editing === "new" || other.id !== editing.id)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="connections-search">{t("connections.search")}</label>
          <Input
            id="connections-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          {t("connections.tag")}
          <select className={SELECT} value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="">{t("connections.all")}</option>
            {tags.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("connections.via")}
          <select className={SELECT} value={via} onChange={(event) => setVia(event.target.value)}>
            <option value="">{t("connections.all")}</option>
            <option value={LOCAL}>{t("connections.thisHost")}</option>
            {vias.map((id) => (
              <option key={id} value={id}>
                {viaName(id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {targets.length === 0 ? (
        <EmptyState icon={Network} title={t("connections.empty")} />
      ) : (
        <ul aria-label={t("connections.list")} className="flex flex-col gap-2">
          {shown.map((target) => (
            <li key={target.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{target.name}</span>
                <span className="font-mono text-muted-foreground text-sm">
                  {`${target.user}@${target.host}${target.port === 22 ? "" : `:${target.port}`}`}
                </span>
                {target.tags.map((name) => (
                  <span key={name} className="rounded bg-muted px-1.5 text-xs">
                    {name}
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                {(["connect", "edit", "duplicate", "remove"] as const).map((verb) => (
                  <Button
                    key={verb}
                    variant="outline"
                    size="sm"
                    aria-label={t(`connections.${verb}For`, { name: target.name })}
                    onClick={() => {
                      if (verb === "connect") void connect(target);
                      else if (verb === "edit") setEditing(target);
                      else if (verb === "duplicate") void duplicate(target);
                      else setRemoving(target);
                    }}
                  >
                    {t(`connections.${verb}`)}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmDialog
          message={t("connections.removeMessage", { name: removing.name })}
          confirmLabel={t("connections.remove")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
      {keyCheck && (
        <AlertDialog open onOpenChange={(isOpen) => !isOpen && setKeyCheck(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {keyCheck.check.status === "changed"
                  ? t("connections.hostKey.changedTitle")
                  : t("connections.hostKey.confirmTitle", { name: keyCheck.target.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {keyCheck.check.status === "changed"
                  ? t("connections.hostKey.changedMessage", { name: keyCheck.target.name })
                  : t("connections.hostKey.confirmMessage", { name: keyCheck.target.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {keyCheck.check.status === "changed" && keyCheck.check.pinned && (
              <p className="text-sm">
                {t("connections.hostKey.pinned")}:{" "}
                <code className="break-all">{keyCheck.check.pinned}</code>
              </p>
            )}
            <p className="text-sm">
              {keyCheck.check.status === "changed" && `${t("connections.hostKey.current")}: `}
              <code className="break-all">{keyCheck.check.fingerprint}</code>
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {keyCheck.check.status === "changed"
                  ? t("connections.hostKey.close")
                  : t("common.cancel")}
              </AlertDialogCancel>
              {keyCheck.check.status === "unknown" && (
                <AlertDialogAction onClick={() => void confirmKey()}>
                  {t("connections.hostKey.confirm")}
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Page>
  );
}
