/**
 * `--host <name>` (issue #3429): the name becomes a host to ask, with its address judged and its token
 * in a closure, or a refusal with a stable reason. Exit codes: 1 refused (unknown name, no store, an
 * address that may not carry the token).
 */
import { type CliResult, failure, type RemoteTarget } from "../daemon-client/index.ts";
import type { Exec } from "../kernel/index.ts";
import { locateHelper, readCredential } from "./credential-helper.ts";
import { helperCandidates, hostIndexPath, type PathsEnv } from "./domain/paths.ts";
import { pickHost, remoteAddressRefusal } from "./domain/rules.ts";
import { readHostIndex } from "./host-index.ts";

export interface ResolveDeps {
  env: PathsEnv;
  /** The user running the CLI; null where the system has no user id (Windows). */
  uid: number | null;
  /** Runs the credential helper. */
  exec: Exec;
}

export type Resolved = { ok: true; target: RemoteTarget } | { ok: false; result: CliResult };

const refuse = (message: string, reason: string): Resolved => ({
  ok: false,
  result: failure(1, message, reason),
});

/**
 * The host called `name` in the index the app writes, with the address and the token its credential
 * store holds. Every message is a fixed text plus the name; none carries the token or the helper's output.
 */
export async function resolveHost(name: string, deps: ResolveDeps): Promise<Resolved> {
  const noStore = () => refuse("no credential store: pair from the app", "no_store");
  const hosts = await readHostIndex(hostIndexPath(deps.env), deps.uid);
  if (!hosts) return noStore();
  const pick = pickHost(hosts, name);
  if (!pick.ok) {
    const known = pick.names.length > 0 ? pick.names.join(", ") : "none";
    const what =
      pick.reason === "ambiguous_host" ? "more than one host is named" : "no host is named";
    return refuse(`${what} "${name}"; known hosts: ${known}`, pick.reason);
  }
  const helper = await locateHelper(helperCandidates(deps.env), {
    platform: deps.env.platform,
    uid: deps.uid,
  });
  const credential = helper ? await readCredential(deps.exec, helper, pick.id) : null;
  if (!credential) return noStore();
  const refusal = remoteAddressRefusal(credential.url);
  if (refusal === "cleartext_remote")
    return refuse(
      `refusing to send the token of "${name}" over a plain ws:// address outside a private network: pair it again with a wss:// address`,
      refusal,
    );
  if (refusal) return refuse(`the address stored for "${name}" is not a daemon address`, refusal);
  return {
    ok: true, // The parsed address is the one that was judged above, and the one dialled.
    target: { name, url: new URL(credential.url).href, token: credential.token },
  };
}
