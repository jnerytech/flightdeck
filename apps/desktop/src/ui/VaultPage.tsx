import { KeyRound } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackupPanel } from "@/components/vault/backup-panel";
import { EditSecretForm } from "@/components/vault/edit-secret-form";
import { NewSecretForm } from "@/components/vault/new-secret-form";
import { RulesEditor } from "@/components/vault/rules-editor";
import { TypedConfirm } from "@/components/vault/typed-confirm";
import { UsageLog } from "@/components/vault/usage-log";
import { VaultReport } from "@/components/vault/vault-report";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../lib/app-store.ts";
import type { SecretMeta } from "../lib/vault.ts";
import { describeSecret, type SecretInfo } from "../lib/vault-types.ts";

const REVEAL_MS = 10_000;
const CLEAR_MS = 30_000;

/** What describes a secret on its row, without revealing it. */
function infoText(info: SecretInfo, fingerprint: (value: string) => string): string {
  if (info.fingerprint) return fingerprint(info.fingerprint);
  return info.hint ?? info.names?.join(", ") ?? "";
}

function SecretRow(props: {
  secret: SecretMeta;
  info: SecretInfo;
  /** The value, while it is revealed. */
  revealed: string | null;
  onReveal(): void;
  onCopy(): void;
  onRemove(): void;
  onEdit(): void;
  /** Phase 19: the secret's usage rules. */
  onRules(): void;
  onCopyPublicKey(): void;
  hostName(id: string): string;
}) {
  const t = useT();
  const { secret, info } = props;
  const detail = infoText(info, (value) => t("vault.fingerprint", { value }));
  return (
    <li className="flex flex-col gap-1 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{secret.name}</span>
        <span className="text-muted-foreground text-sm">{t(`vault.type.${secret.type}`)}</span>
        {secret.tags.map((tag) => (
          <span key={tag} className="rounded bg-muted px-1.5 text-xs">
            {tag}
          </span>
        ))}
      </div>
      {detail && <p className="font-mono text-muted-foreground text-sm">{detail}</p>}
      <p className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
        <span>
          {secret.lastUsedAt === null
            ? t("vault.neverUsed")
            : t("vault.lastUsed", { when: new Date(secret.lastUsedAt).toLocaleString() })}
        </span>
        <span>
          {t("vault.hosts", { hosts: secret.allowedHosts.map(props.hostName).join(", ") })}
        </span>
      </p>
      {props.revealed !== null && (
        <code className="break-all rounded bg-muted p-2 text-sm">{props.revealed}</code>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={t("vault.revealFor", { name: secret.name })}
          onClick={props.onReveal}
        >
          {t("vault.reveal")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("vault.copyFor", { name: secret.name })}
          onClick={props.onCopy}
        >
          {t("vault.copy")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("vault.editFor", { name: secret.name })}
          onClick={props.onEdit}
        >
          {t("vault.edit")}
        </Button>
        <Button variant="outline" size="sm" onClick={props.onRules}>
          {t("vaultRulesUi.open", { name: secret.name })}
        </Button>
        {info.publicKey && (
          <Button
            variant="outline"
            size="sm"
            aria-label={t("vault.copyPublicFor", { name: secret.name })}
            onClick={props.onCopyPublicKey}
          >
            {t("vault.copyPublicKey")}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label={t("vault.removeFor", { name: secret.name })}
          onClick={props.onRemove}
        >
          {t("vault.remove")}
        </Button>
      </div>
    </li>
  );
}

const VAULTPAGE_KEYS = ["secrets", "hosts"] as const;

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
  const [infos, setInfos] = useState<Record<string, SecretInfo>>({});
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

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), revealMs);
    return () => clearTimeout(timer);
  }, [shown, revealMs]);

  const reveal = async (secret: SecretMeta) => {
    setAsking(null);
    const value = await store.vault.value(secret.id);
    if (value !== null) setShown({ id: secret.id, value });
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, SecretInfo> = {};
      for (const secret of state.secrets) {
        const value = await store.vault.value(secret.id);
        next[secret.id] = value === null ? {} : await describeSecret(secret.type, value);
      }
      if (alive) setInfos(next);
    })();
    return () => {
      alive = false;
    };
  }, [store, state.secrets]);

  return (
    <Page
      title={t("vault.title")}
      subtitle={t("vault.subtitle")}
      actions={
        !creating && <Button onClick={() => setCreating(true)}>{t("vault.newSecret")}</Button>
      }
    >
      {creating && <NewSecretForm store={store} onClose={() => setCreating(false)} />}
      {editing && (
        <EditSecretForm
          key={editing.id}
          store={store}
          secret={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {ruling && (
        <RulesEditor
          key={ruling.id}
          store={store}
          secret={ruling}
          {...(props.rule?.secretId === ruling.id ? { seed: props.rule.match } : {})}
          onClose={() => setRuling(null)}
        />
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
                  <Button onClick={() => setCreating(true)}>{t("vault.emptyAction")}</Button>
                )
              }
            />
          ) : (
            <ul aria-label={t("vault.list")} className="flex flex-col gap-2">
              {state.secrets.map((secret) => (
                <SecretRow
                  key={secret.id}
                  secret={secret}
                  info={infos[secret.id] ?? {}}
                  revealed={shown?.id === secret.id ? shown.value : null}
                  onReveal={() => setAsking(secret)}
                  onCopy={() => void store.copySecret(secret.id, clearMs)}
                  onRemove={() => setRemoving(secret)}
                  onEdit={() => setEditing(secret)}
                  onRules={() => setRuling(secret)}
                  onCopyPublicKey={() => void store.copyText(infos[secret.id]?.publicKey ?? "")}
                  hostName={(hostId) => state.hosts.find((h) => h.id === hostId)?.name ?? hostId}
                />
              ))}
            </ul>
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
          onConfirm={() => {
            void store.removeSecret(removing.id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Page>
  );
});
