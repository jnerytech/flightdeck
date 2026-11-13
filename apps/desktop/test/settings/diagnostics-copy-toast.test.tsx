import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { DiagnosticsPanel } = await import("../../src/features/settings/diagnostics-panel.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup(clipboard: "works" | "rejects") {
  const mem = memoryPlatform(false, "en");
  const copied: string[] = [];
  mem.platform.logs = {
    write: async () => {},
    tail: async () => ["2026 INFO a line"],
    openFolder: async () => {},
  };
  mem.platform.copyText = async (text) => {
    if (clipboard === "rejects") throw new Error("clipboard denied");
    copied.push(text);
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  return { store, copied };
}

async function copyDiagnostics(w: ReturnType<typeof setup>) {
  render(
    <TContext.Provider value={w.store.i18n.t}>
      <DiagnosticsPanel store={w.store} />
    </TContext.Provider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
  });
  await settle(() => w.store.getState().notices.length > 0);
  // Let a second toast, if one is coming, arrive before the count is read.
  await settle(() => true);
}

const kinds = (store: InstanceType<typeof AppStore>) => store.getState().notices.map((n) => n.kind);

describe("copy diagnostics: one answer per copy (#2595)", () => {
  test("a working clipboard shows exactly one success toast", async () => {
    const w = setup("works");
    await copyDiagnostics(w);
    expect(w.copied.length).toBe(1);
    expect(kinds(w.store)).toEqual(["success"]);
    expect(w.store.getState().notices[0]?.text).toContain("Diagnostics copied");
  });

  test("a clipboard that rejects shows only the error toast", async () => {
    const w = setup("rejects");
    await copyDiagnostics(w);
    expect(kinds(w.store)).toEqual(["error"]);
  });
});
