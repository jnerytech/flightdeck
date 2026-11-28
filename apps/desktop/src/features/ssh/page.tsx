import type { SshTarget } from "@flightdeck/protocol";
import { Network } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { EmptyState, Field, Inline, NativeSelect, Page } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { hasFeature } from "../../lib/version.ts";
import { AUTH_KEY } from "./domain/target-form.ts";
import { HostKeyDialog } from "./host-key-dialog";
import { ImportPanel } from "./import-panel";
import { TargetForm } from "./target-form";
import { useSshActions } from "./use-ssh-actions.ts";

/** The "via" filter's value for a destino that this host opens itself. */
const LOCAL = "-";

const matches = (target: SshTarget, needle: string) =>
  [target.name, target.host, target.user].some((field) =>
    field.toLowerCase().includes(needle.toLowerCase()),
  );

const CONNECTIONSPAGE_KEYS = ["hosts"] as const;

/** The form's target: a saved destination, a new one, or none (the form is closed). */
type EditingTarget = SshTarget | "new" | null;

/**
 * Closing the form (Save or Cancel) unmounts the focused button; the focus goes back to the one that
 * opened it: "New destination", or the Edit of the destination that was open, whoever asked for the
 * edit (its own button or the changed-server-key dialog); "New destination" when that row is gone.
 */
function useFocusBackAfterForm(editing: EditingTarget) {
  const opened = useRef<EditingTarget>(null);
  useEffect(() => {
    if (editing !== null) {
      opened.current = editing;
      return;
    }
    const was = opened.current;
    opened.current = null;
    if (was === null) return;
    // Save answers later than a click: a focus the person moved meanwhile stays where it is.
    const now = document.activeElement;
    if (now !== null && now !== document.body) return;
    const edit =
      was === "new"
        ? null
        : document.querySelector<HTMLElement>(`[data-edit-target="${CSS.escape(was.id)}"]`);
    // A filter or an offline host can take the row away: Novo destino is the next place to start from.
    (edit ?? document.querySelector<HTMLElement>("[data-new-target]"))?.focus();
  }, [editing]);
}

