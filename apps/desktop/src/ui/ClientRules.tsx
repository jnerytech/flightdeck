import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { Field, Form, FormActions, NativeSelect } from "@/components/layout/form";
import { ListRow } from "@/components/layout/list-row";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Client, ClientRule, RuleInput } from "../lib/clients.ts";

const ruleValue = (rule: ClientRule) => (rule.kind === "remote" ? rule.pattern : rule.path);

/** The rules of one client: what joins a project to it, in order, and a form for a new one. */
export function ClientRules(props: {
  store: AppStore;
  state: Pick<AppState, "hosts">;
  client: Client;
}) {
  const { store, state, client } = props;
  const { t } = store.i18n;
  const [kind, setKind] = useState<RuleInput["kind"]>("remote");
  const [value, setValue] = useState("");
  const [host, setHost] = useState("");

  const clean = value.trim();
  const input: RuleInput =
    kind === "remote" ? { kind, pattern: clean } : { kind, path: clean, ...(host ? { host } : {}) };
  const matches = clean ? store.clientScope().matching(input).length : 0;
  const valid = clean !== "" && (kind === "folder" || !/\s/.test(clean));

  const hostLabel = (rule: ClientRule) => {
    if (rule.kind === "remote") return null;
    if (rule.host === undefined) return t("clients.anyHost");
    return state.hosts.find((h) => h.id === rule.host)?.name ?? t("clients.unknownHost");
  };

  return (
    <Stack gap={2}>
      {client.rules.length > 0 && (
        <Stack as="ul" label={t("clients.rulesOf", { name: client.name })} gap={1}>
          {client.rules.map((rule, index) => (
            <li key={rule.id}>
              <ListRow
                title={<span data-rule-value>{ruleValue(rule)}</span>}
                meta={hostLabel(rule)}
                trailing={
                  <Inline gap={1}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("clients.upRule", { value: ruleValue(rule) })}
                      disabled={index === 0}
                      onClick={() => store.clients.moveRule(client.id, rule.id, index - 1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("clients.downRule", { value: ruleValue(rule) })}
                      disabled={index === client.rules.length - 1}
                      onClick={() => store.clients.moveRule(client.id, rule.id, index + 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("clients.removeRule", { value: ruleValue(rule) })}
                      onClick={() => store.clients.removeRule(client.id, rule.id)}
                    >
                      <X />
                    </Button>
                  </Inline>
                }
              />
            </li>
          ))}
        </Stack>
      )}
      <Form
        variant="inline"
        aria-label={t("clients.newRule", { name: client.name })}
        onSubmit={() => {
          if (store.clients.addRule(client.id, input)) setValue("");
        }}
      >
        <Inline gap={2}>
          <Field label={t("clients.kindLabel")}>
            {(control) => (
              <NativeSelect
                {...control}
                value={kind}
                onChange={(e) => setKind(e.target.value as RuleInput["kind"])}
              >
                <option value="remote">{t("clients.kindRemote")}</option>
                <option value="folder">{t("clients.kindFolder")}</option>
              </NativeSelect>
            )}
          </Field>
          <Field
            label={t("clients.valueLabel")}
            help={t(kind === "remote" ? "clients.valueHelpRemote" : "clients.valueHelpFolder")}
          >
            {(control) => (
              <Input {...control} value={value} onChange={(e) => setValue(e.target.value)} />
            )}
          </Field>
          {kind === "folder" && (
            <Field label={t("clients.hostLabel")}>
              {(control) => (
                <NativeSelect {...control} value={host} onChange={(e) => setHost(e.target.value)}>
                  <option value="">{t("clients.anyHost")}</option>
                  {state.hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
        </Inline>
        {clean && (
          <p data-rule-preview className="text-muted-foreground text-sm">
            {matches === 0
              ? t("clients.previewNone")
              : matches === 1
                ? t("clients.previewOne")
                : t("clients.previewMany", { count: matches })}
          </p>
        )}
        <FormActions submit={t("clients.addRule")} disabled={!valid} />
      </Form>
    </Stack>
  );
}
