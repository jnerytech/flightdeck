import { FlightdeckError } from "../../kernel/index.ts";
import type { ActionDef } from "./schema.ts";

/** The name a free command is recorded under. */
export const FREE = "run_with_secret";
const SECRET_ID = /^[A-Za-z0-9._-]+$/;

/** The secret names of a free command without repeats; one that is not a valid name is refused. */
export function freeSecretIds(secrets: string[]): string[] {
  const ids = [...new Set(secrets)];
  for (const id of ids)
    if (!SECRET_ID.test(id)) {
      throw new FlightdeckError(
        "bad_request",
        `invalid secret name: ${id}`,
        "action_secret_name_invalid",
        { secret: id },
      );
    }
  return ids;
}

/** `deploy-token` → `DEPLOY_TOKEN`. */
function envName(secretId: string): string {
  const name = secretId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return /^\d/.test(name) ? `_${name}` : name;
}

/** Another host is a phase 15 destino of that name: the command runs there with sh -c. */
export function freeRemote(host: string | undefined, sshAvailable: boolean): string | null {
  const remote = host !== undefined && host !== "local" ? host : null;
  if (remote && !sshAvailable) {
    throw new FlightdeckError(
      "invalid_state",
      `host ${remote} is an ssh destination, and this daemon runs no commands on destinations`,
      "action_ssh_host_unsupported",
      { host: remote },
    );
  }
  return remote;
}

/**
 * The action a free command runs as: the command line (`argv`, or `sh -c` when there is none), the
 * secrets in its environment under their `envName`, never automatic.
 */
export function freeAction(input: {
  command: string;
  ids: string[];
  argv: string[] | null;
  remote: string | null;
}): ActionDef {
  return {
    name: FREE,
    description: "free command with secrets in the environment",
    run: input.argv ?? ["sh", "-c", input.command],
    env: Object.fromEntries(input.ids.map((id) => [envName(id), `{{secret.${id}}}`])),
    params: {},
    timeoutS: 120,
    approval: "always",
    ...(input.remote ? { ssh: input.remote } : {}),
  };
}
