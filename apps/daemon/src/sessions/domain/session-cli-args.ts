/** Issue #3514: what the verbs of `flightdeckd session` are given. */
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
    | "meta-set";
  /** Every verb but `interrupted`: the id or the name of the session. */
  session?: string;
  /** `set-model` and `set-effort`: the value, or `default` for the model's own. */
  value?: string;
  /** `meta-set`: the fields to change. */
  meta?: { name?: string | null; pinned?: boolean; archived?: boolean };
  json?: boolean;
}
