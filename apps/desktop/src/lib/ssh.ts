import type { SshTarget } from "@flightdeck/protocol";

/** The tags that mark a ssh destino as production, whatever their case. */
const PROD_TAGS: ReadonlySet<string> = new Set(["prod", "produ\u00e7\u00e3o", "producao"]);

export const isProd = (tags: readonly string[]): boolean =>
  tags.some((tag) => PROD_TAGS.has(tag.toLowerCase()));

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
