import { afterEach, describe, expect, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import {
  AZ_CUT_NOTE,
  AZ_TEXT_FLAGS,
  azText,
  mapSpawnError,
  sanitizeAzArgs,
} from "../src/board/az-text.ts";
import { AzureDevOpsCli, GithubCli } from "../src/board/pr.ts";
import { AzureIssues } from "../src/issues/providers.ts";
import { tempDir } from "./helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function fake(name: string, rules: FakeRule[]): FakeCli {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
}

/** What the Windows .cmd shim refuses: a newline and these characters. */
const REFUSED = /[\r\n<>&|^"%]/;
const NASTY = [
  "linha 1\nlinha 2\r\nlinha 3",
  'diz "oi" <b>negrito</b> & mais | pipe ^ acento 100%',
  "texto\n\n\nem várias linhas  com   espaços\t\te tabs",
  "<script>alert(1)</script>",
  "a%PATH%b",
];
const AZ_WEB = "https://dev.azure.com/acme/proj/_git/repo";
const argAfter = (call: string[] | undefined, flag: string) =>
  call?.[(call?.indexOf(flag) ?? -2) + 1];

describe("az-cmd", () => {
  test("uma linha só: quebras viram ' — ' e os espaços repetidos se juntam", () => {
    expect(azText("a\nb", 400)).toBe("a — b");
    expect(azText("a\r\n\r\n\r\nb", 400)).toBe("a — b");
    expect(azText("a \n b", 400)).toBe("a — b");
    expect(azText("\n\n  a\n", 400)).toBe("a");
    expect(azText("a   b\t\t c", 400)).toBe("a b c");
  });

  test("os caracteres que o Bun recusa no .cmd saem ou viram equivalentes seguros", () => {
    expect(azText("<x>", 400)).toBe("(x)");
    expect(azText("a & b", 400)).toBe("a e b");
    expect(azText("a|b", 400)).toBe("a/b");
    expect(azText("5^2", 400)).toBe("52");
    expect(azText('diz "oi"', 400)).toBe("diz 'oi'");
    expect(azText("100%", 400)).toBe("100");
    for (const text of NASTY) expect(REFUSED.test(azText(text, 400))).toBe(false);
  });

  test("o az lê arquivo de argumento que começa com @ ou tem =@: o texto de terceiros não pode usar isso", () => {
    expect(azText("@ana veja", 400)).toBe(" @ana veja");
    expect(azText("@C:/segredo.txt", 400)).toBe(" @C:/segredo.txt");
    expect(azText("ver x=@C:/segredo.txt", 400)).toBe("ver x= @C:/segredo.txt");
    expect(azText("a@b.com", 400)).toBe("a@b.com");
  });

  test("limite: acima dele corta e termina com a nota; no limite fica como está; sem partir um par de substitutos", () => {
    expect(azText("x".repeat(200), 200)).toBe("x".repeat(200));
    const cut = azText("x".repeat(500), 200);
    expect(cut).toHaveLength(200);
    expect(cut.endsWith(AZ_CUT_NOTE)).toBe(true);
    expect(azText("y".repeat(401), 400)).toHaveLength(400);
    const emojis = azText("😀".repeat(300), 100);
    expect(Array.from(emojis)).toHaveLength(100);
    // No lone surrogate, which would make an invalid argument.
    expect(/[�-�](?![�-�])|(?<![�-�])[�-�]/.test(emojis)).toBe(false);
  });

  test("só os argumentos de texto livre do az são limpos, cada um com o seu limite", () => {
    expect(AZ_TEXT_FLAGS).toMatchObject({ "--title": 200, "--description": 400 });
    const out = sanitizeAzArgs([
      "repos",
      "pr",
      "create",
      "--title",
      "a\nb",
      "--description",
      "x<y",
      "--source-branch",
      "fd/x",
      "--discussion",
      "z|w",
      "--output",
      "json",
    ]);
    expect(out).toEqual([
      "repos",
      "pr",
      "create",
      "--title",
      "a — b",
      "--description",
      "x(y",
      "--source-branch",
      "fd/x",
      "--discussion",
      "z/w",
      "--output",
      "json",
    ]);
    expect(azText("t".repeat(300), AZ_TEXT_FLAGS["--title"] as number)).toHaveLength(200);
    expect(sanitizeAzArgs(["x", "--title"])).toEqual(["x", "--title"]);
  });

  test("a WIQL não é prosa: só as quebras viram espaço; o que o .cmd recusa segue e o erro é claro", () => {
    expect(
      sanitizeAzArgs(["boards", "query", "--wiql", "SELECT [System.Id]\nFROM WorkItems"]),
    ).toEqual(["boards", "query", "--wiql", "SELECT [System.Id] FROM WorkItems"]);
    expect(sanitizeAzArgs(["--wiql", "A <> B"])).toEqual(["--wiql", "A <> B"]);
  });

  test("o erro do Bun para o .cmd vira invalid_state com o motivo; outro erro segue como é", () => {
    const refusal = Object.assign(new TypeError("contains a cmd.exe special character"), {
      code: "ERR_INVALID_ARG_VALUE",
    });
    let caught: unknown;
    try {
      mapSpawnError(refusal);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "invalid_state" });
    expect((caught as Error).message).toContain("az");
    const other = new Error("outro");
    expect(() => mapSpawnError(other)).toThrow(other);
  });

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
