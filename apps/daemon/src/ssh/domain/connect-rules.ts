import type { SshHostKeyCheck, SshTarget } from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";

/** Whether `target` may start a connection with this key and this askpass; throws the refusal if not. */
export function refuseAuth(
  target: SshTarget,
  privateKey: string | undefined,
  hasAskpass: boolean,
): void {
  if (target.auth === "vault-key" && !privateKey) {
    throw new FlightdeckError(
      "bad_request",
      "the vault key did not come with the request",
      "ssh_key_missing",
    );
  }
  if (target.auth !== "vault-key" && privateKey) {
    throw new FlightdeckError(
      "bad_request",
      "a vault key only applies to vault-key",
      "ssh_key_not_for_auth",
    );
  }
  if (target.auth === "password" && !hasAskpass) {
    throw new FlightdeckError(
      "invalid_state",
      "a password needs askpass, which is not available",
      "ssh_askpass_off",
    );
  }
}

/**
 * The target and the jumps in front of it, the outermost jump first and the target last, and the
 * jumps alone (`hops`). A jump can only use agent or a key file.
 */
export function jumpChain(
  target: SshTarget,
  get: (id: string) => SshTarget | null,
): { members: SshTarget[]; hops: SshTarget[] } {
  const members: SshTarget[] = [];
  for (let at: SshTarget | null = target; at; at = at.jump ? get(at.jump) : null) {
    members.unshift(at);
  }
  const hops = members.slice(0, -1);
  for (const hop of hops) {
    if (hop.auth === "vault-key" || hop.auth === "password") {
      throw new FlightdeckError(
        "invalid_state",
        `jump ${hop.name} uses ${hop.auth}: a jump can only use agent or a key file`,
        "ssh_jump_auth",
        { name: hop.name, auth: hop.auth },
      );
    }
  }
  return { members, hops };
}

/** The destino an `ssh:` action names: `found` is the one with that name, `named` how many have it. */
export function execTarget(name: string, found: SshTarget | null, named: number): SshTarget {
  if (!found && named === 0) {
    throw new FlightdeckError("not_found", `destination ${name} not found`, "ssh_target_unknown", {
      name,
    });
  }
  if (!found) {
    throw new FlightdeckError(
      "invalid_state",
      `more than one destination is named ${name}`,
      "ssh_target_ambiguous",
      { name },
    );
  }
  if (found.auth === "password") {
    throw new FlightdeckError(
      "invalid_state",
      `${found.name} uses a password: an ssh action runs with nobody to type it`,
      "ssh_password_in_action",
      { name: found.name },
    );
  }
  return found;
}

/** Throws unless the server's key is the pinned one. */
export function refuseHostKey(member: SshTarget, check: SshHostKeyCheck): void {
  if (check.status === "unknown") {
    throw new FlightdeckError(
      "hostkey_unconfirmed",
      `${member.name}: confirm the fingerprint ${check.fingerprint} before connecting`,
      "ssh_hostkey_unconfirmed",
      { name: member.name, fingerprint: check.fingerprint },
    );
  }
  if (check.status === "changed") {
    throw new FlightdeckError(
      "hostkey_changed",
      `${member.name}: the server key changed (pinned ${check.pinned}, now ${check.fingerprint})`,
      "ssh_hostkey_changed",
      { name: member.name, pinned: check.pinned ?? "", fingerprint: check.fingerprint },
    );
  }
}
