import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/shared/feedback/index.ts";
import {
  Field,
  Form,
  FormActions,
  Inline,
  ListRow,
  NativeSelect,
  Stack,
} from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import type { Client, ClientRule, RuleInput } from "./domain/clients.ts";

const ruleValue = (rule: ClientRule) => (rule.kind === "remote" ? rule.pattern : rule.path);

/** How many sessions the rule would take in, in words. */
function previewText(matches: number, t: AppStore["i18n"]["t"]): string {
  if (matches === 0) return t("clients.previewNone");
  return matches === 1 ? t("clients.previewOne") : t("clients.previewMany", { count: matches });
}

/** Where the focus goes once a change is on screen: the pressed control may be gone or disabled (#3631). */
type AfterFocus =
  | { kind: "gone"; id: string; next: string | null }
  | { kind: "moved"; id: string; to: number; dir: "up" | "down" };

type Control = "up" | "down" | "remove";

const opposite = (dir: "up" | "down"): "up" | "down" => (dir === "up" ? "down" : "up");

/** The control the focus goes to, or null while the list has not caught up with the change. */
function focusTarget(
  focus: AfterFocus,
  rules: readonly ClientRule[],
  control: (id: string, which: Control) => HTMLElement | undefined,
  valueField: HTMLElement | null,
): HTMLElement | null {
  if (focus.kind === "gone") {
    if (rules.some((r) => r.id === focus.id)) return null;
    return (focus.next ? control(focus.next, "remove") : undefined) ?? valueField;
  }
  if (rules.findIndex((r) => r.id === focus.id) !== focus.to) return null;
  // At either end the arrow that was pressed is now disabled: its twin takes the focus.
  const atEdge = focus.dir === "up" ? focus.to === 0 : focus.to === rules.length - 1;
  const which: Control = atEdge ? opposite(focus.dir) : focus.dir;
  return control(focus.id, which) ?? null;
}

/** The rules of one client: what joins a project to it, in order, and a form for a new one. */
export function ClientRules(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "hosts">;
    client: Client;
  }>,
) {
  const { store, state, client } = props;
  const { t } = store.i18n;
  const [kind, setKind] = useState<RuleInput["kind"]>("remote");
  const [value, setValue] = useState("");
  const [host, setHost] = useState("");
  /** What the last change did: a polite line, not silence (#3631). */
  const [done, setDone] = useState<string | null>(null);
  const [focus, setFocus] = useState<AfterFocus | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const valueField = useRef<HTMLInputElement>(null);
  const controlRef = (id: string, which: Control) => (el: HTMLElement | null) => {
    if (el) controls.current.set(`${id}:${which}`, el);
    else controls.current.delete(`${id}:${which}`);
  };

  useEffect(() => {
    if (!focus) return;
    const target = focusTarget(
      focus,
      client.rules,
      (id, which) => controls.current.get(`${id}:${which}`),
      valueField.current,
    );
    if (!target) return;
    target.focus();
    setFocus(null);
  }, [focus, client.rules]);

  const move = (rule: ClientRule, index: number, to: number) => {
    if (!store.clients.moveRule(client.id, rule.id, to)) return;
    setDone(
      t("clients.ruleMoved", { value: ruleValue(rule), n: to + 1, total: client.rules.length }),
    );
    setFocus({ kind: "moved", id: rule.id, to, dir: to < index ? "up" : "down" });
  };
  const remove = (rule: ClientRule, index: number) => {
    if (!store.clients.removeRule(client.id, rule.id)) return;
    const next = client.rules[index + 1] ?? client.rules[index - 1];
    setDone(t("clients.ruleRemoved", { value: ruleValue(rule) }));
    setFocus({ kind: "gone", id: rule.id, next: next?.id ?? null });
  };

  const clean = value.trim();
  const input: RuleInput =
    kind === "remote" ? { kind, pattern: clean } : { kind, path: clean, ...(host ? { host } : {}) };
  const matches = clean ? store.clientScope.get().matching(input).length : 0;
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
                wrap
                title={<span data-rule-value>{ruleValue(rule)}</span>}
                meta={hostLabel(rule)}
                trailing={
                  <Inline gap={1}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("clients.upRule", { value: ruleValue(rule) })}
                      disabled={index === 0}
                      ref={controlRef(rule.id, "up")}
                      onClick={() => move(rule, index, index - 1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("clients.downRule", { value: ruleValue(rule) })}
                      disabled={index === client.rules.length - 1}
                      ref={controlRef(rule.id, "down")}
                      onClick={() => move(rule, index, index + 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("clients.removeRule", { value: ruleValue(rule) })}
                      ref={controlRef(rule.id, "remove")}
                      onClick={() => remove(rule, index)}
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
      {done && <InlineNotice tone="info">{done}</InlineNotice>}
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
              <Input
                {...control}
                ref={valueField}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
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
            {previewText(matches, t)}
          </p>
        )}
        <FormActions submit={t("clients.addRule")} disabled={!valid} />
      </Form>
    </Stack>
  );
}
