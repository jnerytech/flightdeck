import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { SecretInfo } from "./domain/vault-types.ts";
import type { SecretMeta } from "./vault.ts";

/** What describes a secret on its row, without revealing it. */
function infoText(info: SecretInfo, fingerprint: (value: string) => string): string {
  if (info.fingerprint) return fingerprint(info.fingerprint);
  return info.hint ?? info.names?.join(", ") ?? "";
}

export function SecretRow(
  props: Readonly<{
    secret: SecretMeta;
    info: SecretInfo;
    /** The value, while it is revealed. */
    revealed: string | null;
    /** Handed the button, so the focus can come back to it when the confirmation closes. */
    onReveal(button: HTMLElement): void;
    onCopy(): void;
    onRemove(button: HTMLElement): void;
    onEdit(): void;
    /** Phase 19: the secret's usage rules. */
    onRules(): void;
    onCopyPublicKey(): void;
    hostName(id: string): string;
    /** A moment (epoch ms) as the app writes dates and times. */
    formatWhen(ms: number): string;
  }>,
) {
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
            : t("vault.lastUsed", { when: props.formatWhen(secret.lastUsedAt) })}
        </span>
        <span>
          {t("vault.hosts", { hosts: secret.allowedHosts.map(props.hostName).join(", ") })}
        </span>
      </p>
      {props.revealed !== null && (
        <code className="break-all rounded bg-muted p-2 text-sm">{props.revealed}</code>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={t("vault.revealFor", { name: secret.name })}
          onClick={(event) => props.onReveal(event.currentTarget)}
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
          data-opener={`edit:${secret.id}`}
          onClick={props.onEdit}
        >
          {t("vault.edit")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-opener={`rules:${secret.id}`}
          onClick={props.onRules}
        >
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
          onClick={(event) => props.onRemove(event.currentTarget)}
        >
          {t("vault.remove")}
        </Button>
      </div>
    </li>
  );
}
