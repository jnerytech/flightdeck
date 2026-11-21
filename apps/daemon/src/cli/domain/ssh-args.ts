/**
 * Issue #3537: `flightdeckd ssh <verb>`, the ssh destinations of a host. The parser in `args.ts` reads
 * the words after `ssh` here; the flags are checked there, with the usage text.
 */

import type { SshCliArgs, SshSaveFields } from "../../ssh/index.ts";
import { type ArgReader, FLAGS, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { USAGE } from "./usage.ts";
import { oneOf } from "./vault-args.ts";

const SSH_ACTIONS = ["list", "import", "hostkey", "test", "remove", "add", "edit"] as const;
const SSH_AUTHS = ["agent", "key-file", "vault-key", "password"] as const;
/** The daemon takes at most this many names in one `ssh.import.apply`. */
const MAX_ALIASES = 500;

/** `ssh list`, `ssh import preview`, `ssh hostkey check|confirm|forget <target>` or `ssh test <target>` (a name or an id). */
export function readSsh(args: CliArgs, reader: ArgReader): void {
  args.command = "ssh";
  const verb = subAction(reader, SSH_ACTIONS, "invalid ssh action");
  if (verb === "import") {
    const action = subAction(reader, ["preview", "apply"] as const, "invalid ssh import action");
    args.action = `import-${action}`;
    return;
  }
  if (verb === "hostkey") {
    const action = subAction(
      reader,
      ["check", "confirm", "forget"] as const,
      "invalid ssh hostkey action",
    );
    args.action = `hostkey-${action}`;
    args.sshTarget = operand(reader, "the ssh target");
    return;
  }
  args.action = verb;
  if (verb !== "list") args.sshTarget = operand(reader, "the ssh target");
}

/** `ssh add|edit` flags, in the order a refusal names them: the field each sets, and the flag as it is typed. */
const SAVE_FLAGS: Array<[keyof SshSaveFields, string]> = [
  ["address", "--address"],
  ["user", "--user"],
  ["port", "--port"],
  ["auth", "--auth"],
  ["secretRef", "--secret-ref"],
  ["jump", "--jump"],
  ["noJump", "--no-jump"],
  ["forwardAgent", "--forward-agent"],
  ["noForwardAgent", "--no-forward-agent"],
];

/** A flag that sets one field of `ssh add|edit`. */
const saves =
  (set: (fields: SshSaveFields, value: string) => void) =>
  (args: CliArgs, _reader: unknown, value: () => string) => {
    args.sshSave ??= {};
    set(args.sshSave, value());
  };

/** A flag of `ssh add|edit` that takes no value, so `--no-jump=false` is refused like any other (#3425). */
const saveSwitch = (set: (fields: SshSaveFields) => void) => {
  const handler = (args: CliArgs) => {
    args.sshSave ??= {};
    set(args.sshSave);
  };
  FLAGS.add(handler);
  return handler;
};

/** The flags of the ssh verbs that take one, for the parser's table of flags. */
export const SSH_FLAGS: Record<
  string,
  (args: CliArgs, reader: unknown, value: () => string) => void
> = {
  "--fingerprint": (args, _reader, value) => {
    args.sshFingerprint = value();
  },
  "--alias": (args, _reader, value) => {
    args.sshAliases = [...(args.sshAliases ?? []), value()];
  },
  "--address": saves((f, v) => {
    f.address = v;
  }),
  "--user": saves((f, v) => {
    f.user = v;
  }),
  "--port": saves((f, v) => {
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 65_535)
      throw new Error(`--port: a whole number from 1 to 65535, got ${v}\n${USAGE}`);
    f.port = Number(v);
  }),
  "--auth": saves((f, v) => {
    f.auth = oneOf("--auth", v, SSH_AUTHS);
  }),
  "--secret-ref": saves((f, v) => {
    f.secretRef = v;
  }),
  "--jump": saves((f, v) => {
    f.jump = v;
  }),
  "--no-jump": saveSwitch((f) => {
    f.noJump = true;
  }),
  "--forward-agent": saveSwitch((f) => {
    f.forwardAgent = true;
  }),
  "--no-forward-agent": saveSwitch((f) => {
    f.noForwardAgent = true;
  }),
};

