import { describe, expect, test } from "bun:test";
import { lastTool } from "../src/history/session-line.ts";

describe("historico-ferramentas: the last tool of a message", () => {
  test("it reads the tool of a `[tool Name] input` line, and of the older `[ferramenta Name]` one", () => {
    expect(lastTool("looking\n[tool Read] /p/a.ts\nnow\n[tool Bash] ls -la")).toBe("Bash");
    expect(lastTool("looking\n[ferramenta Read]\nnow\n[tool Grep] foo")).toBe("Grep");
    expect(lastTool("[tool Edit] /p/a.ts")).toBe("Edit");
    expect(lastTool("no calls here")).toBeNull();
  });
});
