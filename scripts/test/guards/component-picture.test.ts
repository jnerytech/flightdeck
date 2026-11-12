import { describe, expect, test } from "bun:test";
import { componentPicture, domainOf } from "../../lib/component-picture.ts";

const module = (source: string, ...deps: string[]) => ({
  source,
  dependencies: deps.map((resolved) => ({ resolved })),
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
    expect(daemon.match(/-->/g)).toHaveLength(2);
    expect(daemon).toContain("daemon_board --> daemon_sessions");
    expect(daemon).toContain("daemon_board --> protocol");
    expect(daemon).not.toContain("daemon_board --> daemon_board");
    expect(daemon).not.toContain("node_modules");
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
