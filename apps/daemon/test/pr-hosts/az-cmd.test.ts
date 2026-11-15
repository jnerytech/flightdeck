import { afterEach, describe, expect, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { GithubCli } from "../../src/github/index.ts";
import { AzureIssues } from "../../src/issues/providers.ts";
import { AZ_CUT_NOTE, sanitizeAzArgs } from "../../src/pr/domain/az-text.ts";
import { AzureDevOpsCli } from "../../src/pr-hosts/pr.ts";
import { tempDir } from "../support/helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function fake(name: string, rules: FakeRule[]): FakeCli {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
}

const AZ_WEB = "https://dev.azure.com/acme/proj/_git/repo";
const argAfter = (call: string[] | undefined, flag: string) =>
  call?.[(call?.indexOf(flag) ?? -2) + 1];

describe("az-cmd", () => {
  test("PR do Azure DevOps: título e descrição com quebras e caracteres especiais chegam limpos ao az", async () => {
    const az = fake("az", [
      { args: ["pr", "list"], stdout: "[]" },
      {
        args: ["pr", "create"],
        stdout: JSON.stringify({ pullRequestId: 5, repository: { webUrl: AZ_WEB } }),
      },
    ]);
    const cwd = tempDir();
    const description = 'Corrigir "login"\n\nVer <detalhes> & testar | 100%';
    const url = await new AzureDevOpsCli()
      .create({ cwd, base: "main", head: "fd/x", title: "Título\ncom quebra", body: description })
      .catch((error: Error) => error.message);
    expect(url).toBe(`${AZ_WEB}/pullrequest/5`);
    const call = az.calls().find((c) => c.includes("create"));
    expect(argAfter(call, "--title")).toBe("Título — com quebra");
    expect(argAfter(call, "--description")).toBe(
      "Corrigir 'login' — Ver (detalhes) e testar / 100",
    );
  });

  test("PR do Azure DevOps: título acima de 200 e descrição acima de 400 são cortados com a nota", async () => {
    const az = fake("az", [
      { args: ["pr", "list"], stdout: "[]" },
      {
        args: ["pr", "create"],
        stdout: JSON.stringify({ pullRequestId: 6, repository: { webUrl: AZ_WEB } }),
      },
    ]);
    await new AzureDevOpsCli()
      .create({
        cwd: tempDir(),
        base: "main",
        head: "fd/y",
        title: "T".repeat(300),
        body: "D".repeat(900),
      })
      .catch(() => "");
    const call = az.calls().find((c) => c.includes("create"));
    expect(argAfter(call, "--title")).toHaveLength(200);
    expect(argAfter(call, "--description")).toHaveLength(400);
    expect(argAfter(call, "--description")?.endsWith(AZ_CUT_NOTE)).toBe(true);
  });

  test("PR do Azure DevOps: texto de terceiros não faz o az ler arquivo local", async () => {
    const az = fake("az", [
      { args: ["pr", "list"], stdout: "[]" },
      {
        args: ["pr", "create"],
        stdout: JSON.stringify({ pullRequestId: 7, repository: { webUrl: AZ_WEB } }),
      },
    ]);
    const url = await new AzureDevOpsCli()
      .create({
        cwd: tempDir(),
        base: "main",
        head: "fd/z",
        title: "@C:/Users/dev/.ssh/id_rsa",
        body: "ver x=@/etc/passwd",
      })
      .catch((error: Error) => error.message);
    expect(url).toBe(`${AZ_WEB}/pullrequest/7`);
    const call = az.calls().find((c) => c.includes("create")) ?? [];
    expect(call.length).toBeGreaterThan(0);
    expect(call.some((arg) => arg.startsWith("@") || /^[^=]*=@/.test(arg))).toBe(false);
  });

  test("Azure Boards: o comentário na issue e a WIQL chegam limpos; WIQL com < > é recusada com erro claro", async () => {
    const az = fake("az", [
      { args: ["work-item", "update"], stdout: "{}" },
      { args: ["boards", "query"], stdout: "[]" },
      { args: ["account", "show"], stdout: "eu@acme.com\n" },
    ]);
    const issues = new AzureIssues({ org: "acme", project: "proj" });
    const cwd = tempDir();
    await issues
      .comment(cwd, "12", "PR aberto: https://x.example/pr/1\nveja <aqui>")
      .catch(() => "");
    expect(
      argAfter(
        az.calls().find((c) => c.includes("update")),
        "--discussion",
      ),
    ).toBe("PR aberto: https://x.example/pr/1 — veja (aqui)");
    await issues.list(cwd, "SELECT [System.Id]\nFROM WorkItems").catch(() => "");
    expect(
      argAfter(
        az.calls().find((c) => c.includes("query")),
        "--wiql",
      ),
    ).toBe("SELECT [System.Id] FROM WorkItems");
    const refused = await issues
      .list(cwd, "SELECT [System.Id] FROM WorkItems WHERE [System.State] <> 'Closed'")
      .then(
        () => "aceitou",
        (error: { code?: string }) => error.code,
      );
    expect(refused).toBe("invalid_state");
  });

  test("identificadores nunca são limpos: organização, projeto, id e branch seguem como são", async () => {
    const ids = [
      "--org",
      "https://dev.azure.com/Acme & Co",
      "--project",
      "R&D 100% | x",
      "--id",
      "12",
    ];
    expect(
      sanitizeAzArgs(["boards", "work-item", "show", ...ids, "--source-branch", "fd/a-b"]),
    ).toEqual(["boards", "work-item", "show", ...ids, "--source-branch", "fd/a-b"]);
    // A project with a space reaches az whole, not squeezed or changed.
    const az = fake("az", [
      {
        args: ["work-item", "show"],
        stdout: JSON.stringify({ id: 1, fields: { "System.Title": "t" } }),
      },
      { args: ["account", "show"], stdout: "eu@acme.com\n" },
    ]);
    await new AzureIssues({ org: "acme", project: "Meu Projeto" }).get(tempDir(), "1");
    const call = az.calls().find((c) => c.includes("show") && c.includes("work-item"));
    expect(argAfter(call, "--project")).toBe("Meu Projeto");
    // The .cmd cannot take an & in a name: refusing says so, where changing it would pick the wrong project.
    const refused = await new AzureIssues({ org: "acme", project: "R&D" }).get(tempDir(), "1").then(
      () => "aceitou",
      (error: { code?: string }) => error.code,
    );
    expect(refused).toBe("invalid_state");
    expect(az.calls().some((c) => c.includes("R&D") || c.includes("ReD"))).toBe(false);
  });

  test("o gh continua com o texto completo, sem corte nem troca", async () => {
    const gh = fake("gh", [
      { args: ["view", "url"], code: 1 },
      { args: ["pr", "create"], stdout: "https://github.com/acme/app/pull/1\n" },
    ]);
    const body = `Descrição longa com acentos é ç — ${"x".repeat(900)}`;
    await new GithubCli().create({
      cwd: tempDir(),
      base: "main",
      head: "fd/x",
      title: "T".repeat(300),
      body,
    });
    const call = gh.calls().find((c) => c.includes("create"));
    expect(argAfter(call, "--body")).toBe(body);
    expect(argAfter(call, "--title")).toBe("T".repeat(300));
  });
});
