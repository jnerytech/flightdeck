import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { runenvShots } from "../../lib/shots/table-runenv.ts";
import type { WireRule } from "../../lib/shots/wire.ts";

const IDS = { project: "p1", diffCard: "c1", idleSession: "s1" } as DemoIds;
const shots = runenvShots(IDS);
const names = shots.map((shot) => shot.name);

/** The states of a card's Run environment panel the prints did not show (#4287), as the issue lists them. */
const STATES = [
  "card-ambiente-revisar",
  "card-ambiente-confiar",
  "card-ambiente-erros",
  "card-ambiente-parado",
  "card-ambiente-setup",
  "card-ambiente-rodando",
  "card-ambiente-caiu",
  "card-ambiente-falhou",
  "card-ambiente-recusado",
  "card-ambiente-confianca-recusada",
];

const wireOf = (name: string): WireRule[] => shots.find((shot) => shot.name === name)?.wire ?? [];
const answerOf = (name: string, command: string): unknown => {
  const rule = wireOf(name).find((r) => r.command === command);
  return rule && "reply" in rule ? rule.reply : undefined;
};

describe("the Run environment panel's prints (#4287)", () => {
  test("every state of the issue has a print of its own", () => {
    expect(STATES.filter((name) => !names.includes(name))).toEqual([]);
  });

  test("no name is printed twice", () => {
    expect(names.length).toBe(new Set(names).size);
  });

  test("every print is the demo card's page, and answers the run.yaml in the page", () => {
    expect(
      shots.filter(
        (shot) =>
          shot.route.name !== "card" ||
          !("cardId" in shot.route) ||
          shot.route.cardId !== IDS.diffCard,
      ).length,
    ).toBe(0);
    expect(STATES.filter((name) => answerOf(name, "runenv.config") === undefined)).toEqual([]);
  });

  test("no rule sends a command to the host: each one is answered, or refused, in the page", () => {
    const sent = shots.flatMap((shot) =>
      (shot.wire ?? []).filter((rule) => !("reply" in rule || "reject" in rule)),
    );
    expect(sent).toEqual([]);
  });

  test("the narrow prints list the panel's states, where its rows and buttons must wrap", () => {
    expect(STATES.filter((name) => narrowSizes("dark", name).length === 0)).toEqual([]);
  });
});

/** Runs a print's `prepare` on a page that records each call and answers with itself. */
async function calls(name: string): Promise<string> {
  const seen: string[] = [];
  const text = (arg: unknown): string => {
    if (arg instanceof RegExp || typeof arg === "string") return String(arg);
    if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
    return typeof arg;
  };
  const member = (call: string): unknown =>
    new Proxy(
      (...args: unknown[]) => {
        seen.push(`${call}(${args.map(text).join(",")})`);
        return recorder;
      },
      { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
    );
  const recorder: unknown = new Proxy(() => recorder, {
    // `then` stays undefined, or awaiting the recorder would wait for it forever.
    get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
  });
  await shots.find((shot) => shot.name === name)?.prepare?.(recorder as never);
  return seen.join(" ");
}

type Info = { trusted: boolean; errors: string[]; config: { run: unknown[] } | null };
type Run = {
  status: string;
  setup: string;
  setupTerminalId: string | null;
  error: string | null;
  processes: Array<{ ready: string; status: string; exitCode: number | null }>;
};

describe("what each Run environment print does on the page (#4287)", () => {
  test("every print waits for what it shows before the shot", async () => {
    const waited = await Promise.all(
      STATES.map(async (name) => [name, (await calls(name)).includes("waitFor")] as const),
    );
    expect(waited.filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  });

  test("the review print lists the commands of an untrusted run.yaml, and the error print says what is wrong with it", () => {
    const review = answerOf("card-ambiente-revisar", "runenv.config") as Info | undefined;
    expect([review?.trusted, review?.config?.run.length]).toEqual([false, 3]);
    const broken = answerOf("card-ambiente-erros", "runenv.config") as Info | undefined;
    expect([broken?.trusted, (broken?.errors.length ?? 0) > 0, broken?.config]).toEqual([
      false,
      true,
      null,
    ]);
  });

  test("the Trust print opens the dialog and confirms nothing; the refused one confirms and the host refuses", async () => {
    expect(await calls("card-ambiente-confiar")).toMatch(/Trust this run.{1,2}yaml.*alertdialog/);
    expect(await calls("card-ambiente-confiar")).not.toMatch(/click\(\).*click\(\)/);
    expect(wireOf("card-ambiente-confianca-recusada").map((r) => r.command)).toEqual([
      "runenv.config",
      "runenv.trust",
    ]);
    expect(wireOf("card-ambiente-confianca-recusada")[1]).toMatchObject({
      reject: expect.any(String),
    });
    expect(await calls("card-ambiente-confianca-recusada")).toMatch(/alertdialog.*Trust/);
  });

  test("the trusted prints press Run and the page answers with the run's state, so no process starts", async () => {
    const idle = answerOf("card-ambiente-parado", "runenv.config") as Info | undefined;
    expect(idle?.trusted).toBe(true);
    expect(await calls("card-ambiente-parado")).not.toMatch(/click/);
    for (const name of [
      "card-ambiente-setup",
      "card-ambiente-rodando",
      "card-ambiente-caiu",
      "card-ambiente-falhou",
    ]) {
      expect([name, await calls(name)]).toEqual([name, expect.stringMatching(/Run.*click/)]);
      expect(answerOf(name, "runenv.start")).not.toBeUndefined();
    }
  });

  test("the setup print is a setup still running with its log to open", async () => {
    const run = answerOf("card-ambiente-setup", "runenv.start") as Run | undefined;
    expect([run?.status, run?.setup, run?.setupTerminalId === null]).toEqual([
      "setup",
      "running",
      false,
    ]);
    expect(await calls("card-ambiente-setup")).toMatch(/View log of Setup/);
  });

  test("the running print has a process ready, one waiting and one that timed out", () => {
    const run = answerOf("card-ambiente-rodando", "runenv.start") as Run | undefined;
    expect(run?.status).toBe("running");
    expect((run?.processes ?? []).map((p) => p.ready).sort()).toEqual([
      "ready",
      "timeout",
      "waiting",
    ]);
  });

  test("the crash print has a process that ended with code 1 and one that ended with none", () => {
    const run = answerOf("card-ambiente-caiu", "runenv.start") as Run | undefined;
    expect(
      (run?.processes ?? []).filter((p) => p.status === "exited").map((p) => p.exitCode),
    ).toEqual([1, null]);
  });

  test("the failed print says why in an alert; the refused one is a Run the host rejects", async () => {
    const run = answerOf("card-ambiente-falhou", "runenv.start") as Run | undefined;
    expect([run?.status, typeof run?.error]).toEqual(["failed", "string"]);
    expect(await calls("card-ambiente-falhou")).toMatch(/alert/);
    // The host's words are in a toast's Details: its title is the app's own.
    expect(await calls("card-ambiente-recusado")).toMatch(
      /Details.*Detalhes.*click\(\).*No free block/,
    );
    expect(
      wireOf("card-ambiente-recusado").find((r) => r.command === "runenv.start"),
    ).toMatchObject({
      reject: expect.any(String),
    });
  });
});
