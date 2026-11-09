import { expect, test } from "bun:test";
import { double } from "./serialized.ts";

// Its source alone, as `new Function` gives it to a page: an istanbul counter in it is undefined there.
test("the function's source runs on its own", () => {
  const alone = new Function(`return (${double.toString()})`)() as (n: number) => number;
  expect(alone(2)).toBe(4);
});
