import { expect, test } from "bun:test";
import { GlobalPersonas } from "../../src/features/personas/index.ts";

const planted = (raw: string) => ({
  storage: {
    getItem: (key: string) => (key === "flightdeck.personas" ? raw : null),
    setItem: () => {},
  },
});

const REVIEWER = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reads the diff",
  icon: null,
  model: null,
  effort: null,
  tools: null,
  permissionMode: null,
  body: "Review.",
};

// What a reader gives, or "threw": a red must fail by assertion, not by an error.
const attempt = <T>(read: () => T) => {
  try {
    return read();
  } catch {
    return "threw";
  }
};

test("a stored persona that is not a persona is left out and the others stay (#1609)", () => {
  const raw = JSON.stringify([REVIEWER, { id: "broken", name: "Broken" }, 7]);
  expect(attempt(() => new GlobalPersonas(planted(raw)).list().map((p) => p.id))).toEqual([
    "reviewer",
  ]);
});

test("stored personas that are not a list read as none (#1609)", () => {
  expect(attempt(() => new GlobalPersonas(planted('{"id":"reviewer"}')).list())).toEqual([]);
  expect(attempt(() => new GlobalPersonas(planted("not json")).list())).toEqual([]);
});
