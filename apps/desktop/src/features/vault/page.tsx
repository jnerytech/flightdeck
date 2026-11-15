import { KeyRound } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { groupSecrets, selectedClient } from "@/features/clients/index.ts";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { EmptyState, OpenedPanel, Page, Stack } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { BackupPanel } from "./backup-panel.tsx";
import { EditSecretForm } from "./edit-secret-form.tsx";
import { NewSecretForm } from "./new-secret-form.tsx";
import { RulesEditor } from "./rules-editor.tsx";
import { SecretRow } from "./secret-row.tsx";
import { TypedConfirm } from "./typed-confirm.tsx";
import { UsageLog } from "./usage-log.tsx";
import { useSecretInfos } from "./use-secret-infos.ts";
import type { SecretMeta } from "./vault.ts";
import { VaultReport } from "./vault-report.tsx";

const REVEAL_MS = 10_000;
const CLEAR_MS = 30_000;
/** How long before a revealed value hides that the person is told once. */
const WARN_MS = 5_000;
/** How long the "hidden" notice stays in the status line before it is cleared. */
const HIDDEN_NOTICE_MS = 5_000;

/** The secret a removal hands the focus to: the next one in the list, else the one before it, else none. */
function neighbourOf(list: readonly SecretMeta[], id: string): string | null {
  const at = list.findIndex((s) => s.id === id);
  return list[at + 1]?.id ?? list[at - 1]?.id ?? null;
}

const VAULTPAGE_KEYS = ["secrets", "hosts", "clientList", "clientSelection"] as const;

