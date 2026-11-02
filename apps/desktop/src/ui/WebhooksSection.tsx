import { useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, Form, FormActions, NativeSelect } from "@/components/layout/form";
import { ListRow } from "@/components/layout/list-row";
import { Panel } from "@/components/layout/panel";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { hasFeature } from "../lib/version.ts";
import type { WebhookKind, WebhookType } from "../lib/webhook-format.ts";
import { type WebhookTarget, WebhookTargetError } from "../lib/webhook-targets.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const HOSTS = ["hosts"] as const;
const KINDS: WebhookKind[] = [
  "needs_you",
  "session_ended",
  "session_failed",
  "budget_alert",
  "pr_watch",
];
const TYPES: WebhookType[] = ["slack", "discord", "generic"];

interface Draft {
  id?: string;
  name: string;
  type: WebhookType;
  url: string;
  signing: string;
  hostScope: string;
  kinds: WebhookKind[];
}

const EMPTY: Draft = { name: "", type: "slack", url: "", signing: "", hostScope: "", kinds: [] };

/**
 * Phase 30: where the app sends a message when something needs you. A target's address is a vault
 * secret: the list shows only the host it sends to, and an empty address field on edit keeps it.
 */
export function WebhooksSection(props: { store: AppStore }) {
  const t = useT();
  const { store } = props;
  const hosts = useStoreSlice(store, HOSTS).hosts;
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<WebhookTarget | null>(null);
  const saving = useBusy();
  const testing = useBusy();
  void version;
  const targets = store.webhooks.targets.list();
  const canPost = hosts.some(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "webhook", false),
  );
  const editing = targets.find((target) => target.id === draft.id);
  const refresh = () => setVersion((n) => n + 1);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const complete =
    draft.name.trim() !== "" && draft.kinds.length > 0 && (editing || draft.url.trim() !== "");

  const save = async () => {
    setError(null);
    try {
      const scope = draft.hostScope === "" ? null : draft.hostScope;
      if (editing) {
        await store.webhooks.edit(editing.id, {
          name: draft.name,
          type: draft.type,
          hostScope: scope,
          kinds: draft.kinds,
          ...(draft.url.trim() ? { url: draft.url.trim() } : {}),
          ...(draft.signing ? { signingSecret: draft.signing } : {}),
        });
      } else {
        await store.webhooks.targets.add({
          name: draft.name,
          type: draft.type,
          url: draft.url.trim(),
          hostScope: scope,
          kinds: draft.kinds,
          clientId: null,
          ...(draft.signing ? { signingSecret: draft.signing } : {}),
        });
      }
      setDraft(EMPTY);
      refresh();
    } catch (cause) {
      const code = cause instanceof WebhookTargetError ? cause.code : "invalid_url";
      setError(t(`webhooks.errors.${code}` as Key));
    }
  };

  const test = async (target: WebhookTarget) => {
    const result = await store.webhooks.test(target.id);
    const time = new Date(result.at).toLocaleTimeString(t.lang);
    const status = result.httpStatus === null ? t("webhooks.noAnswer") : String(result.httpStatus);
    setResults((r) => ({
      ...r,
      [target.id]: t(result.ok ? "webhooks.testOk" : "webhooks.testFailed", { status, time }),
    }));
    refresh();
  };

  return (
    <section>
      <Panel title={t("webhooks.title")}>
        <Stack gap={3}>
          <p className="text-muted-foreground text-sm">{t("webhooks.intro")}</p>
          <InlineNotice tone="info">{t("webhooks.appOnly")}</InlineNotice>
          {!canPost && <InlineNotice>{t("webhooks.noHost")}</InlineNotice>}
          {targets.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("webhooks.empty")}</p>
          ) : (
            <Stack gap={2} as="ul">
              {targets.map((target) => (
                <li key={target.id}>
                  <Stack gap={1}>
                    <ListRow
                      boxed
                      title={<span className="font-medium">{target.name}</span>}
                      meta={
                        <Inline gap={2} className="text-muted-foreground">
                          {[
                            t(`webhooks.types.${target.type}` as Key),
                            t("webhooks.sendsTo", { host: target.urlHost }),
                            t(`webhooks.status.${target.status}` as Key),
                            target.lastHttpStatus === null
                              ? null
                              : t("webhooks.last", { status: target.lastHttpStatus }),
                            target.enabled ? null : t("webhooks.disabled"),
                          ]
                            .filter((part): part is string => part !== null)
                            .map((part) => (
                              <span key={part}>{part}</span>
                            ))}
                        </Inline>
                      }
                      trailing={
                        <Inline gap={1}>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("webhooks.test", { name: target.name })}
                            onClick={() => testing.run(() => test(target))}
                          >
                            {t("webhooks.test", { name: "" }).trim()}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("webhooks.edit", { name: target.name })}
                            onClick={() =>
                              setDraft({
                                id: target.id,
                                name: target.name,
                                type: target.type,
                                url: "",
                                signing: "",
                                hostScope: target.hostScope ?? "",
                                kinds: target.kinds,
                              })
                            }
                          >
                            {t("webhooks.edit", { name: "" }).trim()}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t(target.enabled ? "webhooks.disable" : "webhooks.enable", {
                              name: target.name,
                            })}
                            onClick={() =>
                              void store.webhooks
                                .edit(target.id, { enabled: !target.enabled })
                                .then(refresh)
                            }
                          >
                            {t(target.enabled ? "webhooks.disable" : "webhooks.enable", {
                              name: "",
                            }).trim()}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("webhooks.remove", { name: target.name })}
                            onClick={() => setRemoving(target)}
                          >
                            {t("webhooks.remove", { name: "" }).trim()}
                          </Button>
                        </Inline>
                      }
                    />
                    {results[target.id] && (
                      <p role="status" className="text-muted-foreground text-xs">
                        {results[target.id]}
                      </p>
                    )}
                  </Stack>
                </li>
              ))}
            </Stack>
          )}
          <Form
            variant="inline"
            aria-label={editing ? t("webhooks.edit", { name: editing.name }) : t("webhooks.add")}
            onSubmit={() => saving.run(save)}
          >
            <Field label={t("webhooks.name")}>
              {(control) => (
                <Input
                  {...control}
                  value={draft.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("webhooks.type")}>
              {(control) => (
                <NativeSelect
                  {...control}
                  value={draft.type}
                  onChange={(e) => set({ type: e.target.value as WebhookType })}
                >
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`webhooks.types.${type}` as Key)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t("webhooks.url")} help={editing ? t("webhooks.urlKeep") : undefined}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="off"
                  value={draft.url}
                  onChange={(e) => set({ url: e.target.value })}
                />
              )}
            </Field>
            {draft.type === "generic" && (
              <Field label={t("webhooks.signing")}>
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    autoComplete="off"
                    value={draft.signing}
                    onChange={(e) => set({ signing: e.target.value })}
                  />
                )}
              </Field>
            )}
            <Field label={t("webhooks.scope")}>
              {(control) => (
                <NativeSelect
                  {...control}
                  value={draft.hostScope}
                  onChange={(e) => set({ hostScope: e.target.value })}
                >
                  <option value="">{t("webhooks.scopeAll")}</option>
                  {hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <fieldset>
              <legend className="font-medium text-sm">{t("webhooks.kinds")}</legend>
              <Stack gap={1}>
                {KINDS.map((kind) => (
                  <label key={kind} className="text-sm">
                    <Inline gap={2}>
                      <input
                        type="checkbox"
                        checked={draft.kinds.includes(kind)}
                        onChange={(e) =>
                          set({
                            kinds: e.target.checked
                              ? [...draft.kinds, kind]
                              : draft.kinds.filter((k) => k !== kind),
                          })
                        }
                      />
                      {t(`webhooks.kind.${kind}` as Key)}
                    </Inline>
                  </label>
                ))}
              </Stack>
            </fieldset>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            <FormActions
              submit={t(editing ? "webhooks.saveChanges" : "webhooks.save")}
              busy={saving.busy}
              disabled={!complete}
              disabledReason={t("webhooks.needs")}
              {...(editing
                ? { cancel: t("webhooks.cancel"), onCancel: () => setDraft(EMPTY) }
                : {})}
            />
          </Form>
        </Stack>
      </Panel>
      {removing && (
        <ConfirmDialog
          message={t("webhooks.removeMessage", { name: removing.name })}
          confirmLabel={t("webhooks.removeConfirm")}
          destructive
          onConfirm={() => {
            void store.webhooks.targets.remove(removing.id).then(refresh);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
