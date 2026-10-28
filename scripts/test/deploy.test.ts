import { describe, expect, test } from "bun:test";
import { deployPlan, parseDeployHosts, runDeploy } from "../lib/deploy.ts";

const HOSTS = JSON.stringify({
  pi: { ssh: "ubuntu@orange", target: "linux-arm64", path: "~/.local/bin/flightdeckd" },
  vps: { ssh: "root@vps", target: "linux-x64", path: "/opt/flightdeck/flightdeckd" },
});

describe("deploy", () => {
  test("lê deploy.hosts.json e recusa alvo ou caminho inválido", () => {
    expect(parseDeployHosts(HOSTS).pi).toEqual({
      ssh: "ubuntu@orange",
      target: "linux-arm64",
      path: "~/.local/bin/flightdeckd",
    });
    expect(() =>
      parseDeployHosts(JSON.stringify({ x: { ssh: "a@b", target: "mac", path: "/x" } })),
    ).toThrow();
    expect(() =>
      parseDeployHosts(
        JSON.stringify({ x: { ssh: "a@b", target: "linux-x64", path: "/x; rm -rf /" } }),
      ),
    ).toThrow();
  });

  test("plano: compila o alvo, copia para .new, troca, reinicia e confere", () => {
    expect(deployPlan(parseDeployHosts(HOSTS).pi as never, "/repo")).toEqual([
      [
        "bun",
        "build",
        "/repo/apps/daemon/src/bin.ts",
        "--compile",
        "--target=bun-linux-arm64",
        "--outfile",
        "/repo/dist/flightdeckd-linux-arm64",
      ],
      ["scp", "/repo/dist/flightdeckd-linux-arm64", "ubuntu@orange:~/.local/bin/flightdeckd.new"],
      [
        "ssh",
        "ubuntu@orange",
        "chmod +x ~/.local/bin/flightdeckd.new && mv ~/.local/bin/flightdeckd.new ~/.local/bin/flightdeckd && systemctl --user restart flightdeckd",
      ],
      ["ssh", "ubuntu@orange", "systemctl --user is-active flightdeckd"],
    ]);
  });

  test("runDeploy executa o plano em ordem e termina conferindo is-active", async () => {
    const calls: string[][] = [];
    const out: string[] = [];
    const code = await runDeploy("vps", {
      root: "/repo",
      readHosts: () => HOSTS,
      exec: async (cmd) => {
        calls.push(cmd);
        return { code: 0, stdout: cmd.join(" ").includes("is-active") ? "active\n" : "" };
      },
      log: (m) => out.push(m),
    });
    expect(code).toBe(0);
    expect(calls.map((c) => c[0])).toEqual(["bun", "scp", "ssh", "ssh"]);
    expect(out.at(-1)).toBe("deploy de vps concluído: flightdeckd active");
  });

  test("falha em um passo interrompe; serviço inativo, alias desconhecido e arquivo ausente saem com 1", async () => {
    const deps = (fail: (cmd: string[]) => boolean, stdout = "active\n") => {
      const calls: string[][] = [];
      const out: string[] = [];
      return {
        calls,
        out,
        deps: {
          root: "/repo",
          readHosts: () => HOSTS,
          exec: async (cmd: string[]) => {
            calls.push(cmd);
            return { code: fail(cmd) ? 1 : 0, stdout };
          },
          log: (m: string) => out.push(m),
        },
      };
    };
    const scpFails = deps((c) => c[0] === "scp");
    expect(await runDeploy("pi", scpFails.deps)).toBe(1);
    expect(scpFails.calls).toHaveLength(2);
    expect(scpFails.out.at(-1)).toContain("falhou: scp");

    const inactive = deps(() => false, "failed\n");
    expect(await runDeploy("pi", inactive.deps)).toBe(1);
    expect(inactive.out.at(-1)).toBe("flightdeckd não está ativo em pi: failed");

    const unknown = deps(() => false);
    expect(await runDeploy("nada", unknown.deps)).toBe(1);
    expect(unknown.out.at(-1)).toBe("alias desconhecido: nada (disponíveis: pi, vps)");

    const missing = deps(() => false);
    missing.deps.readHosts = () => {
      throw new Error("ENOENT");
    };
    expect(await runDeploy("pi", missing.deps)).toBe(1);
    expect(missing.out.at(-1)).toContain("deploy.hosts.json");
  });
});
