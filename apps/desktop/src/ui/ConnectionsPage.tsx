import type { SshHostKeyCheck, SshTarget } from "@flightdeck/protocol";
import { Network } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { hasFeature } from "../lib/version.ts";

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
  const [keyCheck, setKeyCheck] = useState<{ target: SshTarget; check: SshHostKeyCheck } | null>(
    null,
  );

  const hostId = host?.id;
  const reload = useCallback(async () => {
    if (!hostId) return;
    const result = await store.hostCommand(hostId, "ssh.list", {});
    if (result) setTargets(result.targets);
  }, [store, hostId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const open = async (target: SshTarget) => {
    if (!hostId) return;
    const terminalId = await store.sshConnect(hostId, target);
    if (terminalId) props.go({ name: "terminal", host: hostId, terminalId });
  };

  const connect = async (target: SshTarget) => {
    if (!hostId) return;
    const check = await store.hostCommand(hostId, "ssh.hostkey.check", { targetId: target.id });
    if (!check) return;
    if (check.status === "pinned") await open(target);
    else setKeyCheck({ target, check });
  };

  const confirmKey = async () => {
    if (!hostId || !keyCheck) return;
    const { target, check } = keyCheck;
    setKeyCheck(null);
    const kept = await store.hostCommand(hostId, "ssh.hostkey.confirm", {
      targetId: target.id,
      fingerprint: check.fingerprint,
    });
    if (!kept) return;
    await reload();
    await open(target);
  };

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
    >
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
