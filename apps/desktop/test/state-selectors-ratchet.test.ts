import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "../src");

/** The most files that may take the whole `AppState` as a prop. It only goes down; the goal is 10. */
const MAX_WHOLE_STATE_PROPS = 16;

describe("state-selectors: screens read the parts of the state they show", () => {
  test("the files that take the whole AppState as a prop only go down", () => {
    const files = [...new Bun.Glob("**/*.tsx").scanSync({ cwd: SRC })]
      .filter((file) => /\bstate: AppState\b/.test(readFileSync(join(SRC, file), "utf8")))
      .map((file) => relative(SRC, join(SRC, file)).replaceAll("\\", "/"))
      .sort();
    expect(files.length).toBeLessThanOrEqual(MAX_WHOLE_STATE_PROPS);
  });
});
