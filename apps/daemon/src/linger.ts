import type { ServiceContext } from "./service.ts";

/** Whether `loginctl` says the user's systemd survives logout: the daemon starts at boot only if it does. */
export async function lingerState(
  _ctx: Pick<ServiceContext, "platform" | "user" | "exec">,
): Promise<"on" | "off" | null> {
  return null;
}
