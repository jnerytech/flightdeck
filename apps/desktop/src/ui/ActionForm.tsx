import type { ActionInfo } from "@flightdeck/protocol";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SecretPicker } from "@/components/vault/secret-picker";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Approval = ActionInfo["approval"];
const APPROVALS: Approval[] = ["first-per-session", "always", "never"];
const SECRET_REF = /^\{\{secret\.([^}]+)\}\}$/;

interface Draft {
  name: string;
  description: string;
  ssh: string;
  run: string;
  cwd: string;
  timeoutS: string;
  /** "" keeps the daemon's default for the kind of action. */
  approval: Approval | "";
  /** Environment variables fed by a vault secret. */
  env: Array<{ name: string; secretId: string }>;
  /** Environment values that are not a `{{secret.id}}`: kept as they are, not edited here. */
  literals: Record<string, string>;
  params: Array<{ name: string; pattern: string; default: string }>;
}

/** The form's starting point: the saved action, or an empty one. */
function draftOf(initial: ActionInfo | null): Draft {
  const entries = Object.entries(initial?.env ?? {});
  return {
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    ssh: initial?.ssh ?? "",
    run: (initial?.run ?? []).join("\n"),
    cwd: initial?.cwd ?? "",
    timeoutS: initial ? String(initial.timeoutS) : "",
    approval: initial?.approval ?? "",
    env: entries.flatMap(([name, value]) => {
      const secretId = SECRET_REF.exec(value)?.[1];
      return secretId ? [{ name, secretId }] : [];
    }),
    literals: Object.fromEntries(entries.filter(([, value]) => !SECRET_REF.test(value))),
    params: Object.entries(initial?.params ?? {}).map(([name, p]) => ({
      name,
      pattern: p.pattern,
      default: p.default ?? "",
    })),
  };
}

/** The declaration the daemon validates and saves. */
function definitionOf(draft: Draft, initial: ActionInfo | null): Record<string, unknown> {
  const timeout = Number.parseInt(draft.timeoutS, 10);
  // A row left blank (added and never filled) is not part of the action.
  const env = draft.env.filter((e) => e.name.trim() !== "" || e.secretId !== "");
  const params = draft.params.filter((p) => p.name.trim() !== "" || p.pattern !== "");
  const vars = {
    ...draft.literals,
    ...Object.fromEntries(env.map((e) => [e.name.trim(), `{{secret.${e.secretId}}}`])),
  };
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    run: draft.run.split("\n").filter((line) => line !== ""),
    env: vars,
    params: Object.fromEntries(
      params.map((p) => [
        p.name.trim(),
        { pattern: p.pattern, ...(p.default === "" ? {} : { default: p.default }) },
      ]),
    ),
    ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
    ...(Number.isInteger(timeout) ? { timeoutS: timeout } : {}),
    ...(draft.ssh.trim() ? { ssh: draft.ssh.trim() } : {}),
    ...(initial?.host ? { host: initial.host } : {}),
    ...(draft.approval ? { approval: draft.approval } : {}),
  };
}

/**
 * Creates an action (or edits one made in the app): its command as a list of arguments, the
 * environment variables fed by vault secrets, and the parameters with their pattern. The daemon
 * validates it, and what it refuses shows here.
 */
export function ActionForm(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  initial: ActionInfo | null;
  /** A new action's name and command, handed over from elsewhere. */
  seed?: { name: string; run: string[] };
  onClose(): void;
  onSaved(action: ActionInfo): void;
}) {
  const { store, initial } = props;
  const { t } = store.i18n;
  const [draft, setDraft] = useState<Draft>(() => ({
    ...draftOf(initial),
    ...(props.seed ? { name: props.seed.name, run: props.seed.run.join("\n") } : {}),
  }));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const secrets = store.getState().secrets;

  const save = async () => {
    const result = await store.hostRequest(props.hostId, "actions.save", {
      projectId: props.projectId,
      definition: definitionOf(draft, initial),
      secretIds: secrets.map((s) => s.id),
    });
    if (result.ok) props.onSaved(result.data);
    else setError(result.message);
  };

  const ids = useId();
  const field = (key: Key, value: string, onChange: (value: string) => void, disabled = false) => (
    <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-${key}`}>
      {t(key)}
      <Input
        id={`${ids}-${key}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {t(initial ? "actionsUi.form.editTitle" : "actionsUi.form.newTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
          {field("actionsUi.form.name", draft.name, (name) => set({ name }), initial !== null)}
          {field("actionsUi.form.description", draft.description, (description) =>
            set({ description }),
          )}
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-run`}>
            {t("actionsUi.form.run")}
            <Textarea
              id={`${ids}-run`}
              value={draft.run}
              onChange={(e) => set({ run: e.target.value })}
              className="font-mono"
            />
          </label>
          {field("actionsUi.form.ssh", draft.ssh, (ssh) => set({ ssh }))}
          {field("actionsUi.form.cwd", draft.cwd, (cwd) => set({ cwd }))}
          {field("actionsUi.form.timeout", draft.timeoutS, (timeoutS) => set({ timeoutS }))}
          <label className="flex flex-col gap-1 text-sm">
            {t("actionsUi.form.approval")}
            <select
              aria-label={t("actionsUi.form.approval")}
              className={SELECT}
              value={draft.approval}
              onChange={(e) => set({ approval: e.target.value as Draft["approval"] })}
            >
              <option value="">{t("actionsUi.form.approvalDefault")}</option>
              {APPROVALS.map((a) => (
                <option key={a} value={a}>
                  {t(`actionsUi.approval.${a}`)}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm">{t("actionsUi.form.envTitle")}</legend>
            {draft.env.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides their place
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={t("actionsUi.form.envName", { n: i + 1 })}
                  value={row.name}
                  onChange={(e) =>
                    set({
                      env: draft.env.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                    })
                  }
                />
                <SecretPicker
                  secrets={secrets}
                  value={row.secretId}
                  label={t("actionsUi.form.envSecret", { n: i + 1 })}
                  onChange={(secretId) =>
                    set({ env: draft.env.map((r, j) => (j === i ? { ...r, secretId } : r)) })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("actionsUi.form.envRemove", { n: i + 1 })}
                  onClick={() => set({ env: draft.env.filter((_, j) => j !== i) })}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => set({ env: [...draft.env, { name: "", secretId: "" }] })}
            >
              <Plus aria-hidden="true" />
              {t("actionsUi.form.envAdd")}
            </Button>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm">{t("actionsUi.form.paramsTitle")}</legend>
            {draft.params.map((row, i) => {
              const edit = (patch: Partial<typeof row>) =>
                set({ params: draft.params.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides their place
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={t("actionsUi.form.paramName", { n: i + 1 })}
                    value={row.name}
                    onChange={(e) => edit({ name: e.target.value })}
                  />
                  <Input
                    aria-label={t("actionsUi.form.paramPattern", { n: i + 1 })}
                    value={row.pattern}
                    onChange={(e) => edit({ pattern: e.target.value })}
                  />
                  <Input
                    aria-label={t("actionsUi.form.paramDefault", { n: i + 1 })}
                    value={row.default}
                    onChange={(e) => edit({ default: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("actionsUi.form.paramRemove", { n: i + 1 })}
                    onClick={() => set({ params: draft.params.filter((_, j) => j !== i) })}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                set({ params: [...draft.params, { name: "", pattern: "", default: "" }] })
              }
            >
              <Plus aria-hidden="true" />
              {t("actionsUi.form.paramAdd")}
            </Button>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-status-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            {t("actionsUi.form.cancel")}
          </Button>
          <Button onClick={() => void save()}>{t("actionsUi.form.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
