import { TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { PersonaPicker } from "@/features/personas/ui.ts";
import { useDraft } from "@/features/sessions/index.ts";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Inline, Stack, SwitchField } from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { generatedScopeRules, vaultFindings } from "./domain/client-vault.ts";
import type { Client } from "./domain/clients.ts";

/**
 * What a client pre-fills: the persona its sessions open in, the tag its snippets carry, and the
 * tag of its secrets, with the opt-in that keeps them inside its projects.
 */
export function ClientDefaults(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "hosts" | "secrets">;
    client: Client;
  }>,
) {
  const { store, state, client } = props;
  const { t } = store.i18n;
  const [persona, setPersona, savedPersona] = useDraft(client.defaults.persona ?? "");
  const [tag, setTag, savedTag] = useDraft(client.defaults.snippetTag ?? "");
  const [vaultTag, setVaultTag, savedVaultTag] = useDraft(client.defaults.vaultTag ?? "");
  const [confirming, setConfirming] = useState(false);
  const tagField = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  /** What the last save did: a polite line, not silence (#3875). */
  const [done, setDone] = useState<string | null>(null);
  // The host keeps a value trimmed, so a draft that only adds blanks is no change.
  const changed =
    persona.trim() !== (client.defaults.persona ?? "") ||
    tag.trim() !== (client.defaults.snippetTag ?? "") ||
    vaultTag.trim() !== (client.defaults.vaultTag ?? "");
  const scope = store.clientScope.get();
  const projects = scope.projectKeysOf(client.id);
  const saved = client.defaults.vaultTag;
  const needsTag = !saved && !client.defaults.vaultScope;
  const tagged = saved ? state.secrets.filter((s) => s.tags.includes(saved)) : [];
  const preview = tagged.map((secret) => ({
    secret,
    rules: generatedScopeRules(client, projects, store.vaultRules.get(secret.id)),
  }));
  const holdingHosts = [
    ...new Set(
      scope.knownProjects
        .filter((p) => scope.clientOf(p.key) === client.id)
        .flatMap((p) => p.cwds.map((c) => c.hostId)),
    ),
  ];
  const hostName = (id: string) => state.hosts.find((h) => h.id === id)?.name ?? id;
  const findings = vaultFindings({
    client,
    secrets: state.secrets,
    rulesOf: (id) => store.vaultRules.get(id),
    scope,
    holdingHosts,
  });
  // The personas offered are those of the first online host that keeps them.
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "personas", false),
  );
  return (
    <Stack gap={2}>
      <Form
        variant="inline"
        aria-label={t("clients.defaultsOf", { name: client.name })}
        onSubmit={() => {
          if (!store.clients.setDefaults(client.id, { persona, snippetTag: tag, vaultTag })) return;
          savedPersona(persona);
          savedTag(tag);
          savedVaultTag(vaultTag);
          setDone(t("clients.defaultsSaved"));
          // The pressed Save is disabled now: a field takes the focus.
          tagField.current?.focus();
        }}
      >
        {host && (
          <PersonaPicker
            store={store}
            hostId={host.id}
            label={t("clients.defaultPersona")}
            value={persona}
            onChange={(value) => {
              setPersona(value);
              setDone(null);
            }}
          />
        )}
        <Field label={t("clients.snippetTag")} help={t("clients.snippetTagHelp")}>
          {(control) => (
            <Input
              {...control}
              ref={tagField}
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setDone(null);
              }}
            />
          )}
        </Field>
        <Field label={t("clients.vaultTag")} help={t("clients.vaultTagHelp")}>
          {(control) => (
            <Input
              {...control}
              value={vaultTag}
              onChange={(e) => {
                setVaultTag(e.target.value);
                setDone(null);
              }}
            />
          )}
        </Field>
        <FormActions
          submit={t("clients.saveDefaults")}
          disabled={!changed}
          disabledReason={t("clients.unchanged")}
        />
      </Form>
      {done && <InlineNotice tone="info">{done}</InlineNotice>}
      <SwitchField
        // A scope left on after its tag was cleared must still be switchable off.
        disabled={!saved && !client.defaults.vaultScope}
        describedBy={needsTag ? reasonId : undefined}
        checked={client.defaults.vaultScope}
        onChange={(on) => {
          if (on) {
            setConfirming(true);
            return;
          }
          if (!store.clients.setDefaults(client.id, { vaultScope: false })) return;
          setDone(t("clients.vaultScopeOff", { name: client.name }));
        }}
      >
        {t("clients.vaultScope")}
      </SwitchField>
      {needsTag && (
        <p id={reasonId} className="text-muted-foreground text-xs">
          {t("clients.vaultScopeNeedsTag")}
        </p>
      )}
      {findings.length > 0 && (
        <Stack gap={1}>
          <p className="font-medium text-sm">{t("clients.vaultFindingsTitle")}</p>
          <Stack as="ul" gap={1}>
            {findings.map((f) => (
              <li key={`${f.secretId}/${f.kind}`} className="text-status-needs-you text-sm">
                <Inline gap={1}>
                  <TriangleAlert aria-hidden="true" className="size-3.5" />
                  <span>
                    {t(
                      f.kind === "hosts-wider"
                        ? "clients.vaultFindingHosts"
                        : "clients.vaultFindingRule",
                      {
                        secret: f.secretName,
                        items: (f.kind === "hosts-wider" ? f.detail.map(hostName) : f.detail).join(
                          ", ",
                        ),
                      },
                    )}
                  </span>
                </Inline>
              </li>
            ))}
          </Stack>
        </Stack>
      )}
      {confirming && (
        <ConfirmDialog
          message={t("clients.vaultScopeMessage", {
            name: client.name,
            secrets: preview.length,
            tag: saved ?? "",
            rules: preview.reduce((sum, p) => sum + p.rules.length, 0),
          })}
          warning={t("clients.vaultScopeWarning")}
          confirmLabel={t("clients.vaultScopeConfirm")}
          onConfirm={() => {
            setConfirming(false);
            if (!store.clients.setDefaults(client.id, { vaultScope: true })) return;
            setDone(
              t("clients.vaultScopeOn", {
                name: client.name,
                secrets: preview.length,
                rules: preview.reduce((sum, p) => sum + p.rules.length, 0),
              }),
            );
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Stack>
  );
}
