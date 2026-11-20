/** Issue #3514: what the verbs of `flightdeckd session` are given. */
import type { EffortLevel, PermissionMode } from "@flightdeck/protocol";

export interface SessionCliArgs {
  action:
    | "interrupted"
    | "summary"
    | "files"
    | "interrupt"
    | "close"
    | "resume"
    | "sleep"
    | "set-model"
    | "set-effort"
    | "meta-set"
    | "create"
    | "set-mode"
    | "fork"
    | "apply-persona"
    | "clear-persona";
  /** Every verb but `interrupted`: the id or the name of the session. */
  session?: string;
  /** `set-model` and `set-effort`: the value, or `default` for the model's own. */
  value?: string;
  /** `meta-set`: the fields to change. */
  meta?: { name?: string | null; pinned?: boolean; archived?: boolean };
  /** `fork`: the Claude session id to fork. */
  claudeSessionId?: string;
  /** `create`, `fork`, `apply-persona` and `clear-persona`: the options of the verb. */
  start?: SessionStartOptions;
  json?: boolean;
}

/** The options `session create`, `fork` and the persona verbs read from their flags. */
export interface SessionStartOptions {
  cwd?: string;
  prompt?: string;
  name?: string;
  model?: string;
  effort?: EffortLevel;
  permissionMode?: PermissionMode;
  persona?: string;
  language?: "en" | "pt-BR";
  upToMessageId?: string;
  open?: "flightdeck" | "terminal";
}
