import type { SshTarget } from "@flightdeck/protocol";

/** The tags that mark production: the protocol's one rule, the daemon's too. */
export { isProd } from "@flightdeck/protocol";

/** The payload of `ssh.save` for a destino, whether it comes from the form or from a duplicate. */
export function savePayload(target: SshTarget, name: string) {
  return {
    name,
    host: target.host,
    port: target.port,
    user: target.user,
    viaHost: target.viaHost,
    auth: target.auth,
    secretRef: target.secretRef,
    jump: target.jump,
    options: target.options,
    tags: target.tags,
    ...(target.options.forwardAgent ? { confirm: true } : {}),
  };
}
