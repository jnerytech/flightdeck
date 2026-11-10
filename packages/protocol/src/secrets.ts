// The Secrets context: vault rules and requests, declared actions, webhooks and SSH destinations (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";
import { TerminalCols, type TerminalInfo, TerminalRows } from "./terminal.ts";

/** Phase 30: what a webhook post gave back. The answer's body is never returned. */
export const WebhookSendResult = z.object({
  /** `null` when the request got no answer (network error, timeout). */
  status: z.number().int().nullable(),
  /** The receiver's `Retry-After`, in milliseconds. */
  retryAfterMs: z.number().nonnegative().nullable(),
  /** Why the daemon would not post at all (private address, not https, ...). */
  refused: z.string().nullable(),
});
export type WebhookSendResult = z.infer<typeof WebhookSendResult>;

/** Phase 16: who asks for a secret. `you` is only for uses the app itself started. */
export const VaultRequester = z.enum(["you", "claude", "automation", "workflow"]);
export type VaultRequester = z.infer<typeof VaultRequester>;

/** Phase 16: who a daemon can be asking for; never `you`. */
export const VaultDaemonRequester = z.enum(["claude", "automation", "workflow"]);
export type VaultDaemonRequester = z.infer<typeof VaultDaemonRequester>;

/** Phase 17: how an action asks for approval. */
export const ActionApproval = z.enum(["always", "never", "first-per-session"]);

/** Phase 17: a declared action, as the app lists it (no secret values: only which ids it uses). */
export const ActionInfo = z.object({
  name: z.string(),
  description: z.string(),
  /** `app` was made in the app; `versioned` comes from .flightdeck/actions.yaml. */
  source: z.enum(["app", "versioned"]),
  projectId: z.string().nullable(),
  host: z.string().nullable(),
  ssh: z.string().nullable(),
  run: z.array(z.string()),
  cwd: z.string().nullable(),
  env: z.record(z.string(), z.string()),
  params: z.record(z.string(), z.object({ pattern: z.string(), default: z.string().nullable() })),
  timeoutS: z.number().int(),
  /** The effective mode: the declared one, or the default for its kind. */
  approval: ActionApproval,
  /** Labels such as prod, from the action. */
  tags: z.array(z.string()),
  secrets: z.object({ values: z.array(z.string()), files: z.array(z.string()) }),
  trusted: z.boolean(),
  /** What differs from what was trusted: "declaração" and/or file paths. */
  changed: z.array(z.string()),
  /** What to pass to `actions.trust` to trust this declaration as it is. */
  hash: z.string(),
});
export type ActionInfo = z.infer<typeof ActionInfo>;

/** Phase 17: one run of an action; the output is masked. */
export const ActionRunInfo = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  requestedBy: VaultRequester,
  startedAt: z.string(),
  durationMs: z.number().int(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
  output: z.string(),
});
export type ActionRunInfo = z.infer<typeof ActionRunInfo>;

/** The actions of a scope, and what is wrong with the versioned file (the valid ones still load). */
export const ActionList = z.object({
  actions: z.array(ActionInfo),
  errors: z.array(z.string()),
  /** What is wrong in the actions file, one item per problem, for the app to translate. */
  issues: z
    .array(
      z.object({
        path: z.string(),
        code: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      }),
    )
    .optional(),
});
export type ActionList = z.infer<typeof ActionList>;

