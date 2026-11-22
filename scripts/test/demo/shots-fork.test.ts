import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { agentShots } from "../../lib/shots/table-agent.ts";
import { wireRewriter } from "../../lib/shots/wire.ts";

const IDS = { rewindSession: "rw" } as DemoIds;
const forkShots = () => agentShots(IDS).filter((s) => s.name.startsWith("linha-do-tempo-bifurc"));
const named = (name: string) => forkShots().find((shot) => shot.name === name);

/** Runs a print's `prepare` on a page that records each call and answers with itself. */
async function calls(name: string): Promise<string[]> {
  const seen: string[] = [];
  // An options object reads as its values, so a button's name is in the call.
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
  await named(name)?.prepare?.(recorder as never);
  return seen;
}

// #4039: the Fork dialog's two states with the files ticked, and the forked result, have prints.
describe("the Fork dialog prints (#4039)", () => {
  test("the table prints the dialog with the files ticked, the refused preview and the forked result after the plain dialog", () => {
    expect(forkShots().map((shot) => shot.name)).toEqual([
      "linha-do-tempo-bifurcar",
      "linha-do-tempo-bifurcar-arquivos",
      "linha-do-tempo-bifurcar-recusa",
      "linha-do-tempo-bifurcado",
    ]);
    expect(
      forkShots().every((shot) => shot.route.name === "session" && shot.route.id === "rw"),
    ).toBe(true);
  });

  test("the files print leaves the host alone, the refused one refuses the preview and the forked one answers the fork from a read", () => {
    expect(named("linha-do-tempo-bifurcar-arquivos")?.wire).toBeUndefined();
    expect(named("linha-do-tempo-bifurcar-recusa")?.wire).toEqual([
      { command: "rewind.preview", refuse: expect.stringContaining("snapshot") },
    ]);
    // A real fork writes a transcript on the demo's host: the request goes out as a read instead.
    expect(named("linha-do-tempo-bifurcado")?.wire).toEqual([
      {
        command: "session.fork",
        as: "snapshots.list",
        data: {
          claudeSessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          command: expect.stringContaining("claude --resume "),
        },
      },
    ]);
  });

  test("a request sent as another command also gets the data the print gives its answer", () => {
    const wire = wireRewriter([{ command: "session.fork", as: "snapshots.list", data: { n: 1 } }]);
    const sent = JSON.parse(
      wire.fromApp(JSON.stringify({ id: "r1", type: "session.fork", payload: {} })),
    ) as { type: string };
    const answer = JSON.parse(
      wire.fromHost(JSON.stringify({ type: "ack", id: "r1", ok: true, data: { snapshots: [] } })),
    ) as { data: unknown };
    expect([sent.type, answer.data]).toEqual(["snapshots.list", { n: 1 }]);
  });

  test("the files print ticks the box on a turn with files and waits for the list to load", async () => {
    const seen = await calls("linha-do-tempo-bifurcar-arquivos");
    const tick = seen.findIndex((c) => c.includes("Also rewind the files"));
    const loaded = seen.findIndex((c) => c.includes("Working out what changes"));
    expect(seen.some((c) => c.includes("turn) 2"))).toBe(true);
    expect(tick).toBeGreaterThan(-1);
    expect(loaded).toBeGreaterThan(tick);
  });

  test("the refused print waits for the retry button, and the forked print picks the terminal and presses Fork", async () => {
    const refused = await calls("linha-do-tempo-bifurcar-recusa");
    expect(refused.some((c) => c.includes("Try again"))).toBe(true);
    const forked = await calls("linha-do-tempo-bifurcado");
    const where = forked.findIndex((c) => c.includes("Open in the terminal"));
    const press = forked.findIndex((c) => c.includes("Bifurcar|Fork"));
    const result = forked.findIndex((c) => c.includes("Conversation forked"));
    expect(where).toBeGreaterThan(-1);
    expect(press).toBeGreaterThan(where);
    expect(result).toBeGreaterThan(press);
  });
});
