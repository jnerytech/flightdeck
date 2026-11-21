/**
 * Issue #3537: what `flightdeckd ssh add|edit` send to `ssh.save`, as pure rules over the flags and the
 * destination the daemon already has. `ssh.save` with an `id` replaces the whole destination, so an edit
 * sends every field back, with only the flags the person typed changed.
 */
import type { CommandPayload, SshAuth, SshTarget } from "@flightdeck/protocol";

export type SshSavePayload = CommandPayload<"ssh.save">;

/** The flags of `ssh add` and `ssh edit`, each present only when the person typed it. */
export interface SshSaveFields {
  address?: string;
  user?: string;
  port?: number;
  auth?: SshAuth;
  /** The key file's path or the vault item, as the daemon reads it for the auth. */
  secretRef?: string;
  /** The destination this one goes through, its name or its id. */
  jump?: string;
  noJump?: boolean;
  forwardAgent?: boolean;
  noForwardAgent?: boolean;
}

/** A new destination: the fields the person typed and nothing else, so the daemon's defaults apply. */
export function addPayload(
  name: string,
  fields: SshSaveFields,
  jumpId: string | undefined,
  confirm: boolean,
): SshSavePayload {
  return {
    name,
    host: fields.address ?? "",
    user: fields.user ?? "",
    ...(fields.port === undefined ? {} : { port: fields.port }),
    ...(fields.auth === undefined ? {} : { auth: fields.auth }),
    ...(fields.secretRef === undefined ? {} : { secretRef: fields.secretRef }),
    ...(jumpId === undefined ? {} : { jump: jumpId }),
    ...(fields.forwardAgent ? { options: { forwardAgent: true } } : {}),
    ...(confirm ? { confirm: true } : {}),
  };
}

/** `--no-forward-agent` turns it off, `--forward-agent` on, and neither keeps what the destination has. */
function forwardAgentOf(fields: SshSaveFields, current: boolean | undefined): boolean | undefined {
  if (fields.noForwardAgent) return false;
  if (fields.forwardAgent) return true;
  return current;
}

/**
 * An existing destination with the typed fields changed. A new auth drops the old reference unless one is
 * typed with it (a vault item is no key path), and `agent` has none; the daemon refuses a key file or a
 * vault key left with no reference. `jumpId` is `null` for `--no-jump`, and `undefined` to keep the jump.
 */
export function editPayload(
  existing: SshTarget,
  fields: SshSaveFields,
  jumpId: string | null | undefined,
  confirm: boolean,
): SshSavePayload {
  const auth = fields.auth ?? existing.auth;
  const authChanged = fields.auth !== undefined && fields.auth !== existing.auth;
  const keptRef = authChanged ? null : existing.secretRef;
  const secretRef = auth === "agent" ? null : (fields.secretRef ?? keptRef);
  const forwardAgent = forwardAgentOf(fields, existing.options.forwardAgent);
  return {
    id: existing.id,
    name: existing.name,
    host: fields.address ?? existing.host,
    port: fields.port ?? existing.port,
    user: fields.user ?? existing.user,
    viaHost: existing.viaHost,
    auth,
    secretRef,
    jump: jumpId === undefined ? existing.jump : jumpId,
    options: { ...existing.options, ...(forwardAgent === undefined ? {} : { forwardAgent }) },
    tags: existing.tags,
    ...(confirm ? { confirm: true } : {}),
  };
}

export const addedLine = (name: string, id: string) => `${name}: added as ${id}`;

/** The edit's line; the daemon drops a pinned key when the address or port changes, and the person must know. */
export function updatedLine(before: SshTarget, after: SshTarget): string {
  if (before.hostKey !== null && after.hostKey === null) {
    return `${after.name}: updated, its pinned host key was cleared: run flightdeckd ssh hostkey check ${after.name}`;
  }
  return `${after.name}: updated`;
}
