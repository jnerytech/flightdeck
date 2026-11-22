import { describe, expect, test } from "bun:test";
import type { DepResult } from "@flightdeck/protocol";
import { depBreaksText, depName } from "../../src/features/deps/index.ts";
import { translator } from "../../src/i18n/index.ts";

const dep = (breaks: string[]): DepResult =>
  ({ id: "gh", group: "optional", state: "missing", breaks, fix: [] }) as unknown as DepResult;

describe("dep text: a tool's name and what its absence limits (issue #4097)", () => {
  test("the name is the one the host health screen shows, in both languages", () => {
    expect(depName("gh", translator("en"))).toBe("GitHub CLI (gh)");
    expect(depName("claude", translator("en"))).toBe("Claude Code");
    expect(depName("claude", translator("pt-BR"))).toBe(
      translator("pt-BR")("hostDeps.names.claude"),
    );
  });

  test("what is limited is listed in the person's words, and a tool that limits nothing says nothing", () => {
    expect(depBreaksText(dep(["pullRequests", "boardSync"]), translator("en"))).toBe(
      "Without it: pull requests from a card, board sync with GitHub Projects",
    );
    expect(depBreaksText(dep(["pullRequests"]), translator("pt-BR"))).toBe(
      `Sem isso: ${translator("pt-BR")("hostDeps.breaks.pullRequests")}`,
    );
    expect(depBreaksText(dep([]), translator("en"))).toBeNull();
  });
});
