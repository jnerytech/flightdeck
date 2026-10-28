import { describe, expect, test } from "bun:test";
import { installService, type ServiceContext, systemdUnit } from "../src/service.ts";

function linux(linger: { code: number; stdout: string }, failOn?: string) {
  const calls: string[][] = [];
  const files = new Map<string, string>();
  const ctx: ServiceContext = {
    platform: "linux",
    home: "/home/dev",
    user: "dev",
    command: ["/home/dev/.local/bin/flightdeckd"],
    systemRoot: "",
    tempDir: "/tmp",
    dryRun: false,
    exec: async (cmd) => {
      calls.push(cmd);
      if (failOn && cmd.join(" ").includes(failOn)) return { code: 1, stdout: "" };
      return cmd[0] === "loginctl" ? linger : { code: 0, stdout: "" };
    },
    writeFile: (path, content) => {
      files.set(path, content);
    },
    removeFile: () => {},
    which: () => null,
  };
  return { ctx, calls, files };
}

describe("linger", () => {
  test("sem linger, devolve a instrução com sudo e não executa nada com sudo", async () => {
    const { ctx, calls, files } = linux({ code: 0, stdout: "Linger=no\n" });
    const result = await installService(ctx);
    expect(result.instructions).toEqual([
      "O linger está desligado: o serviço só sobe depois do seu login. Para iniciar no boot, rode:",
      "  sudo loginctl enable-linger dev",
    ]);
    expect(calls.some((c) => c.includes("sudo"))).toBe(false);
    expect(calls).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "flightdeckd"],
      ["loginctl", "show-user", "dev", "-p", "Linger"],
    ]);
    expect(files.get("/home/dev/.config/systemd/user/flightdeckd.service")).toBe(
      systemdUnit(["/home/dev/.local/bin/flightdeckd"]),
    );
  });

  test("com linger ligado não há instrução", async () => {
    const { ctx } = linux({ code: 0, stdout: "Linger=yes\n" });
    expect((await installService(ctx)).instructions).toEqual([]);
  });

  test("se não der para consultar o linger, a instrução aparece mesmo assim", async () => {
    const { ctx } = linux({ code: 1, stdout: "" });
    expect((await installService(ctx)).instructions[1]).toBe("  sudo loginctl enable-linger dev");
  });

  test("falha do systemctl interrompe a instalação com o comando na mensagem", async () => {
    const { ctx, calls } = linux({ code: 0, stdout: "Linger=yes" }, "enable");
    await expect(installService(ctx)).rejects.toThrow("systemctl --user enable --now flightdeckd");
    expect(calls.at(-1)).toEqual(["systemctl", "--user", "enable", "--now", "flightdeckd"]);
  });
});
