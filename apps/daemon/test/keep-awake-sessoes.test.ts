import { describe, expect, test } from "bun:test";
import { newManager, waitFor } from "./helpers.ts";

describe("keep-awake-sessoes: the manager says how many sessions are active (#163)", () => {
  test("it counts a session while it starts and runs, and says zero when the turn is done", async () => {
    const seen: number[] = [];
    const { manager, project, start } = newManager({ onActivity: (n) => void seen.push(n) });
    const created = await start({ cwd: project, prompt: "oi" });
    await waitFor(() => manager.get(created.id).status === "idle", { label: "idle" });
    expect(seen[0]).toBeGreaterThanOrEqual(1);
    expect(seen.at(-1)).toBe(0);
    expect(Math.max(...seen)).toBe(1);
  });

  test("a session waiting for a permission is still active, and a second one adds to the count", async () => {
    const seen: number[] = [];
    const { manager, project, start } = newManager({ onActivity: (n) => void seen.push(n) });
    const a = await start({ cwd: project, prompt: "[tool] escreve" });
    await waitFor(() => manager.get(a.id).status === "awaiting_permission", { label: "waiting" });
    expect(seen.at(-1)).toBe(1);
    await start({ cwd: project, prompt: "[tool] outra" });
    await waitFor(() => seen.includes(2), { label: "two active" });
    expect(seen.at(-1)).toBe(2);
  });
});
