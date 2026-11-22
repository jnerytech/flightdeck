import { ArrowDown, ArrowUp, Briefcase } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
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

/** Where the focus goes once a change is on screen: the pressed control may be gone or disabled (#4344). */
type AfterFocus =
  | { kind: "field" }
  | { kind: "rename"; id: string }
  | { kind: "moved"; id: string; to: number; dir: "up" | "down" }
  | { kind: "gone"; id: string; next: string | null };

type Control = "up" | "down" | "rename";

/** The control the focus goes to, or null while the list has not caught up with the change. */
function focusTarget(
  focus: AfterFocus,
  clients: readonly Client[],
  control: (id: string, which: Control) => HTMLElement | undefined,
  field: HTMLElement | null,
): HTMLElement | null {
  if (focus.kind === "field") return field;
  if (focus.kind === "rename") return control(focus.id, "rename") ?? null;
  if (focus.kind === "gone") {
    if (clients.some((c) => c.id === focus.id)) return null;
    return (focus.next ? control(focus.next, "rename") : undefined) ?? field;
  }
  if (clients.findIndex((c) => c.id === focus.id) !== focus.to) return null;
  // At either end the arrow that was pressed is now disabled: its twin takes the focus.
  const atEdge = focus.dir === "up" ? focus.to === 0 : focus.to === clients.length - 1;
  const opposite = focus.dir === "up" ? "down" : "up";
  return control(focus.id, atEdge ? opposite : focus.dir) ?? null;
}

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

  /** What the last change did: a polite line, not silence (#4344). */
  const [done, setDone] = useState<string | null>(null);
  const [focus, setFocus] = useState<AfterFocus | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const field = useRef<HTMLInputElement>(null);
  const controlRef = (id: string, which: Control) => (el: HTMLElement | null) => {
    if (el) controls.current.set(`${id}:${which}`, el);
    else controls.current.delete(`${id}:${which}`);
  };

  useEffect(() => {
    if (!focus) return;
    const target = focusTarget(
      focus,
      clients,
      (id, which) => controls.current.get(`${id}:${which}`),
      field.current,
    );
    if (!target) return;
    target.focus();
    setFocus(null);
  }, [focus, clients]);

  const stopRenaming = () => {
    setRenaming(null);
    setName("");
  };
  const submit = () => {
    if (renaming) {
      if (!store.clients.rename(renaming.id, clean)) return;
      setDone(t("clients.renamed", { name: clean }));
      setFocus({ kind: "rename", id: renaming.id });
    } else {
      if (!store.clients.add(clean)) return;
      setDone(t("clients.created", { name: clean }));
      setFocus({ kind: "field" });
    }
    stopRenaming();
  };
  const move = (client: Client, index: number, to: number) => {
    if (!store.clients.move(client.id, to)) return;
    setDone(t("clients.moved", { name: client.name, n: to + 1, total: clients.length }));
    setFocus({ kind: "moved", id: client.id, to, dir: to < index ? "up" : "down" });
  };
  const remove = (client: Client) => {
    const index = clients.findIndex((c) => c.id === client.id);
    const next = clients[index + 1] ?? clients[index - 1];
    setRemoving(null);
    if (!store.clients.remove(client.id)) return;
    if (renaming?.id === client.id) stopRenaming();
    setDone(t("clients.removed", { name: client.name }));
    setFocus({ kind: "gone", id: client.id, next: next?.id ?? null });
  };

  return (
    <Page title={t("clients.title")} subtitle={t("clients.subtitle")}>
      <Stack gap={4}>
        {ambiguous.length > 0 && (
          <p className="text-muted-foreground text-sm">
            {t("clients.ambiguousHosts", { names: ambiguous.join(", ") })}
          </p>
        )}
        {done && <InlineNotice tone="info">{done}</InlineNotice>}
        {clients.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={t("clients.emptyTitle")}
            detail={t("clients.emptyDetail")}
          />
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
                          onChange={(e) => {
                            const color = e.target.value as ClientColor;
                            if (!store.clients.recolor(client.id, color)) return;
                            setDone(
                              t("clients.colorChanged", {
                                name: client.name,
                                color: t(`clients.colors.${color}`),
                              }),
                            );
                          }}
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
                          ref={controlRef(client.id, "up")}
                          onClick={() => move(client, index, index - 1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("clients.down", { name: client.name })}
                          disabled={index === clients.length - 1}
                          ref={controlRef(client.id, "down")}
                          onClick={() => move(client, index, index + 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("clients.rename", { name: client.name })}
                          ref={controlRef(client.id, "rename")}
                          onClick={() => {
                            setRenaming(client);
                            setName(client.name);
                            setFocus({ kind: "field" });
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
        <Panel title={renaming ? t("clients.rename", { name: renaming.name }) : undefined}>
          <Form variant="inline" onSubmit={submit}>
            <Field label={t("clients.nameLabel")}>
              {(control) => (
                <Input
                  {...control}
                  ref={field}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
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
                      setFocus({ kind: "rename", id: renaming.id });
                      stopRenaming();
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
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Page>
  );
}