/** What is wrong with the ssh flags, or undefined: each flag belongs to one verb, and that verb needs it. */
export function sshProblem(args: CliArgs): string | undefined {
  const ssh = args.command === "ssh";
  const confirming = ssh && args.action === "hostkey-confirm";
  if (args.sshFingerprint !== undefined && !confirming)
    return "--fingerprint: this flag only applies to flightdeckd ssh hostkey confirm";
  const applying = ssh && args.action === "import-apply";
  if (args.sshAliases !== undefined && !applying)
    return "--alias: this flag only applies to flightdeckd ssh import apply";
  const removing = ssh && args.action === "remove";
  const saving = ssh && (args.action === "add" || args.action === "edit");
  if (ssh && args.confirm !== undefined && !removing && !saving)
    return "--confirm: this flag only applies to flightdeckd ssh remove, add or edit";
  if (removing && args.confirm === undefined)
    return "ssh remove deletes the destination: pass --confirm";
  const saveFault = saveProblem(args, saving);
  if (saveFault !== undefined) return saveFault;
  if (applying) return aliasProblem(args);
  return confirming ? fingerprintProblem(args) : undefined;
}

/** What is wrong with the `--alias` list of `ssh import apply`. */
function aliasProblem(args: CliArgs): string | undefined {
  const count = args.sshAliases?.length ?? 0;
  if (count === 0) return "ssh import apply needs at least one --alias <name from ~/.ssh/config>";
  if (count > MAX_ALIASES) return `ssh import apply takes at most ${MAX_ALIASES} --alias`;
  return undefined;
}

/** What is wrong with the `--fingerprint` of `ssh hostkey confirm`. */
function fingerprintProblem(args: CliArgs): string | undefined {
  if (args.sshFingerprint === undefined) return "missing --fingerprint";
  if (!/^SHA256:\S+$/.test(args.sshFingerprint))
    return `--fingerprint: a SHA256 fingerprint, like SHA256:abc..., got ${args.sshFingerprint}`;
  return undefined;
}

/** What `ssh add` cannot do without and `ssh edit` must not be given, or the nothing `ssh edit` was asked to change. */
function saveRequiredProblem(args: CliArgs, adding: boolean): string | undefined {
  const fields = args.sshSave;
  if (!adding) {
    return fields === undefined
      ? `ssh edit needs at least one of ${SAVE_FLAGS.map(([, flag]) => flag).join(", ")}`
      : undefined;
  }
  if (fields?.address === undefined) return "ssh add needs --address <host>";
  if (fields.user === undefined) return "ssh add needs --user <name>";
  if (fields.noJump) return "--no-jump: this flag only applies to flightdeckd ssh edit";
  if (fields.noForwardAgent)
    return "--no-forward-agent: this flag only applies to flightdeckd ssh edit";
  return undefined;
}

/** The flags of `ssh add|edit` that cannot go together, or need `--confirm`. */
function saveCombinationProblem(args: CliArgs, adding: boolean): string | undefined {
  const fields = args.sshSave;
  if (
    fields?.secretRef !== undefined &&
    (fields.auth ?? (adding ? "agent" : undefined)) === "agent"
  )
    return "--secret-ref: the agent has no key reference: pass --auth key-file, vault-key or password";
  if (fields?.jump !== undefined && fields.noJump) return "--jump and --no-jump cannot go together";
  if (fields?.forwardAgent && fields.noForwardAgent)
    return "--forward-agent and --no-forward-agent cannot go together";
  if (fields?.forwardAgent && args.confirm === undefined)
    return "--forward-agent hands your agent to the remote host: pass --confirm";
  return undefined;
}

/** What is wrong with the flags of `ssh add|edit`, or with one of them given to another verb. */
function saveProblem(args: CliArgs, saving: boolean): string | undefined {
  if (!saving) {
    const [, flag] = SAVE_FLAGS.find(([field]) => args.sshSave?.[field] !== undefined) ?? [];
    return flag === undefined
      ? undefined
      : `${flag}: this flag only applies to flightdeckd ssh add and ssh edit`;
  }
  const adding = args.action === "add";
  return saveRequiredProblem(args, adding) ?? saveCombinationProblem(args, adding);
}

/** What the ssh runner takes from the parsed arguments: each field only when the person gave it. */
export function sshCliArgs(args: CliArgs): SshCliArgs {
  return {
    action: args.action as SshCliArgs["action"],
    ...(args.sshTarget === undefined ? {} : { target: args.sshTarget }),
    ...(args.sshFingerprint === undefined ? {} : { fingerprint: args.sshFingerprint }),
    ...(args.sshAliases === undefined ? {} : { aliases: args.sshAliases }),
    ...(args.sshSave === undefined ? {} : { save: args.sshSave }),
    ...(args.confirm ? { confirm: true } : {}),
    ...(args.json ? { json: true } : {}),
  };
}
