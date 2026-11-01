import type { SshAuth, SshTarget } from "@flightdeck/protocol";
import { memo, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Field, Form, FormActions, NativeSelect } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SecretPicker } from "@/components/vault/secret-picker";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";
import { useStoreSlice } from "@/lib/use-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

const AUTHS: SshAuth[] = ["agent", "key-file", "vault-key", "password"];
/** The dictionary key of each authentication the form offers. */
const AUTH_KEY = {
  agent: "agent",
  "key-file": "keyFile",
  "vault-key": "vaultKey",
  password: "password",
} as const;

const split = (text: string, separator: string): string[] =>
  text
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);

const TARGETFORM_KEYS = ["secrets", "hosts"] as const;

/** Creates or edits a ssh destino; only the reference to a secret is ever typed here. */
export const TargetForm = memo(function TargetForm(props: {
  store: AppStore;
  hostId: string;
  /** The destino being edited; `null` for a new one. */
  target: SshTarget | null;
  /** The other destinos, for the jump. */
  others: SshTarget[];
  onSaved(): void;
  onClose(): void;
}) {
  const t = useT();
  const { store, hostId, target } = props;
  const state = useStoreSlice(store, TARGETFORM_KEYS);
  const [name, setName] = useState(target?.name ?? "");
  const [host, setHost] = useState(target?.host ?? "");
  const [port, setPort] = useState(String(target?.port ?? 22));
  const [user, setUser] = useState(target?.user ?? "");
  const [auth, setAuth] = useState<SshAuth>(target?.auth ?? "agent");
  const [keyFile, setKeyFile] = useState(
    target?.auth === "key-file" ? (target.secretRef ?? "") : "",
  );
  const [secretId, setSecretId] = useState(
    target && (target.auth === "vault-key" || target.auth === "password")
      ? (target.secretRef ?? "")
      : "",
  );
  const [via, setVia] = useState(target?.viaHost ?? "");
  const [jump, setJump] = useState(target?.jump ?? "");
  const [tags, setTags] = useState((target?.tags ?? []).join(", "));
  const [alive, setAlive] = useState(String(target?.options.serverAliveInterval ?? ""));
  const [compression, setCompression] = useState(target?.options.compression ?? false);
  const [forwards, setForwards] = useState((target?.options.localForward ?? []).join("\n"));
  const [forwardAgent, setForwardAgent] = useState(target?.options.forwardAgent ?? false);
  const [askingAgent, setAskingAgent] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [hostKey, setHostKey] = useState(target?.hostKey ?? null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const saving = useBusy();
  const ready =
    name.trim() !== "" &&
    host.trim() !== "" &&
    user.trim() !== "" &&
    (auth !== "vault-key" || secretId !== "");

  const save = async () => {
    const interval = Number(alive);
    const options = {
      ...(interval > 0 ? { serverAliveInterval: interval } : {}),
      ...(compression ? { compression: true } : {}),
      ...(split(forwards, "\n").length > 0 ? { localForward: split(forwards, "\n") } : {}),
      ...(forwardAgent ? { forwardAgent: true } : {}),
    };
    const saved = await store.hostCommand(hostId, "ssh.save", {
      ...(target ? { id: target.id } : {}),
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 22,
      user: user.trim(),
      viaHost: via === "" ? null : via,
      auth,
      secretRef:
        auth === "key-file"
          ? keyFile.trim() || null
          : auth === "vault-key" || auth === "password"
            ? secretId || null
            : null,
      jump: jump === "" ? null : jump,
      options,
      tags: split(tags, ","),
      ...(forwardAgent ? { confirm: true } : {}),
    });
    if (saved) props.onSaved();
  };

  const forget = async () => {
    if (!target) return;
    const updated = await store.hostCommand(hostId, "ssh.hostkey.forget", { targetId: target.id });
    if (updated) setHostKey(null);
  };

  const test = async () => {
    if (!target) return;
    let privateKey: string | undefined;
    if (auth === "vault-key" && secretId) {
      const got = await store.vaultSecretFor(hostId, secretId, "ssh");
      if (!got.ok) return setTestResult(t(`vault.refused.${got.code}`));
      privateKey = got.value;
    }
    const result = await store.hostCommand(hostId, "ssh.test", {
      targetId: target.id,
      ...(privateKey ? { privateKey } : {}),
    });
    if (!result) return;
    setTestResult(
      result.ok
        ? t("connections.form.testOk")
        : refusalText("", result.error ?? "", t, { reason: result.reason, params: result.params }),
    );
  };

  return (
    <Form
      variant="panel"
      className="mb-4"
      onSubmit={() => {
        if (ready) saving.run(save);
      }}
    >
      {
        <Field label={t("connections.form.name")}>
          {(control) => (
            <Input {...control} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>
      }
      {
        <Field label={t("connections.form.host")}>
          {(control) => (
            <Input {...control} value={host} onChange={(event) => setHost(event.target.value)} />
          )}
        </Field>
      }
      {
        <Field label={t("connections.form.port")}>
          {(control) => (
            <Input
              {...control}
              value={port}
              inputMode="numeric"
              onChange={(event) => setPort(event.target.value)}
            />
          )}
        </Field>
      }
      {
        <Field label={t("connections.form.user")}>
          {(control) => (
            <Input {...control} value={user} onChange={(event) => setUser(event.target.value)} />
          )}
        </Field>
      }
      {
        <Field label={t("connections.form.auth")}>
          {(control) => (
            <NativeSelect
              {...control}
              value={auth}
              onChange={(event) => setAuth(event.target.value as SshAuth)}
            >
              {AUTHS.map((option) => (
                <option key={option} value={option}>
                  {t(`connections.form.authOption.${AUTH_KEY[option as keyof typeof AUTH_KEY]}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      }
      {auth === "key-file" && (
        <Field label={t("connections.form.keyFile")}>
          {(control) => (
            <Input
              {...control}
              value={keyFile}
              onChange={(event) => setKeyFile(event.target.value)}
            />
          )}
        </Field>
      )}
      {auth === "vault-key" && (
        <SecretPicker
          label={t("connections.form.vaultKey")}
          secrets={state.secrets}
          types={["ssh-key"]}
          value={secretId}
          onChange={setSecretId}
        />
      )}
      {auth === "password" && (
        <SecretPicker
          label={t("connections.form.vaultPassword")}
          secrets={state.secrets}
          types={["password"]}
          value={secretId}
          onChange={setSecretId}
        />
      )}
      {
        <Field label={t("connections.form.via")}>
          {(control) => (
            <NativeSelect {...control} value={via} onChange={(event) => setVia(event.target.value)}>
              <option value="">{t("connections.thisHost")}</option>
              {state.hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      }
      {
        <Field label={t("connections.form.jump")}>
          {(control) => (
            <NativeSelect
              {...control}
              value={jump}
              onChange={(event) => setJump(event.target.value)}
            >
              <option value="">{t("connections.form.noJump")}</option>
              {props.others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      }
      {
        <Field label={t("connections.form.tags")}>
          {(control) => (
            <Input {...control} value={tags} onChange={(event) => setTags(event.target.value)} />
          )}
        </Field>
      }
      {
        <Field label={t("connections.form.alive")}>
          {(control) => (
            <Input
              {...control}
              value={alive}
              inputMode="numeric"
              onChange={(event) => setAlive(event.target.value)}
            />
          )}
        </Field>
      }
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={compression}
          onChange={(event) => setCompression(event.target.checked)}
        />
        {t("connections.form.compression")}
      </label>
      {
        <Field label={t("connections.form.forwards")}>
          {(control) => (
            <Textarea
              {...control}
              value={forwards}
              onChange={(event) => setForwards(event.target.value)}
            />
          )}
        </Field>
      }
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={forwardAgent}
          onChange={(event) => {
            if (event.target.checked) setAskingAgent(true);
            else setForwardAgent(false);
          }}
        />
        {t("connections.form.forwardAgent")}
      </label>
      {hostKey && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("connections.form.hostKey")}</span>
          <code className="break-all">{hostKey}</code>
          <Button type="button" variant="outline" size="sm" onClick={() => setForgetting(true)}>
            {t("connections.form.forget")}
          </Button>
        </div>
      )}
      {testResult && <p role="status">{testResult}</p>}
      <FormActions
        submit={t("connections.form.save")}
        busy={saving.busy}
        disabled={!ready}
        cancel={t("common.cancel")}
        onCancel={props.onClose}
        extra={
          <>
            <ActionButton type="button" variant="outline" disabled={!target} onClick={() => test()}>
              {t("connections.form.test")}
            </ActionButton>
          </>
        }
      />
      {forgetting && (
        <ConfirmDialog
          message={t("connections.form.forgetMessage")}
          confirmLabel={t("connections.form.forgetConfirm")}
          destructive
          onConfirm={() => {
            setForgetting(false);
            void forget();
          }}
          onCancel={() => setForgetting(false)}
        />
      )}
      {askingAgent && (
        <ConfirmDialog
          message={t("connections.form.forwardAgentMessage")}
          confirmLabel={t("connections.form.forwardAgentConfirm")}
          onConfirm={() => {
            setForwardAgent(true);
            setAskingAgent(false);
          }}
          onCancel={() => setAskingAgent(false)}
        />
      )}
    </Form>
  );
});
