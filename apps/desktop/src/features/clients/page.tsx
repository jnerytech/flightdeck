import { ArrowDown, ArrowUp, Briefcase } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import {
  EmptyState,
  Field,
  Form,
  FormActions,
  Inline,
  ListRow,
  NativeSelect,
  Page,
  Panel,
  Stack,
} from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { anyHostHas } from "../../lib/version.ts";
import { ClientBudget } from "./client-budget.tsx";
import { ClientDefaults } from "./client-defaults.tsx";
import { ClientDot } from "./client-dot";
import { ClientRate } from "./client-rate.tsx";
import { ClientRules } from "./client-rules.tsx";
import { ClientsSuggest } from "./clients-suggest.tsx";
import { ClientsTransfer } from "./clients-transfer.tsx";
import { CLIENT_COLORS, type Client, type ClientColor } from "./domain/clients.ts";

/** Phase 29: the clients that group projects across hosts, with their rules. */
export function ClientsPage(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "clientList" | "clientOverrides" | "clientBudgets" | "hosts" | "secrets">;
  }>,
) {
  const { store, state } = props;
  const { t } = store.i18n;
  const clients = state.clientList;
  const withRoi = anyHostHas(state.hosts, "roi");
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<Client | null>(null);
  const [removing, setRemoving] = useState<Client | null>(null);

  const ambiguous = store.clientScope.get().ambiguousNames;
  const clean = name.trim();
  const taken = clients.some(
    (c) => c.id !== renaming?.id && c.name.toLowerCase() === clean.toLowerCase(),
  );
  let needs: string | null = taken ? t("clients.nameTaken") : null;
  if (clean === "") needs = t("clients.nameNeeded");

  const submit = () => {
    if (renaming) store.clients.rename(renaming.id, clean);
    else store.clients.add(clean);
    setRenaming(null);
    setName("");
  };

  return (
    <Page title={t("clients.title")} subtitle={t("clients.subtitle")}>
      <Stack gap={4}>
        {ambiguous.length > 0 && (
          <p className="text-muted-foreground text-sm">
            {t("clients.ambiguousHosts", { names: ambiguous.join(", ") })}
          </p>
        )}
        {clients.length === 0 ? (
          <EmptyState icon={Briefcase} title={t("clients.emptyTitle")} />
        ) : (
          <Stack as="ul" label={t("clients.list")} gap={2}>
            {clients.map((client, index) => (
              <li key={client.id}>
                <Stack gap={2}>
                  <ListRow
                    boxed
                    leading={<ClientDot color={client.color} />}
                    title={<span data-client-name>{client.name}</span>}
                    trailing={
                      <Inline gap={1}>
                        <NativeSelect
                          inline
                          compact
                          aria-label={t("clients.color", { name: client.name })}
                          value={client.color}
                          onChange={(e) =>
                            store.clients.recolor(client.id, e.target.value as ClientColor)
                          }
                        >
                          {CLIENT_COLORS.map((color) => (
                            <option key={color} value={color}>
                              {t(`clients.colors.${color}`)}
                            </option>
                          ))}
                        </NativeSelect>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("clients.up", { name: client.name })}
                          disabled={index === 0}
                          onClick={() => store.clients.move(client.id, index - 1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("clients.down", { name: client.name })}
                          disabled={index === clients.length - 1}
                          onClick={() => store.clients.move(client.id, index + 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("clients.rename", { name: client.name })}
                          onClick={() => {
                            setRenaming(client);
                            setName(client.name);
                          }}
                        >
                          {t("clients.renameShort")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("clients.remove", { name: client.name })}
                          onClick={() => setRemoving(client)}
                        >
                          {t("clients.removeShort")}
                        </Button>
                      </Inline>
                    }
                  />
                  <ClientRules store={store} state={state} client={client} />
                  <ClientBudget store={store} state={state} client={client} />
                  <ClientDefaults store={store} state={state} client={client} />
                  {withRoi && <ClientRate store={store} client={client} />}
                </Stack>
              </li>
            ))}
          </Stack>
        )}
        <ClientsSuggest store={store} state={state} />
        <ClientsTransfer store={store} />
        <Panel>
          <Form variant="inline" onSubmit={submit}>
            <Field label={t("clients.nameLabel")}>
              {(control) => (
                <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <FormActions
              submit={t(renaming ? "clients.saveName" : "clients.create")}
              disabled={needs !== null}
              disabledReason={clean === "" ? null : needs}
              {...(renaming
                ? {
                    cancel: t("clients.cancel"),
                    onCancel: () => {
                      setRenaming(null);
                      setName("");
                    },
                  }
                : {})}
            />
          </Form>
        </Panel>
      </Stack>
      {removing && (
        <ConfirmDialog
          message={t("clients.removeMessage", { name: removing.name })}
          confirmLabel={t("clients.removeConfirm")}
          destructive
          onConfirm={() => {
            store.clients.remove(removing.id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Page>
  );
}
