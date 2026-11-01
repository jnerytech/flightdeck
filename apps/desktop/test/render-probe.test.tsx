import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import { registerDom } from "./dom.ts";
import { renderProbe } from "./render-probe.tsx";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
afterEach(cleanup);

function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      clicked {n}
    </button>
  );
}

describe("render-probe: commits and render time of a tree, between two moments", () => {
  test("it counts the mount and each later commit, and reports only what came after a snapshot", async () => {
    const probe = renderProbe("counter");
    render(probe.wrap(<Counter />));
    expect(probe.stats.commits).toBe(1);
    const before = probe.snapshot();
    expect(before.commits).toBe(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
      fireEvent.click(screen.getByRole("button"));
    });
    const after = probe.since(before);
    expect(after.commits).toBe(1);
    expect(after.ms).toBeGreaterThanOrEqual(0);
    expect(probe.stats.commits).toBe(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(probe.since(before).commits).toBe(2);
    expect(probe.since(probe.snapshot())).toMatchObject({ commits: 0, ms: 0 });
  });

  test("the worst commit is the longest one, and the time adds up", () => {
    const probe = renderProbe();
    render(probe.wrap(<Counter />));
    const { commits, ms, worst } = probe.stats;
    expect(commits).toBe(1);
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(ms).toBe(worst);
    expect(screen.getByRole("button").textContent).toBe("clicked 0");
  });
});
