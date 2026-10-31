import { afterEach, describe, expect, test } from "bun:test";
import type { Arena, ArenaVariant, CardDiff } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ArenaView } = await import("../src/ui/ArenaView.tsx");

afterEach(cleanup);

const variant = (over: Partial<ArenaVariant>): ArenaVariant => ({
  id: "v1",
  label: "a",
  model: null,
  effort: null,
  persona: null,
  branch: "fd/x-a",
  worktreePath: "/tmp/x-a",
  queued: false,
  sessionStatus: null,
  column: "review",
  startedAt: null,
  endedAt: null,
  durationMs: 90_000,
  costUsd: null,
  files: [],
  checks: [],
  notice: null,
  ...over,
});

const diff: CardDiff = {
  base: "main",
  files: [
    {
      path: "src/a.ts",
      oldPath: null,
      status: "modified",
      additions: 3,
      deletions: 1,
      uncommitted: true,
      binary: false,
      hunks: [{ header: "@@ -1 +1 @@", lines: [{ op: "+", text: "x" }] }],
    },
    {
      path: "src/b.ts",
      oldPath: null,
      status: "added",
      additions: 1,
      deletions: 0,
      uncommitted: false,
      binary: false,
      hunks: [],
    },
  ],
};

describe("ArenaView", () => {
  test("a variant with changes and checks lists their totals and states", () => {
    const arena: Arena = {
      cardId: "c1",
      variants: [
        variant({
          files: [
            { path: "a.ts", additions: 3, deletions: 1 },
            { path: "b.ts", additions: 2, deletions: 0 },
          ],
          checks: [
            { stepId: "verify", status: "completed" },
            { stepId: "lint", status: "failed" },
          ],
          notice: "worktree gone",
        }),
      ],
    };
    render(<ArenaView arena={arena} loadDiff={async () => null} onChoose={() => {}} />);
    const region = screen.queryByRole("region", { name: "Variante a" }) as HTMLElement;
    expect(region.textContent).toContain("2 · +5 −1");
    expect(region.textContent).toContain("verify: completed");
    expect(region.textContent).toContain("lint: failed");
    expect(region.textContent).toContain("worktree gone");
    expect(region.textContent).toContain("2 min");
  });

  test("Ver mudanças loads the diff and lists its files, marking the uncommitted ones", async () => {
    const loaded: string[] = [];
    const arena: Arena = { cardId: "c1", variants: [variant({})] };
    render(
      <ArenaView
        arena={arena}
        loadDiff={async (id) => {
          loaded.push(id);
          return diff;
        }}
        onChoose={() => {}}
      />,
    );
    const region = screen.queryByRole("region", { name: "Variante a" }) as HTMLElement;
    await act(async () => {
      fireEvent.click(within(region).getByRole("button", { name: "Ver mudanças" }));
    });
    expect(loaded).toEqual(["v1"]);
    const list = within(region).getByRole("list", { name: "Arquivos alterados" });
    expect(list.textContent).toContain("src/a.ts");
    expect(list.textContent).toContain("src/b.ts");
    expect(list.textContent).toContain("+3 −1");
    expect(within(list).queryAllByText("não commitado").length).toBe(1);
    // The comparison is read-only: picking a line number does nothing.
    const line = region.querySelector("button[aria-pressed]") as HTMLElement;
    await act(async () => {
      fireEvent.click(line);
    });
    expect(line.getAttribute("aria-pressed")).toBe("false");
  });

  test("Escolher hands the variant over", async () => {
    const chosen: string[] = [];
    const arena: Arena = { cardId: "c1", variants: [variant({})] };
    render(
      <ArenaView arena={arena} loadDiff={async () => null} onChoose={(v) => chosen.push(v.id)} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Escolher a variante a" }));
    });
    expect(chosen).toEqual(["v1"]);
  });
});
