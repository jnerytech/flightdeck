import { afterEach, describe, expect, test } from "bun:test";
import type { ChangesResult } from "@flightdeck/protocol";
import { translator } from "../../src/i18n/index.ts";
import { registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { TContext } = await import("../../src/i18n/context.tsx");
const { ChangesPanel } = await import("../../src/features/review/changes-panel.tsx");

afterEach(() => cleanup());

const t = translator("en");

const CHANGES = {
  target: "session:c1",
  root: "/work/api",
  base: null,
  position: null,
  files: [
    {
      path: "app.ts",
      oldPath: null,
      status: "modified",
      additions: 1,
      deletions: 0,
      uncommitted: true,
      binary: false,
      hunks: [
        {
          header: "@@ -1,0 +1,1 @@",
          oldStart: 1,
          newStart: 1,
          lines: [{ op: "+", text: "const total = a + b;" }],
        },
      ],
    },
  ],
} as unknown as ChangesResult;

type Answer = { ok: true; data: ChangesResult } | { ok: false; code: string; message: string };
const ok: Answer = { ok: true, data: CHANGES };
const refused: Answer = { ok: false, code: "host_gone", message: "the host went away" };

/** A host whose `changes.get` answers come from a queue; `hold` keeps the next answer pending. */
function fakeStore(answers: Answer[]) {
  const asked: number[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  const store = {
    hostRequest: async () => {
      asked.push(asked.length);
      if (hold) await new Promise<void>((resolve) => (release = resolve));
      return answers.shift() ?? ok;
    },
    hostCommand: async (_host: string, type: string) =>
      type === "review.list" ? { comments: [] } : null,
    watchChanges: () => () => {},
    system: { canOpenPaths: () => false, copyText: async () => {} },
    later: () => () => {},
    now: () => Date.now(),
    success: () => {},
  };
  return {
    store: store as never,
    asked,
    holdNext: () => {
      hold = true;
    },
    answer: async () => {
      hold = false;
      await act(async () => release?.());
    },
  };
}

async function show(answers: Answer[]) {
  const fake = fakeStore(answers);
  render(
    <TContext.Provider value={t}>
      <ChangesPanel store={fake.store} hostId="h1" target="session:c1" />
    </TContext.Provider>,
  );
  await act(async () => {});
  return fake;
}

const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

const alerts = () => screen.queryAllByRole("alert").map((el) => el.textContent ?? "");
const showsDiff = () => screen.queryAllByText("app.ts").length > 0;

describe("changes-refresh-ui: a refused read says so, and Refresh shows it is working (#3891)", () => {
  test("the first read refused is an error with a way to try again", async () => {
    await show([refused]);
    expect(alerts()).toEqual([expect.stringContaining("Cannot show the changes")]);
    expect(alerts()[0]).toContain("the host went away");
    await press("Try again");
    expect(showsDiff()).toBe(true);
    expect(alerts()).toEqual([]);
  });

  test("a refused Refresh keeps the last diff, says it is the last one read, and a good one clears that", async () => {
    await show([ok, refused]);
    expect(alerts()).toEqual([]);
    await press("Refresh");
    expect(showsDiff()).toBe(true);
    expect(alerts()).toEqual([expect.stringContaining("Could not refresh the changes")]);
    expect(alerts()[0]).toContain("the host went away");
    expect(alerts()[0]).toContain("last one read");
    await press("Refresh");
    expect(alerts()).toEqual([]);
  });

  test("while a Refresh is not answered the button is busy and a second press asks nothing", async () => {
    const fake = await show([ok]);
    fake.holdNext();
    await press("Refresh");
    const button = screen.getByRole("button", { name: "Refresh" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const before = fake.asked.length;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(fake.asked.length).toBe(before);
    await fake.answer();
    expect(screen.getByRole("button", { name: "Refresh" }).getAttribute("aria-busy")).toBeNull();
  });
});