/** Phase 15: the ssh destinos kept by the first online host that announces `ssh`. */
export const ConnectionsPage = memo(function ConnectionsPage(props: {
  store: AppStore;
  go(route: Route): void;
  /** The id of a destino to connect to once the list is in (the palette's choice). */
  connect?: string;
}) {
  const t = useT();
  const { store } = props;
  const state = useStoreSlice(store, CONNECTIONSPAGE_KEYS);
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "ssh", false),
  );
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [via, setVia] = useState("");
  const [editing, setEditing] = useState<EditingTarget>(null);
  useFocusBackAfterForm(editing);
  const {
    targets,
    listing,
    retry,
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
  } = useSshActions({
    store,
    hosts: state.hosts,
    hostId: host?.id,
    go: props.go,
    wanted: props.connect,
  });
  const hostId = host?.id;
  /** No online host keeps the destinations: one that announces ssh but is offline, or none at all. */
  const offlineHost = hostId
    ? undefined
    : state.hosts.find((h) => hasFeature(h.hostInfo?.features, "ssh", false));
  /** The host to open when none keeps the destinations: the offline one, or the first the person has. */
  const hostToOpen = offlineHost ?? state.hosts[0];
  const clearFilters = () => {
    setSearch("");
    setTag("");
    setVia("");
  };

  const tags = [...new Set(targets.flatMap((target) => target.tags))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
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
      subtitle={
        host ? t("connections.subtitle", { host: host.name }) : t("connections.subtitleNoHost")
      }
      actions={
        hostId &&
        editing === null && (
          <>
            <Button variant="outline" onClick={() => void startImport()}>
              {t("connections.importAction")}
            </Button>
            <Button data-new-target onClick={() => setEditing("new")}>
              {t("connections.newTarget")}
            </Button>
          </>
        )
      }
    >
      {error && (
        <p role="alert" className="text-destructive text-sm">
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
        <div // NOSONAR: holds flow content (paragraphs, a list or placeholders), which <output> may not
          role="status"
          className="text-sm"
        >
          {importMessage.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {hostId && editing !== null && (
        <TargetForm
          key={editing === "new" ? "new" : editing.id}
          store={store}
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
      {hostId && listing === "ready" && targets.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <Field label={t("connections.search")}>
            {(control) => (
              <Input
                {...control}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("connections.tag")}>
            {(control) => (
              <NativeSelect
                {...control}
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              >
                <option value="">{t("connections.all")}</option>
                {tags.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t("connections.via")}>
            {(control) => (
              <NativeSelect
                {...control}
                value={via}
                onChange={(event) => setVia(event.target.value)}
              >
                <option value="">{t("connections.all")}</option>
                <option value={LOCAL}>{t("connections.thisHost")}</option>
                {vias.map((id) => (
                  <option key={id} value={id}>
                    {viaName(id)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
      )}
      {hostId ? null : (
        <EmptyState
          icon={Network}
          title={
            offlineHost
              ? t("connections.hostOffline", { host: offlineHost.name })
              : t("connections.noHost")
          }
          action={
            hostToOpen && (
              <Button onClick={() => props.go({ name: "host", host: hostToOpen.id })}>
                {t("connections.openHost", { host: hostToOpen.name })}
              </Button>
            )
          }
        />
      )}
      {hostId && listing === "loading" && (
        <output className="block text-muted-foreground text-sm">{t("connections.loading")}</output>
      )}
      {hostId && listing === "failed" && (
        <div role="alert">
          <EmptyState
            icon={Network}
            title={t("connections.loadFailed")}
            action={<ActionButton onClick={retry}>{t("connections.retry")}</ActionButton>}
          />
        </div>
      )}
      {hostId && listing === "ready" && targets.length === 0 && (
        <EmptyState
          icon={Network}
          title={t("connections.empty")}
          action={<Button onClick={() => setEditing("new")}>{t("connections.emptyAction")}</Button>}
        />
      )}
      {hostId && listing === "ready" && targets.length > 0 && shown.length === 0 && (
        <EmptyState
          icon={Network}
          title={t("connections.noMatch")}
          action={<Button onClick={clearFilters}>{t("connections.clearFilters")}</Button>}
        />
      )}
      {hostId && listing !== "loading" && shown.length > 0 && (
        <ul aria-label={t("connections.list")} className="flex flex-col gap-2">
          {shown.map((target) => (
            <li key={target.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{target.name}</span>
                <span className="font-mono text-muted-foreground text-sm">
                  {target.user + "@" + target.host + (target.port === 22 ? "" : ":" + target.port)}
                </span>
                {target.tags.map((name) => (
                  <span key={name} className="rounded bg-muted px-1.5 text-xs">
                    {name}
                  </span>
                ))}
              </div>
              <Inline as="ul" gap={3} className="text-muted-foreground text-sm">
                <li>{t(`connections.form.authOption.${AUTH_KEY[target.auth]}`)}</li>
                <li>
                  {target.viaHost
                    ? t("connections.rowVia", { host: viaName(target.viaHost) })
                    : t("connections.rowViaLocal")}
                </li>
                <li>
                  {t(target.hostKey ? "connections.keyConfirmed" : "connections.keyNotConfirmed")}
                </li>
              </Inline>
              <Inline>
                {(["connect", "edit", "duplicate", "remove"] as const).map((verb) => (
                  <ActionButton
                    key={verb}
                    variant="outline"
                    size="sm"
                    aria-label={t(`connections.${verb}For`, { name: target.name })}
                    data-edit-target={verb === "edit" ? target.id : undefined}
                    onClick={() => {
                      // The promise of Connect and Duplicate keeps the button busy until the host answered.
                      if (verb === "connect") return connect(target);
                      if (verb === "duplicate") return duplicate(target);
                      if (verb === "edit") return setEditing(target);
                      return setRemoving(target);
                    }}
                  >
                    {t(`connections.${verb}`)}
                  </ActionButton>
                ))}
              </Inline>
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
      {keyCheck && keyCheck.check.status !== "pinned" && (
        <HostKeyDialog
          store={store}
          target={keyCheck.target}
          check={keyCheck.check}
          onConfirm={() => void confirmKey()}
          onEdit={() => setEditing(keyCheck.target)}
          onClose={() => setKeyCheck(null)}
        />
      )}
    </Page>
  );
});
