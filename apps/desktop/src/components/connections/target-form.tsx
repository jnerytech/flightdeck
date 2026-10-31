import type { SshAuth, SshTarget } from "@flightdeck/protocol";
import { useId, useState } from "react";
import { Form, FormActions } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SecretPicker } from "@/components/vault/secret-picker";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "@/lib/app-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

const SELECT = "h-9 rounded-md border bg-transparent px-2";
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

/** Creates or edits a ssh destino; only the reference to a secret is ever typed here. */
export function TargetForm(props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  /** The destino being edited; `null` for a new one. */
  target: SshTarget | null;
  /** The other destinos, for the jump. */
  others: SshTarget[];
  onSaved(): void;
  onClose(): void;
}) {
  const t = useT();
  const id = useId();
  const { store, state, hostId, target } = props;
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
  const [hostKey, setHostKey] = useState(target?.hostKey ?? null);
  const [testResult, setTestResult] = useState<string | null>(null);

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
    if (result) setTestResult(result.ok ? t("connections.form.testOk") : (result.error ?? ""));
  };

  const field = (key: string, label: string, control: (fieldId: string) => React.ReactNode) => (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {control(`${id}-${key}`)}
    </div>
  );

  return (
    <Form
      variant="panel"
      className="mb-4"
      onSubmit={() => {
        if (ready) void save();
      }}
    >
      {field("name", t("connections.form.name"), (fid) => (
        <Input id={fid} value={name} onChange={(event) => setName(event.target.value)} />
      ))}
      {field("host", t("connections.form.host"), (fid) => (
        <Input id={fid} value={host} onChange={(event) => setHost(event.target.value)} />
      ))}
      {field("port", t("connections.form.port"), (fid) => (
        <Input
          id={fid}
          value={port}
          inputMode="numeric"
          onChange={(event) => setPort(event.target.value)}
        />
      ))}
      {field("user", t("connections.form.user"), (fid) => (
        <Input id={fid} value={user} onChange={(event) => setUser(event.target.value)} />
      ))}
      {field("auth", t("connections.form.auth"), (fid) => (
        <select
          id={fid}
          className={SELECT}
          value={auth}
          onChange={(event) => setAuth(event.target.value as SshAuth)}
        >
          {AUTHS.map((option) => (
            <option key={option} value={option}>
              {t(`connections.form.authOption.${AUTH_KEY[option as keyof typeof AUTH_KEY]}`)}
            </option>
          ))}
        </select>
      ))}
      {auth === "key-file" &&
        field("key", t("connections.form.keyFile"), (fid) => (
          <Input id={fid} value={keyFile} onChange={(event) => setKeyFile(event.target.value)} />
        ))}
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
      {field("via", t("connections.form.via"), (fid) => (
        <select
          id={fid}
          className={SELECT}
          value={via}
          onChange={(event) => setVia(event.target.value)}
        >
          <option value="">{t("connections.thisHost")}</option>
          {state.hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      ))}
      {field("jump", t("connections.form.jump"), (fid) => (
        <select
          id={fid}
          className={SELECT}
          value={jump}
          onChange={(event) => setJump(event.target.value)}
        >
          <option value="">{t("connections.form.noJump")}</option>
          {props.others.map((other) => (
            <option key={other.id} value={other.id}>
              {other.name}
            </option>
          ))}
        </select>
      ))}
      {field("tags", t("connections.form.tags"), (fid) => (
        <Input id={fid} value={tags} onChange={(event) => setTags(event.target.value)} />
      ))}
      {field("alive", t("connections.form.alive"), (fid) => (
        <Input
          id={fid}
          value={alive}
          inputMode="numeric"
          onChange={(event) => setAlive(event.target.value)}
        />
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={compression}
          onChange={(event) => setCompression(event.target.checked)}
        />
        {t("connections.form.compression")}
      </label>
      {field("forwards", t("connections.form.forwards"), (fid) => (
        <Textarea id={fid} value={forwards} onChange={(event) => setForwards(event.target.value)} />
      ))}
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
          <Button type="button" variant="outline" size="sm" onClick={() => void forget()}>
            {t("connections.form.forget")}
          </Button>
        </div>
      )}
      {testResult && <p role="status">{testResult}</p>}
      <FormActions
        submit={t("connections.form.save")}
        disabled={!ready}
        cancel={t("common.cancel")}
        onCancel={props.onClose}
        extra={
          <>
            <Button type="button" variant="outline" disabled={!target} onClick={() => void test()}>
              {t("connections.form.test")}
            </Button>
          </>
        }
      />
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
}
