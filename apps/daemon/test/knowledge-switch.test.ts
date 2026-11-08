import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { testHome } from "../../../scripts/test/temp-dir.ts";
import { expandHome } from "../src/config.ts";
import { knowledgeSwitchFor } from "../src/knowledge/switch.ts";
import { tempDir } from "./helpers.ts";

/** Issue #76: the person's switch for the index, per project: a folder in `knowledge.feedOff`. */
function host(initial: string[], trusted = true) {
  const entries = [...initial];
  let writes = 0;
  const sw = knowledgeSwitchFor({
    off: () => entries.map((e) => resolve(expandHome(e))),
    trust: async () => ({ trusted }),
    change: async (update) => {
      writes += 1;
      // Read, wait, write: as the config file is rewritten, so two at once would lose one.
      const read = [...entries];
      await Promise.resolve();
      entries.splice(0, entries.length, ...update(read));
    },
  });
  return { sw, entries, writes: () => writes };
}

describe("knowledge-switch: who has the index switched off (#76)", () => {
  test("a project in no off folder is on; the state says whether it is trusted too", async () => {
    const project = tempDir("fd-switch-");
    const a = await host([join(project, "..", "other")]).sw.state(project);
    const b = await host([], false).sw.state(project);
    expect([a, b]).toEqual([
      { on: true, trusted: true, offBy: null },
      { on: true, trusted: false, offBy: null },
    ]);
  });

  test("a project is off by its own folder, or by one above it, and the state names that folder", async () => {
    const parent = tempDir("fd-switch-");
    const project = join(parent, "app");
    const own = await host([project]).sw.state(project);
    const above = await host([parent]).sw.state(project);
    // `app2` starts like `app` and is another folder.
    const sibling = await host([join(parent, "app2")]).sw.state(project);
    expect([own.offBy, above.offBy, sibling.offBy]).toEqual([project, parent, null]);
  });

  test("switching off adds the project's folder once, and changes nothing else in the list", async () => {
    const project = tempDir("fd-switch-");
    const h = host(["/keep/this"]);
    const first = await h.sw.set(project, false);
    const again = await h.sw.set(project, false);
    expect(h.entries).toEqual(["/keep/this", project]);
    expect([first.on, first.offBy, again.offBy, h.writes()]).toEqual([false, project, project, 1]);
  });

  test("switching on takes out the entries that name the project, and keeps the others", async () => {
    const project = join(testHome(), "work", "app");
    const h = host(["/keep/this", project, "~/work/app", "/keep/that"]);
    const state = await h.sw.set(project, true);
    expect(h.entries).toEqual(["/keep/this", "/keep/that"]);
    expect([state.on, state.offBy]).toEqual([true, null]);
  });

  test("a project off by a folder above it stays off: that folder switches off other projects too", async () => {
    const parent = tempDir("fd-switch-");
    const project = join(parent, "app");
    const h = host([parent]);
    const state = await h.sw.set(project, true);
    expect([h.entries, h.writes(), state.on, state.offBy]).toEqual([[parent], 0, false, parent]);
  });

  test("switching on a project that is on writes nothing", async () => {
    const project = tempDir("fd-switch-");
    const h = host([]);
    const state = await h.sw.set(project, true);
    expect([h.writes(), state.on]).toEqual([0, true]);
  });

  test("two switches asked together both land: each one sees what the other wrote", async () => {
    const parent = tempDir("fd-switch-");
    const [a, b] = [join(parent, "a"), join(parent, "b")];
    const h = host([]);
    await Promise.all([h.sw.set(a, false), h.sw.set(b, false)]);
    expect(h.entries.sort()).toEqual([a, b]);
  });

  test("a write that fails is reported, and the next switch still goes through", async () => {
    const project = tempDir("fd-switch-");
    let fail = true;
    const sw = knowledgeSwitchFor({
      off: () => [],
      trust: async () => ({ trusted: true }),
      change: async () => {
        if (fail) throw new Error("disk full");
      },
    });
    const first = await Promise.allSettled([sw.set(project, false)]);
    fail = false;
    const second = await Promise.allSettled([sw.set(project, false)]);
    expect([first[0]?.status, second[0]?.status]).toEqual(["rejected", "fulfilled"]);
  });
});
