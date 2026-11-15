import { afterEach, describe, expect, test } from "bun:test";
import type { PermissionUpdate } from "@flightdeck/protocol";
import { checkUpdates, parseSuggestions } from "../../src/permissions/domain/permission-updates.ts";
import { asking, runCleanups } from "../support/permissions-allow-always.ts";

afterEach(runCleanups);

/** What the FakeRuntime suggests for `[bash]` (Bash `npm test --silent`). */
const BASH_SUGGESTIONS: PermissionUpdate[] = [
  {
    type: "addRules",
    rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
    behavior: "allow",
    destination: "localSettings",
  },
  {
    type: "addRules",
    rules: [{ toolName: "Bash", ruleContent: "npm test --silent" }],
    behavior: "allow",
    destination: "session",
  },
];

const refusal = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return `${code}: ${message}`;
  }
};

describe("permitir-sempre", () => {
  test("as sugestões do CLI chegam no pedido da sessão gerenciada", async () => {
    const write = await asking("[tool] x");
    expect(write.requested?.suggestions).toEqual([
      { type: "addDirectories", directories: [write.project], destination: "session" },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ]);
    const bash = await asking("[bash] y");
    expect(bash.requested).toMatchObject({
      toolName: "Bash",
      input: { command: "npm test --silent" },
      suggestions: BASH_SUGGESTIONS,
    });
  });

  test("uma sugestão do próprio pedido, de sessão, chega ao runtime", async () => {
    const { requested, respond, result } = await asking("[tool] x");
    const session = requested?.suggestions?.slice(0, 1) ?? [];
    respond(session);
    expect((await result())?.content).toBe(
      `arquivo criado: fake.txt; permissões: ${JSON.stringify(session)}`,
    );
  });

  test("uma regra do projeto para a ferramenta do pedido chega ao runtime", async () => {
    const { respond, result, requested } = await asking("[bash] y");
    expect(requested?.toolName).toBe("Bash");
    const rule: PermissionUpdate = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "npm run build:*" }],
      behavior: "allow",
      destination: "localSettings",
    };
    respond([rule]);
    expect((await result())?.content).toBe(
      `comando executado: npm test --silent; permissões: ${JSON.stringify([rule])}`,
    );
  });

  test("a sugestão de localSettings vale igual, campo a campo e em qualquer ordem de chaves", async () => {
    const { respond, result, requested } = await asking("[bash] y");
    expect(requested?.toolName).toBe("Bash");
    respond([
      {
        destination: "localSettings",
        behavior: "allow",
        rules: [{ ruleContent: "npm test:*", toolName: "Bash" }],
        type: "addRules",
      },
    ]);
    expect((await result())?.content ?? "").toContain("npm test:*");
  });

  test("destinos, modos e regras proibidos dão invalid_permission_update e o pedido segue aberto", async () => {
    const { requested, respond, open, result, project } = await asking("[tool] x");
    const rule = (patch: Record<string, unknown>) => ({
      type: "addRules",
      rules: [{ toolName: "Write" }],
      behavior: "allow",
      destination: "localSettings",
      ...patch,
    });
    const refused: Array<[unknown, string]> = [
      [rule({ destination: "userSettings" }), "destino userSettings não é permitido"],
      [rule({ destination: "projectSettings" }), "destino projectSettings não é permitido"],
      [rule({ destination: "cliArg" }), "destino cliArg não é permitido"],
      [
        { type: "setMode", mode: "bypassPermissions", destination: "session" },
        "modo bypassPermissions não é permitido",
      ],
      [{ type: "setMode", mode: "auto", destination: "session" }, "modo auto não é permitido"],
      [
        rule({ rules: [{ toolName: "Bash", ruleContent: "ls" }] }),
        "a regra é de outra ferramenta (Bash)",
      ],
      [rule({ rules: [{ toolName: "Write", ruleContent: "" }] }), "conteúdo da regra inválido"],
      [rule({ rules: [{ toolName: "Write", ruleContent: "a\nb" }] }), "conteúdo da regra inválido"],
      [
        rule({ rules: [{ toolName: "Write", ruleContent: "x".repeat(501) }] }),
        "conteúdo da regra inválido",
      ],
      [rule({ rules: [] }), "não é uma das sugestões do pedido nem uma regra do projeto"],
      [rule({ behavior: "deny" }), "não é uma das sugestões do pedido nem uma regra do projeto"],
      [rule({ type: "removeRules" }), "não é uma das sugestões do pedido nem uma regra do projeto"],
      [
        { type: "addDirectories", directories: [`${project}/outra`], destination: "session" },
        "não é uma das sugestões do pedido nem uma regra do projeto",
      ],
    ];
    for (const [update, reason] of refused) {
      expect(refusal(() => respond([update]))).toBe(`invalid_permission_update: ${reason}`);
      expect(open()).toBe(1);
    }
    // One bad item refuses the whole answer, even next to a valid one.
    const valid = requested?.suggestions?.[0];
    expect(refusal(() => respond([valid, rule({ destination: "userSettings" })]))).not.toBeNull();
    expect(open()).toBe(1);
    // A rule for the whole tool covers a credential file: it is refused (#384); one inside the project is not.
    expect(refusal(() => respond([rule({})]))).toBe(
      "invalid_permission_update: a regra permitiria mais risco do que este pedido",
    );
    // Without the server's lookup an exact path counts as a folder (#395): here it is a file.
    respond(
      [
        rule({ rules: [{ toolName: "Write", ruleContent: `${project}/app-*.txt` }] }),
        rule({ rules: [{ toolName: "Write", ruleContent: "x".repeat(500) }] }),
      ],
      () => "file",
    );
    expect((await result())?.content ?? "").toStartWith("arquivo criado: fake.txt; permissões:");
  });

  test("sem updatedPermissions, a aprovação continua como antes", async () => {
    const { manager, requestId, result } = await asking("[tool] x");
    manager.respondPermission({ requestId, decision: "allow" });
    expect((await result())?.content).toBe("arquivo criado: fake.txt");
  });

  test("sugestões que o daemon não entende ficam de fora; as que entende passam", () => {
    expect(
      parseSuggestions([
        { type: "setMode", mode: "acceptEdits", destination: "session" },
        { type: "novidade", destination: "session" },
        "lixo",
      ]),
    ).toEqual([{ type: "setMode", mode: "acceptEdits", destination: "session" }]);
    expect(parseSuggestions(undefined)).toEqual([]);
    expect(parseSuggestions({ type: "setMode" })).toEqual([]);
    expect(() =>
      checkUpdates([], { toolName: "Write", suggestions: [], risk: "high", classify: () => "low" }),
    ).not.toThrow();
  });
});
