import type { ActionInfo } from "@flightdeck/protocol";
import type { ActionSeed } from "../../snippets/index.ts";

type Approval = ActionInfo["approval"];
export const APPROVALS: Approval[] = ["first-per-session", "always", "never"];
const SECRET_REF = /^\{\{secret\.([^}]+)\}\}$/;

export interface Draft {
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

/** The form's starting point: the saved action, a snippet's seed (phase 18), or an empty one. */
export function draftOf(initial: ActionInfo | null, seed?: ActionSeed): Draft {
  const entries = Object.entries(initial?.env ?? {});
  if (!initial && seed) {
    return {
      ...draftOf(null),
      name: seed.name,
      run: seed.run.join("\n"),
      // The secret is chosen in the vault: the value the snippet had never comes here.
      env: (seed.env ?? []).map((name) => ({ name, secretId: "" })),
    };
  }
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
export function definitionOf(draft: Draft, initial: ActionInfo | null): Record<string, unknown> {
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
