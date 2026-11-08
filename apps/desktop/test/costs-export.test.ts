import { describe, expect, test } from "bun:test";
import type { CostsFilter } from "@flightdeck/protocol";
import { exportCosts } from "../src/lib/costs-export.ts";

const HEADER = "day,cost_usd";
const FILTER: CostsFilter = { from: "2026-10-01", to: "2026-10-07" };

type File = { filename: string; csv: string } | null;

/** A store whose hosts answer `costs.export` as told (a function throws to model a host that fails). */
function fake(answers: Record<string, File | (() => File)>) {
  const asked: Array<{ id: string; filter: unknown }> = [];
  const saved: Array<{ name: string; text: string }> = [];
  const store = {
    async hostCommand(id: string, _command: string, filter: unknown) {
      asked.push({ id, filter });
      const answer = answers[id];
      return typeof answer === "function" ? answer() : (answer ?? null);
    },
    async saveFile(name: string, text: string) {
      saved.push({ name, text });
      return true;
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: the two methods exportCosts uses
  return { store: store as any, asked, saved };
}

const HOSTS = [
  { id: "a", name: "alfa" },
  { id: "b", name: "beta" },
];
const fileOf = (name: string, row: string): File => ({
  filename: name,
  csv: `${HEADER}\n${row}\n`,
});

// Issue #363: the export left the Costs page's component; these pin what it did there.
describe("costs-export: one host saves the file its daemon built", () => {
  test("the file is saved as the host named it, asked with the page's filter", async () => {
    const { store, asked, saved } = fake({ a: fileOf("costs-a.csv", "2026-10-01,1") });
    await exportCosts(store, { acrossHosts: false, hostId: "a", hosts: HOSTS }, FILTER);
    expect(saved).toEqual([{ name: "costs-a.csv", text: `${HEADER}\n2026-10-01,1\n` }]);
    expect(asked).toEqual([{ id: "a", filter: FILTER }]);
  });

  test("a host with no file saves nothing", async () => {
    const { store, saved } = fake({ a: null });
    await exportCosts(store, { acrossHosts: false, hostId: "a", hosts: HOSTS }, FILTER);
    expect(saved).toEqual([]);
  });

  test("only the scoped host is asked, not the others", async () => {
    const { store, asked } = fake({ a: fileOf("a.csv", "x,1") });
    await exportCosts(store, { acrossHosts: false, hostId: "a", hosts: HOSTS }, FILTER);
    expect(asked.map((q) => q.id)).toEqual(["a"]);
  });
});

describe("costs-export: every host becomes one file with the host as its first column", () => {
  test("both files are merged and saved under the first file's name", async () => {
    const { store, asked, saved } = fake({
      a: fileOf("costs-a.csv", "2026-10-01,1"),
      b: fileOf("costs-b.csv", "2026-10-01,2"),
    });
    await exportCosts(store, { acrossHosts: true, hostId: "__all__", hosts: HOSTS }, FILTER);
    expect(saved).toEqual([
      {
        name: "costs-a.csv",
        text: [`host,${HEADER}`, "alfa,2026-10-01,1", "beta,2026-10-01,2", ""].join("\n"),
      },
    ]);
    expect(asked.map((q) => q.id).sort()).toEqual(["a", "b"]);
    expect(asked.every((q) => q.filter === FILTER)).toBe(true);
  });

  test("a host that throws is left out; the others are still saved", async () => {
    const { store, saved } = fake({
      a: () => {
        throw new Error("offline");
      },
      b: fileOf("costs-b.csv", "2026-10-01,2"),
    });
    await exportCosts(store, { acrossHosts: true, hostId: "__all__", hosts: HOSTS }, FILTER);
    expect(saved).toEqual([
      { name: "costs-b.csv", text: [`host,${HEADER}`, "beta,2026-10-01,2", ""].join("\n") },
    ]);
  });

  test("a host that answers with no file is left out too", async () => {
    const { store, saved } = fake({ a: null, b: fileOf("costs-b.csv", "2026-10-01,2") });
    await exportCosts(store, { acrossHosts: true, hostId: "__all__", hosts: HOSTS }, FILTER);
    expect(saved.map((s) => s.name)).toEqual(["costs-b.csv"]);
    expect(saved[0]?.text).not.toContain("alfa");
  });

  test("when no host gives a file, nothing is saved", async () => {
    const { store, saved } = fake({ a: null, b: null });
    await exportCosts(store, { acrossHosts: true, hostId: "__all__", hosts: HOSTS }, FILTER);
    expect(saved).toEqual([]);
  });

  test("when the files are empty, there is nothing to merge and nothing is saved", async () => {
    const { store, saved } = fake({
      a: { filename: "a.csv", csv: "" },
      b: { filename: "b.csv", csv: "" },
    });
    await exportCosts(store, { acrossHosts: true, hostId: "__all__", hosts: HOSTS }, FILTER);
    expect(saved).toEqual([]);
  });

  test("when every host fails, nothing is saved and nothing throws", async () => {
    const boom = () => {
      throw new Error("down");
    };
    const { store, saved } = fake({ a: boom, b: boom });
    await exportCosts(store, { acrossHosts: true, hostId: "__all__", hosts: HOSTS }, FILTER);
    expect(saved).toEqual([]);
  });
});
