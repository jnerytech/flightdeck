import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { Inline } from "@/shared/layout/index.ts";
import type { SecretInfo } from "./domain/vault-types.ts";
import type { SecretMeta } from "./vault.ts";

/** What describes a secret on its row, without revealing it, and the word that says what it is. */
function infoLine(
  info: SecretInfo,
  words: { fingerprint(value: string): string; hint: string; variables: string },
): { label?: string; text: string } {
  // A fingerprint carries its own word.
  if (info.fingerprint) return { text: words.fingerprint(info.fingerprint) };
  if (info.hint) return { label: words.hint, text: info.hint };
  const names = info.names?.join(", ");
  return names ? { label: words.variables, text: names } : { text: "" };
}

export function SecretRow(
  props: Readonly<{
    secret: SecretMeta;
    info: SecretInfo;
    /** The value, while it is revealed. */
    revealed: string | null;
    /** What a screen reader hears about the value (never the value); undefined on every other row. */
    status: string | undefined;
    onHide(): void;
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
  const detail = infoLine(info, {
    fingerprint: (value) => t("vault.fingerprint", { value }),
    hint: t("vault.hintLabel"),
    variables: t("vault.variablesLabel"),
  });
  const revealButton = useRef<HTMLButtonElement>(null);
  // A value that leaves takes its Hide now button along: when the focus was on it, or has nowhere
  // to be, it goes back to Reveal, where the person started.
  const wasRevealed = useRef(false);
  const revealedNow = props.revealed !== null;
  useEffect(() => {
    if (wasRevealed.current && !revealedNow && document.activeElement === document.body) {
      revealButton.current?.focus();
    }
    wasRevealed.current = revealedNow;
  }, [revealedNow]);
  return (
    <li className="flex flex-col gap-1 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{secret.name}</span>
        <span className="text-muted-foreground text-sm">{t(`vault.type.${secret.type}`)}</span>
        {secret.tags.length > 0 && (
          <Inline as="ul" label={t("vault.tagList")}>
            {secret.tags.map((tag) => (
              <li key={tag} className="rounded bg-muted px-1.5 text-xs">
                {tag}
              </li>
            ))}
          </Inline>
        )}
      </div>
      {detail.text && (
        <p className="font-mono text-muted-foreground text-sm">
          {detail.label && <span className="sr-only">{detail.label} </span>}
          {detail.text}
        </p>
      )}
      <p className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
        <span>
          {secret.lastUsedAt === null
            ? t("vault.neverUsed")
            : t("vault.lastUsed", { when: props.formatWhen(secret.lastUsedAt) })}
        </span>
        <span>
          {secret.allowedHosts.length === 0
            ? t("vault.noHost")
            : t("vault.hosts", { hosts: secret.allowedHosts.map(props.hostName).join(", ") })}
        </span>
      </p>
      {(props.status !== undefined || props.revealed !== null) && (
        <Inline>
          <output className="text-muted-foreground text-sm">{props.status}</output>
          {props.revealed !== null && (
            <Button
              variant="outline"
              size="sm"
              aria-label={t("vault.hideNowFor", { name: secret.name })}
              onClick={props.onHide}
            >
              {t("vault.hideNow")}
            </Button>
          )}
        </Inline>
      )}
      {props.revealed !== null && (
        <p>
          <span className="sr-only">{t("vault.valueOf", { name: secret.name })} </span>
          <code className="break-all rounded bg-muted p-2 text-sm">{props.revealed}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          ref={revealButton}
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
