import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../../src/styles/inbox.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The declarations of the rule whose selector list includes `selector`. */
const ruleOf = (selector: string): string =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => (selectors ?? "").split(",").some((one) => one.trim() === selector))
    .map(([, , body]) => body ?? "")
    .join(";");

describe("the notification panel's row controls (#4031)", () => {
  test("a row that holds the focus hides its time and shows its mark control, as a hover does", () => {
    expect(ruleOf("&:focus-within .inbox-time").includes("visibility: hidden")).toBe(true);
    expect(ruleOf("&:focus-within .inbox-mark").includes("opacity: 1")).toBe(true);
  });

  test("a hover still hides the time and shows the mark control", () => {
    expect(ruleOf("&:hover .inbox-time").includes("visibility: hidden")).toBe(true);
    expect(ruleOf("&:hover .inbox-mark").includes("opacity: 1")).toBe(true);
  });
});

describe("the mark control on a pointer that cannot hover (#4202)", () => {
  test("it is always visible and leaves the corner it shares with the time", () => {
    const body = ruleOf("@media (hover: none)");
    expect(body.includes("opacity: 1")).toBe(true);
    expect(body.includes("position: static")).toBe(true);
  });
});
