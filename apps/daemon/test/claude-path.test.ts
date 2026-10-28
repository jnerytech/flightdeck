import { describe, expect, test } from "bun:test";
import { delimiter } from "node:path";
import { resolveClaudePath } from "../src/runtime/claude-sdk-runtime.ts";
import { whichOnPath } from "../src/which.ts";

// The test preload puts a sentinel folder first on PATH; lookups must see it.
const firstOnPath = (process.env.PATH ?? "").split(delimiter)[0] ?? "";

describe("claude-path", () => {
  test("whichOnPath usa o PATH atual do processo, não o da partida", () => {
    expect(whichOnPath("claude")?.startsWith(firstOnPath)).toBe(true);
    expect(whichOnPath("comando-que-nao-existe-123")).toBeNull();
  });

  test("no binário compilado, o claude padrão vem do PATH atual", () => {
    expect(
      resolveClaudePath(undefined, { main: "/$bunfs/root/flightdeckd" })?.startsWith(firstOnPath),
    ).toBe(true);
  });
});