export const ActionResult = z.object({
  runId: z.string(),
  exitCode: z.number().int(),
  output: z.string(),
  durationMs: z.number().int(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
});
export type ActionResult = z.infer<typeof ActionResult>;

/**
 * Phase 16: a use that needs a secret, asked of the app by the daemon. In this phase no daemon
 * feature asks, and a request that names `you` does not parse (the app treats it as unknown).
 */
export const VaultRequestFrame = z.object({
  type: z.literal("vault.request"),
  requestId: z.string(),
  secretId: z.string(),
  purpose: z.string(),
  requester: VaultDaemonRequester,
  /** Phase 17: the action that needs it, its parameters and how it asks for approval. */
  action: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
  approval: z.enum(["always", "never", "first-per-session"]).optional(),
  /** Phase 17: for `run_with_secret`, exactly what would run, with which secrets, and where. */
  command: z.string().optional(),
  secrets: z.array(z.string()).optional(),
  host: z.string().optional(),
  /** Phase 19: what the rules decided, and which rule did. `allow` is delivered without asking. */
  decision: z.enum(["allow", "ask"]).optional(),
  ruleId: z.string().nullable().optional(),
  reason: z.string().optional(),
  /** Ask once per session (the approval can be given for the session). */
  once: z.boolean().optional(),
  /** Prod or high risk: the Approve button is held for 2 s and the tray cannot approve. */
  needsHold: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  /** The request is denied if nobody answers by then (milliseconds since the epoch). */
  expiresAt: z.number().optional(),
});
export type VaultRequestFrame = z.infer<typeof VaultRequestFrame>;

/** Phase 16: a delivered secret was used (for the app's usage log); never carries the value. */
export const VaultUsed = z.object({
  type: z.literal("vault.used"),
  secretId: z.string(),
  purpose: z.string(),
  requester: VaultRequester,
  action: z.string(),
  at: z.string(),
});
export type VaultUsed = z.infer<typeof VaultUsed>;

/** Phase 19: a warning for the app, even where a rule lets the use through. */
export const VaultAlertFrame = z.object({
  type: z.literal("vault.alert"),
  kind: z.enum(["new-requester", "limit"]),
  secretId: z.string(),
  requester: VaultRequester,
  message: z.string(),
  at: z.string(),
});
export type VaultAlertFrame = z.infer<typeof VaultAlertFrame>;

export const VaultVerdict = z.object({
  decision: z.enum(["allow", "ask", "deny"]),
  ruleId: z.string().nullable(),
  reason: z.string(),
  once: z.boolean(),
  needsHold: z.boolean(),
  limited: z.boolean(),
});
export type VaultVerdict = z.infer<typeof VaultVerdict>;

export const VaultOutcome = z.enum([
  "pending",
  "allowed",
  "approved",
  "denied",
  "expired",
  "refused",
  "failed",
]);
export type VaultOutcome = z.infer<typeof VaultOutcome>;

/** Phase 19: one decision about a use of a secret, for the audit. */
export const VaultDecisionInfo = z.object({
  id: z.string(),
  at: z.string(),
  secretId: z.string(),
  requester: VaultRequester,
  purpose: z.enum(["ssh", "action", "run_with_secret"]),
  action: z.string().nullable(),
  host: z.string(),
  project: z.string().nullable(),
  session: z.string().nullable(),
  ruleId: z.string().nullable(),
  decision: z.enum(["allow", "ask", "deny"]),
  outcome: VaultOutcome,
  /** Who let it through: the rule, the app, the tray or an approval earlier in the session. */
  approver: z.enum(["rule", "app", "tray", "session"]).nullable(),
  /** The rule's time window, as it was. */
  window: z.string().nullable(),
  reason: z.string(),
});
export type VaultDecisionInfo = z.infer<typeof VaultDecisionInfo>;

export const VaultReportRow = z.object({
  secretId: z.string(),
  requester: VaultRequester,
  outcome: VaultOutcome,
  count: z.number().int(),
});
export type VaultReportRow = z.infer<typeof VaultReportRow>;

/** How a ssh destino authenticates: the host's agent, a key file, a vault key or a password. */
export const SshAuth = z.enum(["agent", "key-file", "vault-key", "password"]);
export type SshAuth = z.infer<typeof SshAuth>;

/** The short, fixed list of OpenSSH options a destino may set. */
export const SshOptions = z
  .object({
    serverAliveInterval: z.number().int().optional(),
    compression: z.boolean().optional(),
    /** `[bind:]port:host:port`, kept as text. */
    localForward: z.array(z.string()).optional(),
    /** Off by default; turning it on asks for `confirm`. */
    forwardAgent: z.boolean().optional(),
  })
  .strict();
export type SshOptions = z.infer<typeof SshOptions>;

/** A ssh destino: only a reference to its secret, never the secret. */
export const SshTarget = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  user: z.string(),
  /** The Flightdeck host that opens the connection; `null` is the local one. */
  viaHost: z.string().nullable(),
  auth: SshAuth,
  /** `key-file`: the path on the host; `vault-key` and `password`: the item of the vault. */
  secretRef: z.string().nullable(),
  /** The destino this one goes through (ProxyJump). */
  jump: z.string().nullable(),
  options: SshOptions,
  tags: z.array(z.string()),
  /** The fingerprint (SHA256) of the pinned server key; `null` before the first confirmation. */
  hostKey: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SshTarget = z.infer<typeof SshTarget>;

/** One name of `~/.ssh/config` the import would turn into a destino. */
export const SshImportEntry = z.object({
  alias: z.string(),
  host: z.string(),
  port: z.number().int(),
  user: z.string(),
  identityFile: z.string().nullable(),
  proxyJump: z.string().nullable(),
  /** A destino with this name, or with the same host, port and user, is already registered. */
  exists: z.boolean(),
});
export type SshImportEntry = z.infer<typeof SshImportEntry>;

export const SshImportResult = z.object({
  created: z.array(SshTarget),
  skipped: z.array(
    z.object({
      alias: z.string(),
      reason: z.string(),
      /** Why, as a key the app translates, with the values its sentence fills in. */
      why: z.string().optional(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
});
export type SshImportResult = z.infer<typeof SshImportResult>;

/**
 * What `ssh.hostkey.check` found: `unknown` (first connection: confirm the fingerprint),
 * `pinned` (the key is the one kept) or `changed` (blocked: `pinned` is the old fingerprint).
 */
export const SshHostKeyCheck = z.object({
  status: z.enum(["unknown", "pinned", "changed"]),
  /** The SHA256 fingerprint the server shows now. */
  fingerprint: z.string(),
  /** The fingerprint kept for this destino, `null` before the first confirmation. */
  pinned: z.string().nullable(),
});
export type SshHostKeyCheck = z.infer<typeof SshHostKeyCheck>;

/** The answer to `ssh.test`: reachable and logged in, or why not (in words, not the raw ssh error). */
export const SshTestResult = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  /** Why the test failed, as a key the app translates, with the values its sentence fills in. */
  reason: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type SshTestResult = z.infer<typeof SshTestResult>;

/** A password or key passphrase that ssh is asking for; the app answers with `askpass.answer`. */
export const AskpassRequest = z.object({
  type: z.literal("askpass.request"),
  requestId: z.string(),
  targetId: z.string(),
  targetName: z.string(),
  kind: z.enum(["password", "passphrase"]),
  /** Where the vault keeps it, to be read without asking the person. */
  secretRef: z.string().nullable(),
  /** What ssh printed, such as "deploy@host's password:". */
  prompt: z.string(),
});
export type AskpassRequest = z.infer<typeof AskpassRequest>;

/** The secrets commands; index.ts spreads them into `Command`. */
export const secretsCommands = [
  /** Phase 17: the actions of a project (and of the host) and their runs. */
  cmd("actions.list", z.object({ projectId: z.string().optional() })),
  /** `secretIds` is what the app has, so a reference to another secret is an error. */
  cmd(
    "actions.save",
    z.object({
      projectId: z.string().optional(),
      definition: z.record(z.string(), z.unknown()),
      secretIds: z.array(z.string()).optional(),
    }),
  ),
  cmd("actions.remove", z.object({ projectId: z.string().optional(), name: z.string().min(1) })),
  /** Versioned actions run only once trusted, by the hash `actions.list` shows. */
  cmd(
    "actions.trust",
    z.object({
      projectId: z.string().optional(),
      name: z.string().min(1),
      hash: z.string().min(1),
    }),
  ),
  cmd(
    "actions.run",
    z.object({
      projectId: z.string().optional(),
      name: z.string().min(1),
      params: z.record(z.string(), z.string()).optional(),
      requestedBy: VaultRequester,
      /** The Claude Code session asking; the once-per-session approvals hold for it. */
      session: z.string().min(1).optional(),
    }),
  ),
  /** A command written by Claude with secrets in its environment; the app always approves it. */
  cmd(
    "actions.runFree",
    z.object({
      command: z.string().min(1).max(4000),
      secrets: z.array(z.string().min(1)).min(1).max(8),
      host: z.string().optional(),
      requestedBy: VaultDaemonRequester,
      session: z.string().min(1).optional(),
    }),
  ),
  cmd(
    "actions.runs",
    z.object({
      projectId: z.string().optional(),
      name: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
  ),
  /** Receive the daemon's `vault.request` and `vault.used` frames (the app does). */
  cmd("vault.watch", z.object({}).strict()),
  /** The user refused a `vault.request`: the run that waits for it fails at once. */
  cmd("vault.deny", z.object({ requestId: z.string().min(1) })),
  /** Phase 19: the rules of one secret, replaced whole (the ones that break the ceiling are refused). */
  cmd(
    "vault.rules.set",
    z.object({
      secretId: z.string().min(1),
      tags: z.array(z.string().min(1)).max(16).optional(),
      rules: z.array(z.unknown()).max(200),
    }),
  ),
  cmd("vault.rules.get", z.object({ secretId: z.string().min(1) })),
  /** "What happens if…": the verdict for a use, without recording or spending anything. */
  cmd(
    "vault.rules.preview",
    z.object({
      secretId: z.string().min(1),
      requester: VaultRequester,
      purpose: z.enum(["ssh", "action", "run_with_secret"]),
      action: z.string().optional(),
      host: z.string().optional(),
      tags: z.array(z.string()).optional(),
      project: z.string().optional(),
      session: z.string().optional(),
      risk: z.enum(["low", "medium", "high"]).optional(),
      actionApproval: ActionApproval.optional(),
      at: z.number().optional(),
    }),
  ),
  /** The user approved a request that asked; `vault.deliver` for it only works after this. */
  cmd(
    "vault.approve",
    z.object({
      requestId: z.string().min(1),
      via: z.enum(["app", "tray"]),
      /** How long the Approve button was held, for the requests that need 2 s. */
      heldMs: z.number().int().min(0).optional(),
      scope: z.enum(["once", "session"]).optional(),
    }),
  ),
  cmd(
    "vault.decisions",
    z.object({
      secretId: z.string().min(1).optional(),
      days: z.number().int().min(1).max(365).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }),
  ),
  /** Uses by secret, requester and outcome; `csv` adds the same as a CSV text. */
  cmd(
    "vault.report",
    z.object({
      days: z.number().int().min(1).max(365).optional(),
      format: z.enum(["json", "csv"]).optional(),
    }),
  ),
  /**
   * Phase 16: the app hands the daemon a secret for one use. The daemon keeps it in memory only,
   * for at most 60 s (or until `expiresAt`, in milliseconds since the epoch), and only accepts it
   * from loopback or Tailscale.
   */
  cmd(
    "vault.deliver",
    z.object({
      secretId: z.string().min(1).max(200),
      value: z.string().min(1).max(65_536),
      purpose: z.string().min(1).max(100),
      expiresAt: z.number().int(),
      requester: VaultRequester.default("you"),
    }),
  ),
  /** Phase 16: runs a daemon action with a delivered secret, which is then discarded. */
  cmd(
    "vault.use",
    z.object({
      secretId: z.string().min(1).max(200),
      purpose: z.string().min(1).max(100),
      action: z.string().min(1).max(100),
    }),
  ),
  /**
   * Phase 30: posts a webhook for the app. The URL is a vault secret: it comes for this one use,
   * only over the vault's transport, and is never stored or logged.
   */
  cmd(
    "webhook.send",
    z
      .object({
        url: z.string().min(1).max(2048),
        headers: z.record(z.string(), z.string()),
        body: z.string().max(100_000),
      })
      .strict(),
  ),
  cmd("ssh.list", z.object({}).strict()),
  /** Creates (no `id`) or edits a destino; turning ForwardAgent on asks for `confirm`. */
  cmd(
    "ssh.save",
    z
      .object({
        id: z.string().optional(),
        name: z.string(),
        host: z.string(),
        port: z.number().int().optional(),
        user: z.string(),
        viaHost: z.string().nullable().optional(),
        auth: SshAuth.optional(),
        secretRef: z.string().nullable().optional(),
        jump: z.string().nullable().optional(),
        options: SshOptions.optional(),
        tags: z.array(z.string()).optional(),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd("ssh.remove", z.object({ id: z.string(), confirm: z.boolean() }).strict()),
  /** Reads the server key with ssh-keyscan and compares it with the one kept. */
  cmd("ssh.hostkey.check", z.object({ targetId: z.string() }).strict()),
  /** Keeps the key whose fingerprint `check` just showed; replacing one asks to forget it first. */
  cmd("ssh.hostkey.confirm", z.object({ targetId: z.string(), fingerprint: z.string() }).strict()),
  cmd("ssh.hostkey.forget", z.object({ targetId: z.string() }).strict()),
  /**
   * Opens a terminal running ssh to the destino. `privateKey` is the key from the vault, for
   * `vault-key` only; it is delivered for this connection and never stored or logged.
   */
  cmd(
    "ssh.connect",
    z
      .object({
        targetId: z.string(),
        cols: TerminalCols,
        rows: TerminalRows,
        privateKey: z.string().max(65_536).optional(),
      })
      .strict(),
  ),
  /** `ssh -o BatchMode=yes ... exit 0`: no terminal, the error translated. */
  cmd(
    "ssh.test",
    z.object({ targetId: z.string(), privateKey: z.string().max(65_536).optional() }).strict(),
  ),
  /** Follow `askpass.request` frames: the app that answers a ssh password prompt. */
  cmd("askpass.watch", z.object({}).strict()),
  /** What `flightdeckd askpass` calls with the ticket of its connection; returns the answer. */
  cmd("askpass.ask", z.object({ ticket: z.string(), prompt: z.string().max(500) }).strict()),
  /** The app answers a request; `null` refuses. */
  cmd(
    "askpass.answer",
    z.object({ requestId: z.string(), secret: z.string().max(4096).nullable() }).strict(),
  ),
  /** Reads this host's `~/.ssh/config` (never writes it) and says what would be created. */
  cmd("ssh.import.preview", z.object({}).strict()),
  /** Creates the chosen names; the ones it cannot create come back with the reason. */
  cmd("ssh.import.apply", z.object({ aliases: z.array(z.string()).max(500) }).strict()),
] as const;

/** The `data` of each secrets command's ack; `CommandResults` extends it. */
export interface SecretsResults {
  "actions.list": ActionList;
  "actions.save": ActionInfo;
  "actions.remove": ActionList;
  "actions.trust": ActionInfo;
  "actions.run": ActionResult;
  "actions.runFree": ActionResult;
  "actions.runs": { runs: ActionRunInfo[] };
  "vault.watch": undefined;
  "vault.deny": undefined;
  "vault.rules.set": { rules: number };
  "vault.rules.get": { secretId: string; tags: string[]; rules: unknown[] };
  "vault.rules.preview": VaultVerdict;
  "vault.approve": undefined;
  "vault.decisions": { decisions: VaultDecisionInfo[] };
  "vault.report": { rows: VaultReportRow[]; csv?: string };
  "vault.deliver": { expiresAt: number };
  "vault.use": { result: string };
  "webhook.send": WebhookSendResult;
  "ssh.list": { targets: SshTarget[] };
  "ssh.save": SshTarget;
  "ssh.remove": undefined;
  "askpass.watch": undefined;
  "askpass.ask": { secret: string };
  "askpass.answer": undefined;
  "ssh.connect": TerminalInfo;
  "ssh.test": SshTestResult;
  "ssh.hostkey.check": SshHostKeyCheck;
  "ssh.hostkey.confirm": SshTarget;
  "ssh.hostkey.forget": SshTarget;
  "ssh.import.preview": { entries: SshImportEntry[] };
  "ssh.import.apply": SshImportResult;
}
