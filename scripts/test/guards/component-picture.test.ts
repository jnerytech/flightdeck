import { describe, expect, test } from "bun:test";
import { componentPicture, domainOf } from "../../lib/component-picture.ts";

const module = (source: string, ...deps: string[]) => ({
  source,
  dependencies: deps.map((resolved) => ({ resolved })),
});

/** The edges of a chart as `from --> to` pairs, whether a line draws one target or several (`a --> b & c`). */
const edgesOf = (chart: string): string[] =>
  chart.split("\n").flatMap((line) => {
    const [from, targets] = line.trim().split(" --> ");
    return targets === undefined ? [] : targets.split(" & ").map((to) => `${from} --> ${to}`);
  });

const D = "apps/daemon/src";
const W = "apps/desktop/src";
const P = "packages/protocol/src";

describe("component picture (#1624)", () => {
  test("a file belongs to its domain folder: a feature, another top folder of the desktop, a daemon folder or the protocol", () => {
    expect(domainOf(`${W}/features/board/store.ts`)).toBe("desktop/board");
    expect(domainOf(`${W}/shared/box.tsx`)).toBe("desktop/shared");
    expect(domainOf(`${W}/features/board/parts/y.ts`)).toBe("desktop/board");
    expect(domainOf(`${D}/sessions/index.ts`)).toBe("daemon/sessions");
    expect(domainOf(`${D}/main.ts`)).toBe("daemon/main");
    expect(domainOf(`${P}/vault.ts`)).toBe("protocol");
    expect(domainOf("scripts/lib/x.ts")).toBeNull();
    expect(domainOf("node_modules/zod/index.js")).toBeNull();
  });

  test("files collapse to their domain: one edge per pair, none inside a domain, none to outside code", () => {
    const text = componentPicture([
      module(`${D}/board/a.ts`, `${D}/board/b.ts`, `${D}/sessions/index.ts`, "node_modules/x/y.js"),
      module(`${D}/board/b.ts`, `${D}/sessions/index.ts`, `${P}/index.ts`),
      module(`${D}/sessions/index.ts`),
    ]);
    const daemon = text.split("```mermaid")[1]?.split("```")[0] ?? "";
    expect(edgesOf(daemon)).toEqual([
      "daemon_board --> daemon_sessions",
      "daemon_board --> protocol",
    ]);
    expect(daemon).not.toContain("node_modules");
  });

  test("a domain's imports share one line, so the generated file stays under the Markdown size limit", () => {
    const text = componentPicture([
      module(`${D}/board/a.ts`, `${D}/sessions/index.ts`, `${D}/runtime/index.ts`, `${P}/index.ts`),
      module(`${D}/sessions/index.ts`, `${D}/runtime/index.ts`),
      module(`${D}/runtime/index.ts`),
    ]);
    const lines = (text.split("```mermaid")[1]?.split("```")[0] ?? "")
      .split("\n")
      .filter((line) => line.includes("-->"));
    expect(lines).toEqual([
      "  daemon_board --> daemon_runtime & daemon_sessions & protocol",
      "  daemon_sessions --> daemon_runtime",
    ]);
  });

  test("each app has its own flowchart, and a domain without an edge is still a node", () => {
    const text = componentPicture([
      module(`${W}/features/board/a.ts`, `${P}/index.ts`),
      module(`${W}/features/lonely/a.ts`),
      module(`${D}/board/a.ts`),
    ]);
    const blocks = text.split("```mermaid").slice(1);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("daemon_board");
    expect(blocks[1]).toContain("desktop_lonely");
    expect(blocks[1]).toContain("desktop_board --> protocol");
  });

  test("a domain that most others import is listed, not drawn: its edges would bury the picture and pass mermaid's 500-edge limit", () => {
    const importers = Array.from({ length: 41 }, (_, i) =>
      module(`${W}/features/f${i}/a.ts`, `${W}/shared/box.ts`, `${W}/features/hub/a.ts`),
    );
    const text = componentPicture([...importers, module(`${W}/features/hub/a.ts`)]);
    const desktop = text.split("## Desktop")[1] ?? "";
    expect(edgesOf(desktop)).not.toContain("desktop_f0 --> desktop_shared");
    expect(edgesOf(desktop)).not.toContain("desktop_f40 --> desktop_hub");
    expect(desktop).toContain(
      "Imported by more than 40 domains, so their edges are not drawn: `hub`, `shared`.",
    );
    // 40 importers is not yet most of them: the edges stay
    const few = componentPicture(importers.slice(0, 40)).split("## Desktop")[1] ?? "";
    expect(edgesOf(few)).toContain("desktop_f0 --> desktop_shared");
    expect(few).not.toContain("are not drawn");
  });

  test("the same graph gives the same text in whatever order its modules come", () => {
    const modules = [
      module(`${D}/sessions/index.ts`, `${D}/board/index.ts`),
      module(`${D}/board/index.ts`, `${D}/runtime/index.ts`),
      module(`${D}/runtime/index.ts`),
      module(`${W}/features/a/x.ts`, `${W}/shared/y.ts`),
    ];
    expect(componentPicture([...modules].reverse())).toBe(componentPicture(modules));
    expect(componentPicture(modules)).toContain("# ");
  });

  test("the file is a decision record naming the command that regenerates it", () => {
    const first = componentPicture([]).split("\n")[0] ?? "";
    expect(first).toMatch(/^# .+ \(issue #1624\)$/);
    expect(componentPicture([])).toContain("bun run arch:picture");
  });
});
