import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

const IDS = {} as DemoIds;
const names = () => hostShots(IDS).map((shot) => shot.name);

describe("the Add host prints (#3886)", () => {
  test("the form's field errors and a refused token have a print each, right after the plain form", () => {
    const all = names();
    const form = all.indexOf("host-novo");
    expect(form).toBeGreaterThan(-1);
    expect(all.slice(form, form + 3)).toEqual([
      "host-novo",
      "host-novo-campos",
      "host-novo-recusado",
    ]);
  });

  test("both open the Add host page of a host that already exists, and are re-measured narrow", () => {
    const shots = hostShots(IDS).filter((s) => s.name.startsWith("host-novo-"));
    expect(shots.map((s) => s.route.name)).toEqual(["add-host", "add-host"]);
    expect(NARROW_SHOTS).toContain("host-novo-campos");
    expect(NARROW_SHOTS).toContain("host-novo-recusado");
  });
});
