import type { ServiceContext } from "./service.ts";

/** Whether `loginctl` says the user's systemd survives logout: the daemon starts at boot only if it does. */
export async function lingerState(
  ctx: Pick<ServiceContext, "platform" | "user" | "exec">,
): Promise<"on" | "off" | null> {
  if (ctx.platform !== "linux") return null;
  const { code, stdout } = await ctx.exec(["loginctl", "show-user", ctx.user, "-p", "Linger"]);
  if (code !== 0) return null;
  const value = stdout.trim();
  if (value === "Linger=yes") return "on";
  return value === "Linger=no" ? "off" : null;
}
