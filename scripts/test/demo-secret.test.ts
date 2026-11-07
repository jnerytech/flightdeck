import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { DEMO_FAKE_KEY, DEMO_SECRET_FILE } from "../lib/demo-secret.ts";

const scanner = new SecretScanner();

describe("demo-secret: the key the demo's repository holds for the Files panel (#846)", () => {
  test("the fake key is one the host's scanner masks", () => {
    expect(scanner.scan(DEMO_FAKE_KEY).length > 0).toBe(true);
    expect(scanner.redact(DEMO_FAKE_KEY, false)).toBe("[redacted]");
  });

  test("the committed file holds the key on a line a person can search for", () => {
    const line = DEMO_SECRET_FILE.text.split("\n").find((l) => l.includes(DEMO_FAKE_KEY));
    expect([DEMO_SECRET_FILE.name, line?.includes("chave de exemplo")]).toEqual([
      "config.example.ts",
      true,
    ]);
  });

  test("no source file holds the key as one piece, so a secret scan of the repository stays quiet", () => {
    const source = readFileSync(join(import.meta.dir, "../lib/demo-secret.ts"), "utf8");
    expect(scanner.scan(source)).toEqual([]);
  });
});
