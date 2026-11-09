import { describe, expect, test } from "bun:test";
import { compareHosts, hostFacts } from "../../apps/desktop/src/lib/host-compare.ts";
import { DEMO_ONLINE_HOSTS, demoHostSetup } from "../lib/demo-hosts.ts";

/** What the Compare hosts table holds for a demo host: its Start at boot state, as the daemon words it. */
const bootState = (name: string) =>
  hostFacts({
    hostId: name,
    online: true,
    info: undefined,
    doctor: undefined,
    deps: {
      items: [{ id: "service", state: demoHostSetup(name).serviceInstalled ? "ok" : "missing" }],
    },
  });

describe("demo-hosts (#1520)", () => {
  test("the demo starts three online hosts, so there is a majority to differ from", () => {
    expect(DEMO_ONLINE_HOSTS).toEqual(["alfa", "beta", "gama"]);
  });

  test("alfa and beta keep the service not installed, which the Start at boot journey reads on alfa", () => {
    expect(demoHostSetup("alfa").serviceInstalled).toBe(false);
    expect(demoHostSetup("beta").serviceInstalled).toBe(false);
  });

  test("gama has it installed, so the print's table marks one cell: gama's Start at boot", () => {
    expect(demoHostSetup("gama").serviceInstalled).toBe(true);
    const rows = compareHosts(DEMO_ONLINE_HOSTS.map(bootState));
    const marked = rows.flatMap((row) =>
      row.cells.filter((cell) => cell.marked).map((cell) => `${row.field}:${cell.hostId}`),
    );
    expect(marked).toEqual(["boot:gama"]);
  });
});
