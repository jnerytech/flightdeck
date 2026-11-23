import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parkPointer } from "../../lib/shots/shot.ts";
import { recordingPage } from "./recording-page.ts";

describe("the pointer is parked off the content before a print is judged (#4431)", () => {
  test("parkPointer moves the mouse to a point outside the content", async () => {
    const { page, steps } = recordingPage();
    await parkPointer(page);
    expect(steps).toEqual(["mouse.move 1000,700"]);
  });

  test("demo:shots parks the pointer after a print's prepare and before its screenshot", () => {
    const source = readFileSync(join(import.meta.dir, "../../demo-shots.ts"), "utf8");
    const prepare = source.indexOf("await shot.prepare?.(page)");
    const park = source.indexOf("await parkPointer(page)");
    const screenshot = source.indexOf(
      "await page.screenshot({\n      path: join(dir, `${shot.name}.png`)",
    );
    expect(prepare).toBeGreaterThan(-1);
    expect(park).toBeGreaterThan(prepare);
    expect(screenshot).toBeGreaterThan(park);
  });
});