/** Phase 16: the vault's screen. */
export const VaultPage = memo(function VaultPage(props: {
  store: AppStore;
  /** How long a revealed value stays on screen. */
  revealMs?: number;
  /** How long a copied value stays on the clipboard. */
  clearMs?: number;
  /** Phase 19: opens a secret's rules with a new rule that matches this. */
  rule?: { secretId: string; match: Record<string, string> };
}) {
  const t = useT();
  const { store } = props;
  const state = useStoreSlice(store, VAULTPAGE_KEYS);
  const infos = useSecretInfos(store, state.secrets);
  const revealMs = props.revealMs ?? REVEAL_MS;
  const clearMs = props.clearMs ?? CLEAR_MS;
  const [asking, setAsking] = useState<SecretMeta | null>(null);
  const [editing, setEditing] = useState<SecretMeta | null>(null);
  const [creating, setCreating] = useState(false);
  const [ruling, setRuling] = useState<SecretMeta | null>(
    () => state.secrets.find((s) => s.id === props.rule?.secretId) ?? null,
  );
  const [removing, setRemoving] = useState<SecretMeta | null>(null);
  const [shown, setShown] = useState<{ id: string; value: string } | null>(null);

  // What a screen reader hears about the value (never the value): shown, about to hide, hidden.
  const [phase, setPhase] = useState<"shown" | "soon" | "hidden" | null>(null);
  // The button that opened a confirmation, so the focus can go back to it when it closes.
  const opener = useRef<HTMLElement | null>(null);
  // Where the focus lands when the opener's row is gone (a removed secret).
  const newSecretButton = useRef<HTMLButtonElement>(null);
  // Where the focus went when a removal's row left the list, for a dialog that closes after it.
  const landed = useRef<HTMLElement | null>(null);
  const focusAfterClose = () => {
    if (opener.current?.isConnected) return opener.current;
    return landed.current?.isConnected ? landed.current : newSecretButton.current;
  };
  // A confirmed removal: which secret goes, and which row takes the focus once it is gone.
  const removal = useRef<{ id: string; next: string | null } | null>(null);

  useEffect(() => {
    if (!shown) return;
    setPhase("shown");
    const soon =
      revealMs > WARN_MS ? setTimeout(() => setPhase("soon"), revealMs - WARN_MS) : undefined;
    const timer = setTimeout(() => {
      setShown(null);
      setPhase("hidden");
    }, revealMs);
    return () => {
      clearTimeout(timer);
      clearTimeout(soon);
    };
  }, [shown, revealMs]);

  // "Hidden" is said once: it does not stay in the status line for good.
  useEffect(() => {
    if (phase !== "hidden") return;
    const timer = setTimeout(() => setPhase(null), HIDDEN_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // A secret that is gone shows no value and leaves no status about it, and its row's neighbour
  // takes the focus (else the New secret button) once the row has left the list.
  useEffect(() => {
    const listed = (id: string) => state.secrets.some((s) => s.id === id);
    if (shown && !listed(shown.id)) {
      setShown(null);
      setPhase(null);
    }
    const gone = removal.current;
    if (!gone || listed(gone.id)) return;
    removal.current = null;
    const next = gone.next
      ? [...document.querySelectorAll<HTMLElement>("[data-opener]")].find(
          (el) => el.dataset.opener === `edit:${gone.next}`,
        )
      : undefined;
    landed.current = next ?? newSecretButton.current;
    landed.current?.focus();
  }, [state.secrets, shown]);

  const reveal = async (secret: SecretMeta) => {
    setAsking(null);
    const value = await store.vault.value(secret.id);
    if (value !== null) setShown({ id: secret.id, value });
  };

  // With a client that has a vault tag selected, its secrets come first (phase 29).
  const selected = selectedClient(state.clientList, state.clientSelection);
  const byClient = selected?.defaults.vaultTag !== undefined;
  const groups = groupSecrets(state.secrets, state.clientList, selected);
  const groupLabel = (kind: "client" | "none" | "others") => {
    if (kind === "client") return t("clients.vaultGroupClient", { name: selected?.name ?? "" });
    return t(kind === "none" ? "clients.vaultGroupNone" : "clients.vaultGroupOthers");
  };
  return (
    <Page
      title={t("vault.title")}
      subtitle={t("vault.subtitle")}
      actions={
        !creating && (
          <Button ref={newSecretButton} data-opener="new" onClick={() => setCreating(true)}>
            {t("vault.newSecret")}
          </Button>
        )
      }
    >
      <output className="text-muted-foreground text-sm">
        {phase === "shown" &&
          t("vault.shownFor", { seconds: Math.max(1, Math.round(revealMs / 1000)) })}
        {phase === "soon" && t("vault.hidesSoon", { seconds: WARN_MS / 1000 })}
        {phase === "hidden" && t("vault.hidden")}
      </output>
      {creating && (
        <OpenedPanel opener="new">
          <NewSecretForm
            store={store}
            onClose={() => setCreating(false)}
            {...(selected?.defaults.vaultTag ? { defaultTags: selected.defaults.vaultTag } : {})}
          />
        </OpenedPanel>
      )}
      {editing && (
        <OpenedPanel key={editing.id} opener={`edit:${editing.id}`}>
          <EditSecretForm store={store} secret={editing} onClose={() => setEditing(null)} />
        </OpenedPanel>
      )}
      {ruling && (
        <OpenedPanel key={ruling.id} opener={`rules:${ruling.id}`}>
          <RulesEditor
            store={store}
            secret={ruling}
            {...(props.rule?.secretId === ruling.id ? { seed: props.rule.match } : {})}
            onClose={() => setRuling(null)}
          />
        </OpenedPanel>
      )}
      <Tabs defaultValue="secrets">
        <TabsList aria-label={t("vault.tabs")}>
          <TabsTrigger value="secrets">{t("vault.tabSecrets")}</TabsTrigger>
          <TabsTrigger value="usage">{t("vault.tabUsage")}</TabsTrigger>
          <TabsTrigger value="backup">{t("vault.tabBackup")}</TabsTrigger>
          <TabsTrigger value="report">{t("vaultAudit.tab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="secrets">
          {state.secrets.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title={t("vault.empty")}
              action={
                !creating && (
                  <Button data-opener="new" onClick={() => setCreating(true)}>
                    {t("vault.emptyAction")}
                  </Button>
                )
              }
            />
          ) : (
            groups.map((group) => (
              <section key={group.kind} aria-label={groupLabel(group.kind)}>
                <Stack gap={2}>
                  {byClient && (
                    <h2 className="font-medium text-muted-foreground text-sm">
                      {groupLabel(group.kind)}
                    </h2>
                  )}
                  <ul aria-label={t("vault.list")} className="flex flex-col gap-2">
                    {group.secrets.map((secret) => (
                      <SecretRow
                        key={secret.id}
                        secret={secret}
                        info={infos[secret.id] ?? {}}
                        revealed={shown?.id === secret.id ? shown.value : null}
                        onReveal={(button) => {
                          opener.current = button;
                          setAsking(secret);
                        }}
                        onCopy={() => void store.secrets.copy(secret.id, clearMs)}
                        onRemove={(button) => {
                          opener.current = button;
                          setRemoving(secret);
                        }}
                        onEdit={() => setEditing(secret)}
                        onRules={() => setRuling(secret)}
                        onCopyPublicKey={() =>
                          void store.system.copyText(infos[secret.id]?.publicKey ?? "")
                        }
                        hostName={(hostId) =>
                          state.hosts.find((h) => h.id === hostId)?.name ?? hostId
                        }
                        formatWhen={(ms) =>
                          // A moment no date can hold (a bad value from the daemon) shows as nothing, not a crash.
                          Number.isFinite(new Date(ms).getTime())
                            ? store.formatDateTime(new Date(ms).toISOString())
                            : ""
                        }
                      />
                    ))}
                  </ul>
                </Stack>
              </section>
            ))
          )}
        </TabsContent>
        <TabsContent value="usage">
          <UsageLog store={store} />
        </TabsContent>
        <TabsContent value="backup">
          <BackupPanel store={store} />
        </TabsContent>
        <TabsContent value="report">
          <VaultReport store={store} />
        </TabsContent>
      </Tabs>
      {asking && (
        <TypedConfirm
          message={t("vault.revealMessage", {
            name: asking.name,
            seconds: Math.max(1, Math.round(revealMs / 1000)),
          })}
          word={t("vault.revealWord")}
          inputLabel={t("vault.revealPrompt", { word: t("vault.revealWord") })}
          confirmLabel={t("vault.reveal")}
          returnFocus={focusAfterClose}
          onConfirm={() => void reveal(asking)}
          onCancel={() => setAsking(null)}
        />
      )}
      {removing && (
        <TypedConfirm
          message={t("vault.removeMessage", { name: removing.name })}
          word={removing.name}
          inputLabel={t("vault.removePrompt", { word: removing.name })}
          confirmLabel={t("vault.remove")}
          destructive
          returnFocus={focusAfterClose}
          onConfirm={() => {
            landed.current = null;
            removal.current = {
              id: removing.id,
              next: neighbourOf(
                groups.flatMap((g) => g.secrets),
                removing.id,
              ),
            };
            void store.secrets.remove(removing.id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Page>
  );
});
