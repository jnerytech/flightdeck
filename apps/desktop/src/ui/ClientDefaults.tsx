import { useState } from "react";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Stack } from "@/components/layout/stack";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { Input } from "@/components/ui/input";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { generatedScopeRules, vaultFindings } from "../lib/client-vault.ts";
import type { Client } from "../lib/clients.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * What a client pre-fills: the persona its sessions open in, the tag its snippets carry, and the
 * tag of its secrets, with the opt-in that keeps them inside its projects.
 */
export function ClientDefaults(props: {
  store: AppStore;
  state: Pick<AppState, "hosts" | "secrets">;
  client: Client;
}) {
  const { store, state, client } = props;
  const { t } = store.i18n;
  const [persona, setPersona] = useState(client.defaults.persona ?? "");
  const [tag, setTag] = useState(client.defaults.snippetTag ?? "");
  const [vaultTag, setVaultTag] = useState(client.defaults.vaultTag ?? "");
  const [confirming, setConfirming] = useState(false);
  const scope = store.clientScope();
  const projects = scope.projectKeysOf(client.id);
  const saved = client.defaults.vaultTag;
  const tagged = saved ? state.secrets.filter((s) => s.tags.includes(saved)) : [];
  const preview = tagged.map((secret) => ({
    secret,
    rules: generatedScopeRules(client, projects, store.vaultRules(secret.id)),
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
    rulesOf: (id) => store.vaultRules(id),
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
        onSubmit={() =>
          store.clients.setDefaults(client.id, {
            persona,
            snippetTag: tag,
            vaultTag,
          })
        }
      >
        {host && (
          <PersonaPicker
            store={store}
            hostId={host.id}
            label={t("clients.defaultPersona")}
            value={persona}
            onChange={setPersona}
          />
        )}
        <Field label={t("clients.snippetTag")} help={t("clients.snippetTagHelp")}>
          {(control) => <Input {...control} value={tag} onChange={(e) => setTag(e.target.value)} />}
        </Field>
        <Field label={t("clients.vaultTag")} help={t("clients.vaultTagHelp")}>
          {(control) => (
            <Input {...control} value={vaultTag} onChange={(e) => setVaultTag(e.target.value)} />
          )}
        </Field>
        <FormActions submit={t("clients.saveDefaults")} />
      </Form>
      <label className="text-sm">
        <input
          type="checkbox"
          checked={client.defaults.vaultScope}
          disabled={!saved}
          onChange={(e) => {
            if (e.target.checked) setConfirming(true);
            else store.clients.setDefaults(client.id, { vaultScope: false });
          }}
        />{" "}
        {t("clients.vaultScope")}
      </label>
      {findings.length > 0 && (
        <Stack as="ul" label={t("clients.vaultFindingsTitle")} gap={1}>
          {findings.map((f) => (
            <li key={`${f.secretId}/${f.kind}`} className="text-status-needs-you text-sm">
              {t(
                f.kind === "hosts-wider" ? "clients.vaultFindingHosts" : "clients.vaultFindingRule",
                {
                  secret: f.secretName,
                  items: (f.kind === "hosts-wider" ? f.detail.map(hostName) : f.detail).join(", "),
                },
              )}
            </li>
          ))}
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
            store.clients.setDefaults(client.id, { vaultScope: true });
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Stack>
  );
}
