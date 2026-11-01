import { useState } from "react";
import { Field, Form, FormActions } from "@/components/layout/form";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { Input } from "@/components/ui/input";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Client } from "../lib/clients.ts";
import { hasFeature } from "../lib/version.ts";

/** What a client pre-fills: the persona its sessions open in, and the tag its snippets carry. */
export function ClientDefaults(props: { store: AppStore; state: AppState; client: Client }) {
  const { store, state, client } = props;
  const { t } = store.i18n;
  const [persona, setPersona] = useState(client.defaults.persona ?? "");
  const [tag, setTag] = useState(client.defaults.snippetTag ?? "");
  // The personas offered are those of the first online host that keeps them.
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "personas", false),
  );
  return (
    <Form
      variant="inline"
      aria-label={t("clients.defaultsOf", { name: client.name })}
      onSubmit={() => store.clients.setDefaults(client.id, { persona, snippetTag: tag })}
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
      <FormActions submit={t("clients.saveDefaults")} />
    </Form>
  );
}
